
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { 
    baseVertexShader, 
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
    imageUrl: string;
}

const FluidCanvas: React.FC<FluidCanvasProps> = ({ config, imageUrl }) => {
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
            magFilter: 'linear',
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

        const geometry = new THREE.PlaneGeometry(2, 2);
        const scene = new THREE.Scene();
        const quad = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        scene.add(quad);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const createProgram = (frag: string) => new THREE.ShaderMaterial({
            vertexShader: baseVertexShader,
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
            },
            depthWrite: false,
            depthTest: false
        });

        const programs = {
            splat: createProgram(splatShader),
            dissipate: createProgram(dissipationShader),
            display: createProgram(displayShader)
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
            if(!e.isPrimary || !isInteracting) return;
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

        const textureLoader = new THREE.TextureLoader();
        const imageTexture = textureLoader.load(imageUrl, (texture) => {
            imageAspectRatio = texture.image.naturalWidth / texture.image.naturalHeight;
            programs.display.uniforms.uImage.value = texture;
            handleResize(); // Initial resize once image is loaded
        });
        imageTexture.colorSpace = THREE.SRGBColorSpace;
        
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

            if (isInteracting) {
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
                        programs.splat.uniforms.uColor.value.set(1.0, 1.0, 1.0);
                        programs.splat.uniforms.uRadius.value = radiusInUV_Y * radiusInUV_Y;

                        quad.material = programs.splat;
                        renderStep(density.write());
                        density.swap();
                    }
                }
                lastPointer.copy(pointer);
            }

            programs.display.uniforms.uDensity.value = density.read().texture;
            programs.display.uniforms.uPoint.value.copy(pointer);
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
            imageTexture.dispose();
        };
    }, [imageUrl]);

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
