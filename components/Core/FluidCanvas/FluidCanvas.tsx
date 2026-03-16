
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { 
    baseVertexShader, 
    simVertexShader,
    splatShader, 
    dissipationShader,
    displayShader,
    blurShader,
    blurFragmentShader
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
            depth: true,
            stencil: false
        });
        renderer.setPixelRatio(1);
        const canvas = renderer.domElement;
        container.appendChild(canvas);

        const simRes = 512;
        let imageAspectRatio = 1.0; 

        const textureLoader = new THREE.TextureLoader();
        textureLoader.setCrossOrigin('anonymous');
        
        const sceneTexture = textureLoader.load('https://github.com/shifatmasud/Razor-Sharp-Fluid/raw/refs/heads/main/Imgs/Base.png', (tex) => {
            imageAspectRatio = tex.image.width / tex.image.height;
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
            handleResize();
        });
        sceneTexture.colorSpace = THREE.SRGBColorSpace;
        sceneTexture.minFilter = THREE.LinearMipmapLinearFilter;
        sceneTexture.magFilter = THREE.LinearFilter;
        sceneTexture.wrapS = sceneTexture.wrapT = THREE.ClampToEdgeWrapping;

        const depthTexture = textureLoader.load('https://github.com/shifatmasud/Razor-Sharp-Fluid/raw/refs/heads/main/Imgs/Depth.png', (tex) => {
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        });
        depthTexture.minFilter = THREE.LinearMipmapLinearFilter;
        depthTexture.magFilter = THREE.LinearFilter;
        depthTexture.wrapS = depthTexture.wrapT = THREE.ClampToEdgeWrapping;

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
        const smoothDepthFBO = createFBO(1024, 1024);
        const tempDepthFBO = createFBO(1024, 1024);

        const geometry = new THREE.PlaneGeometry(2, 2, 128, 128);
        const scene = new THREE.Scene();
        const quad = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        scene.add(quad);
        
        // Use PerspectiveCamera for better 3D depth perception
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.z = 2.4142; // Positioned so a 2x2 plane at z=0 fills the screen at FOV 45

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
                uImage: { value: sceneTexture },
                uDepthMap: { value: depthTexture },
                uImageAspectRatio: { value: imageAspectRatio },
                uMouse: { value: new THREE.Vector2(0.5, 0.5) },
                uParallaxStrength: { value: 0.05 },
                uTransition: { value: 0.0 },
            },
            depthWrite: false,
            depthTest: false
        }) as any; 

        const programs = {
            splat: createProgram(splatShader, true),
            dissipate: createProgram(dissipationShader, true),
            display: createProgram(displayShader, false),
            blur: new THREE.ShaderMaterial({
                vertexShader: blurShader,
                fragmentShader: blurFragmentShader,
                uniforms: {
                    uTexture: { value: depthTexture },
                    uResolution: { value: new THREE.Vector2(1024, 1024) },
                    uDirection: { value: new THREE.Vector2(1, 0) }
                },
                depthTest: false,
                depthWrite: false
            })
        };

        const blurScene = new THREE.Scene();
        const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), programs.blur);
        blurScene.add(blurQuad);
        const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const pointer = new THREE.Vector2(0.5, 0.5);
        const lerpedPointer = new THREE.Vector2(0.5, 0.5);
        const lastPointer = new THREE.Vector2(0.5, 0.5);
        const targetParallax = new THREE.Vector2(0.5, 0.5);
        let transition = 0;
        let isInteracting = false;
        let isMouseOver = false;

        const updatePointer = (x: number, y: number) => {
            const rect = canvas.getBoundingClientRect();
            const newX = (x - rect.left) / rect.width;
            const newY = 1.0 - ((y - rect.top) / rect.height);

            // Only update if the pointer is within the canvas bounds
            if (newX >= 0 && newX <= 1 && newY >= 0 && newY <= 1) {
                pointer.set(newX, newY);
                isMouseOver = true;
            } else {
                isMouseOver = false;
            }
        };

        const onDown = (e: PointerEvent) => {
            if(!e.isPrimary) return;
            isInteracting = true;
            isMouseOver = true;
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

        const onLeave = () => {
            isInteracting = false;
            isMouseOver = false;
        };

        const handleResize = () => {
            if (!mountRef.current) return;
            const containerWidth = mountRef.current.clientWidth;
            const containerHeight = mountRef.current.clientHeight;
            const containerAspect = containerWidth / containerHeight;
        
            renderer.setSize(containerWidth, containerHeight);
            renderer.setPixelRatio(1);
            canvasSizeRef.current = { width: containerWidth, height: containerHeight };
            
            camera.aspect = containerAspect;
            camera.updateProjectionMatrix();

            // Scale the quad to fill the screen in perspective view
            quad.scale.set(containerAspect, 1, 1);
            
            programs.splat.uniforms.uAspectRatio.value = containerAspect;
            programs.display.uniforms.uAspectRatio.value = containerAspect;
            programs.display.uniforms.uImageAspectRatio.value = imageAspectRatio;
        };

        // Update all programs with depth map for vertex shader
        Object.values(programs).forEach(p => {
            if (p.uniforms.uDepthMap) p.uniforms.uDepthMap.value = smoothDepthFBO.texture;
            if (p.uniforms.uMouse) p.uniforms.uMouse.value = pointer;
            if (p.uniforms.uParallaxStrength) p.uniforms.uParallaxStrength.value = 0.15; 
        });

        handleResize();
        
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);

        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointermove', onMove);
        container.addEventListener('pointerup', onUp);
        container.addEventListener('pointerleave', onLeave);

        const renderStep = (target: THREE.WebGLRenderTarget | null) => {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
        };

        const clock = new THREE.Clock();

        const update = () => {
            requestAnimationFrame(update);
            
            const deltaTime = Math.min(clock.getDelta(), 1 / 30);

            // Smoothly lerp the pointer for the parallax effect
            if (isMouseOver) {
                targetParallax.copy(pointer);
            } else {
                targetParallax.set(0.5, 0.5);
            }
            
            const lerpFactor = isInteracting ? 0.15 : 0.08;
            lerpedPointer.lerp(targetParallax, lerpFactor);

            // Lerp transition factor
            const targetTransition = isMouseOver ? 1.0 : 0.0;
            transition += (targetTransition - transition) * 0.05;

            // Smoothing pass for depth map (Two-pass separable Gaussian)
            // Pass 1: Horizontal
            programs.blur.uniforms.uTexture.value = depthTexture;
            programs.blur.uniforms.uDirection.value.set(2.0, 0.0); // Slightly wider
            renderer.setRenderTarget(tempDepthFBO);
            renderer.render(blurScene, blurCamera);

            // Pass 2: Vertical
            programs.blur.uniforms.uTexture.value = tempDepthFBO.texture;
            programs.blur.uniforms.uDirection.value.set(0.0, 2.0);
            renderer.setRenderTarget(smoothDepthFBO);
            renderer.render(blurScene, blurCamera);

            programs.dissipate.uniforms.uSource.value = density.read().texture;
            const dissipation = Math.pow(configRef.current.densityDissipation, deltaTime * 60.0);
            programs.dissipate.uniforms.uDissipation.value = dissipation;
            quad.material = programs.dissipate;
            renderStep(density.write());
            density.swap();

            // Splat on interaction (click/drag) or just mouse move
            const dx = pointer.x - lastPointer.x;
            const dy = pointer.y - lastPointer.y;
            const containerAspect = canvasSizeRef.current.width / canvasSizeRef.current.height;
            const dxCorrected = dx * containerAspect;
            const distSq = dxCorrected * dxCorrected + dy * dy;

            if (isMouseOver && distSq > 0.000001) {
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
            
            // Subtle rotation for 3D feel
            quad.rotation.y = (lerpedPointer.x - 0.5) * 0.15;
            quad.rotation.x = (lerpedPointer.y - 0.5) * -0.15;

            // Update mouse and transition for parallax in all programs using the lerped pointer
            Object.values(programs).forEach(p => {
                if (p.uniforms.uMouse) p.uniforms.uMouse.value.copy(lerpedPointer);
                if (p.uniforms.uTransition) p.uniforms.uTransition.value = transition;
                if (p.uniforms.uDepthMap) p.uniforms.uDepthMap.value = smoothDepthFBO.texture;
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
            container.removeEventListener('pointerleave', onLeave);
            renderer.dispose();
            density.read().dispose();
            density.write().dispose();
            smoothDepthFBO.dispose();
            tempDepthFBO.dispose();
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
