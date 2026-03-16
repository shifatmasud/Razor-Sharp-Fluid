
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { 
    baseVertexShader, 
    simVertexShader,
    splatShader, 
    dissipationShader,
    displayShader 
} from './shaders';

interface FluidConfig {
    densityDissipation: number;
    splatRadius: number;
}

interface FluidCanvasProps {
    config: FluidConfig;
}

const FluidCanvas: React.FC<FluidCanvasProps> = ({ config }) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const configRef = useRef(config);
    const canvasSizeRef = useRef({ width: window.innerWidth, height: window.innerHeight });

    useEffect(() => { configRef.current = config; }, [config]);

    useEffect(() => {
        if (!mountRef.current) return;
        const container = mountRef.current;
        
        const renderer = new THREE.WebGLRenderer({ 
            antialias: false, 
            alpha: false, 
            powerPreference: "high-performance",
            depth: false,
            stencil: false
        });
        const canvas = renderer.domElement;
        container.appendChild(canvas);

        const simRes = 512;
        let imageAspectRatio = 1.0; 

        const createFBO = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
        });

        const createDoubleFBO = (w: number, h: number) => {
            let read = createFBO(w, h);
            let write = createFBO(w, h);
            return {
                read: () => read,
                write: () => write,
                swap: () => { let t = read; read = write; write = t; }
            };
        };

        let density = createDoubleFBO(simRes, simRes);

        const geometry = new THREE.PlaneGeometry(2, 2, 128, 128);
        const scene = new THREE.Scene();
        const quad = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        scene.add(quad);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const createProgram = (frag: string, isSim: boolean = false) => new THREE.ShaderMaterial({
            vertexShader: isSim ? simVertexShader : baseVertexShader,
            fragmentShader: frag,
            uniforms: {
                uTexelSize: { value: new THREE.Vector2(1.0 / simRes, 1.0 / simRes) },
                uAspectRatio: { value: imageAspectRatio },
                uTarget: { value: null },
                uColor: { value: new THREE.Vector3() },
                uPoint: { value: new THREE.Vector2() },
                uRadius: { value: 0.01 },
                uSource: { value: null },
                uDissipation: { value: 0.98 },
                uDensity: { value: null },
                uImage: { value: null },
                uDepthMap: { value: null },
                uMouse: { value: new THREE.Vector2(0.5, 0.5) },
                uParallaxStrength: { value: 0.05 },
            },
            depthWrite: false,
            depthTest: false
        }) as any; // Cast to any to avoid strict Material type issues during assignment

        const programs = {
            splat: createProgram(splatShader, true),
            dissipate: createProgram(dissipationShader, true),
            display: createProgram(displayShader, false)
        };

        const pointer = new THREE.Vector2(0.5, 0.5);
        const lastPointer = new THREE.Vector2(0.5, 0.5);
        let isInteracting = false;

        const updatePointer = (x: number, y: number) => {
            const rect = canvas.getBoundingClientRect();
            const newX = (x - rect.left) / rect.width;
            const newY = 1.0 - ((y - rect.top) / rect.height);

            // Only update if the pointer is within the canvas bounds
            if (newX >= 0 && newX <= 1 && newY >= 0 && newY <= 1) {
                pointer.set(newX, newY);
            }
        };

        const onDown = (e: PointerEvent) => {
            if(!e.isPrimary) return;
            isInteracting = true;
            updatePointer(e.clientX, e.clientY);
            lastPointer.copy(pointer);
            (e.target as Element).setPointerCapture(e.pointerId);
        };

        const onMove = (e: PointerEvent) => {
            if(!e.isPrimary) return;
            updatePointer(e.clientX, e.clientY);
        };

        const onUp = (e: PointerEvent) => { 
            if(!e.isPrimary) return;
            isInteracting = false; 
            if (e.target instanceof Element && e.target.hasPointerCapture(e.pointerId)) {
                e.target.releasePointerCapture(e.pointerId);
            }
        };

        const handleResize = () => {
            if (!mountRef.current) return;
            const containerWidth = mountRef.current.clientWidth;
            const containerHeight = mountRef.current.clientHeight;
            const containerAspect = containerWidth / containerHeight;
        
            let canvasWidth, canvasHeight;
        
            if (containerAspect > imageAspectRatio) {
                // Container is wider than the image -> letterbox horizontally
                canvasHeight = containerHeight;
                canvasWidth = canvasHeight * imageAspectRatio;
            } else {
                // Container is taller than the image -> letterbox vertically
                canvasWidth = containerWidth;
                canvasHeight = canvasWidth / imageAspectRatio;
            }
        
            renderer.setSize(canvasWidth, canvasHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            canvasSizeRef.current = { width: canvasWidth, height: canvasHeight };
            
            // The aspect ratio for the shaders is now always the image's aspect ratio
            programs.splat.uniforms.uAspectRatio.value = imageAspectRatio;
            programs.display.uniforms.uAspectRatio.value = imageAspectRatio;
        };

        const generateSceneTexture = (width: number, height: number, isDepth: boolean) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return canvas;

            if (isDepth) {
                // Background depth
                ctx.fillStyle = '#111111';
                ctx.fillRect(0, 0, width, height);
                
                // Add some depth to the jungle background
                for (let i = 0; i < 20; i++) {
                    const d = Math.floor(20 + Math.random() * 30);
                    ctx.fillStyle = `rgb(${d},${d},${d})`;
                    ctx.beginPath();
                    ctx.ellipse(Math.random() * width, Math.random() * height, 100 + Math.random() * 200, 200 + Math.random() * 400, Math.random() * Math.PI, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else {
                const grad = ctx.createLinearGradient(0, 0, 0, height);
                grad.addColorStop(0, '#0a1a0a');
                grad.addColorStop(1, '#1a2a1a');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, width, height);

                for (let i = 0; i < 50; i++) {
                    ctx.fillStyle = `rgba(10, ${30 + Math.random() * 40}, 10, 0.3)`;
                    ctx.beginPath();
                    ctx.ellipse(Math.random() * width, Math.random() * height, 20 + Math.random() * 100, 50 + Math.random() * 200, Math.random() * Math.PI, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            const drawFigure = (x: number, y: number, scale: number, type: 'hooded' | 'batsuit' | 'spy', depth: number) => {
                ctx.save();
                ctx.translate(x, y);
                ctx.scale(scale, scale);

                if (isDepth) {
                    const d = Math.floor(depth * 255);
                    ctx.fillStyle = `rgb(${d},${d},${d})`;
                    ctx.strokeStyle = `rgb(${d},${d},${d})`;
                } else {
                    ctx.fillStyle = '#050505';
                    ctx.strokeStyle = '#050505';
                }

                ctx.beginPath();
                ctx.moveTo(-30, 100);
                ctx.lineTo(-20, 20);
                ctx.quadraticCurveTo(0, 10, 20, 20);
                ctx.lineTo(30, 100);
                ctx.fill();

                if (type === 'hooded') {
                    ctx.beginPath();
                    ctx.arc(0, 0, 25, Math.PI, 0);
                    ctx.lineTo(25, 30);
                    ctx.lineTo(-25, 30);
                    ctx.closePath();
                    ctx.fill();
                } else if (type === 'batsuit') {
                    ctx.beginPath();
                    ctx.arc(0, 0, 20, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.moveTo(-15, -10);
                    ctx.lineTo(-18, -35);
                    ctx.lineTo(-5, -15);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.moveTo(15, -10);
                    ctx.lineTo(18, -35);
                    ctx.lineTo(5, -15);
                    ctx.fill();
                } else if (type === 'spy') {
                    ctx.beginPath();
                    ctx.arc(0, 0, 22, 0, Math.PI * 2);
                    ctx.fill();
                    if (!isDepth) {
                        ctx.fillStyle = '#111111';
                        ctx.fillRect(-15, -5, 30, 10);
                        ctx.fillStyle = '#222222';
                        ctx.fillRect(-13, -3, 10, 6);
                        ctx.fillRect(3, -3, 10, 6);
                    }
                }

                ctx.restore();
            };

            drawFigure(width * 0.3, height * 0.6, 1.5, 'hooded', 0.6);
            drawFigure(width * 0.5, height * 0.55, 1.8, 'batsuit', 0.8);
            drawFigure(width * 0.7, height * 0.65, 1.4, 'spy', 0.5);

            return canvas;
        };

        const sceneCanvas = generateSceneTexture(1024, 1024, false);
        const depthCanvas = generateSceneTexture(1024, 1024, true);

        const sceneTexture = new THREE.CanvasTexture(sceneCanvas);
        sceneTexture.colorSpace = THREE.SRGBColorSpace;
        const depthTexture = new THREE.CanvasTexture(depthCanvas);

        imageAspectRatio = 1.0;
        programs.display.uniforms.uImage.value = sceneTexture;
        programs.display.uniforms.uDepthMap.value = depthTexture;
        programs.dissipate.uniforms.uDepthMap.value = depthTexture; // For vertex shader
        programs.splat.uniforms.uDepthMap.value = depthTexture; // For vertex shader
        
        // Update all programs with depth map for vertex shader
        Object.values(programs).forEach(p => {
            p.uniforms.uDepthMap = { value: depthTexture };
            p.uniforms.uMouse = { value: pointer };
            p.uniforms.uParallaxStrength = { value: 0.15 }; // Increased strength
        });

        handleResize();
        
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);

        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointermove', onMove);
        container.addEventListener('pointerup', onUp);
        container.addEventListener('pointerleave', onUp);

        const renderStep = (target: THREE.WebGLRenderTarget | null) => {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
        };

        const clock = new THREE.Clock();

        const update = () => {
            requestAnimationFrame(update);
            
            const deltaTime = Math.min(clock.getDelta(), 1 / 30);

            programs.dissipate.uniforms.uSource.value = density.read().texture;
            const dissipation = Math.pow(configRef.current.densityDissipation, deltaTime * 60.0);
            programs.dissipate.uniforms.uDissipation.value = dissipation;
            quad.material = programs.dissipate;
            renderStep(density.write());
            density.swap();

            // Splat on interaction (click/drag) or just mouse move
            const dx = pointer.x - lastPointer.x;
            const dy = pointer.y - lastPointer.y;
            const dxCorrected = dx * imageAspectRatio;
            const distSq = dxCorrected * dxCorrected + dy * dy;

            if (distSq > 0.000001) {
                const dist = Math.sqrt(distSq);
                const radiusInPixels = configRef.current.splatRadius;
                const radiusInUV_Y = radiusInPixels / canvasSizeRef.current.height;
                const stepDistance = radiusInUV_Y * 0.25;
                const steps = Math.max(1, Math.ceil(dist / stepDistance));

                for (let i = 0; i < steps; i++) {
                    const t = (i + 1) / steps;
                    const lerpX = lastPointer.x + dx * t;
                    const lerpY = lastPointer.y + dy * t;
                    
                    programs.splat.uniforms.uTarget.value = density.read().texture;
                    programs.splat.uniforms.uPoint.value.set(lerpX, lerpY);
                    
                    // Stronger splat when interacting (clicking)
                    const intensity = isInteracting ? 1.0 : 0.4;
                    programs.splat.uniforms.uColor.value.set(intensity, intensity, intensity);
                    programs.splat.uniforms.uRadius.value = radiusInUV_Y * radiusInUV_Y;

                    quad.material = programs.splat;
                    renderStep(density.write());
                    density.swap();
                }
            }
            lastPointer.copy(pointer);

            programs.display.uniforms.uDensity.value = density.read().texture;
            programs.display.uniforms.uPoint.value.copy(pointer);
            
            // Update mouse for parallax in all programs
            Object.values(programs).forEach(p => {
                if (p.uniforms.uMouse) p.uniforms.uMouse.value.copy(pointer);
            });

            quad.material = programs.display;
            renderStep(null);
        };

        update();

        return () => {
            if (mountRef.current) mountRef.current.removeChild(renderer.domElement);
            resizeObserver.disconnect();
            container.removeEventListener('pointerdown', onDown);
            container.removeEventListener('pointermove', onMove);
            container.removeEventListener('pointerup', onUp);
            container.removeEventListener('pointerleave', onUp);
            renderer.dispose();
            density.read().dispose();
            density.write().dispose();
            sceneTexture.dispose();
            depthTexture.dispose();
        };
    }, []);

    return (
        <div 
            ref={mountRef} 
            style={{ 
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%', 
                height: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 0,
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                cursor: 'crosshair',
                pointerEvents: 'auto',
                backgroundColor: '#000000'
            }} 
        />
    );
};

export default FluidCanvas;
