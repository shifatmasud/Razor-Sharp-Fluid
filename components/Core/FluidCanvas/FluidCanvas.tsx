
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { 
    baseVertexShader, 
    advectionShader, 
    splatShader, 
    divergenceShader, 
    pressureShader, 
    gradientSubtractShader, 
    condensationShader,
    displayShader 
} from './shaders';

interface FluidConfig {
    densityDissipation: number;
    velocityDissipation: number;
    splatRadius: number;
    sizingMode?: 'CLAMP' | 'CONTAIN' | 'COVER';
}

interface FluidCanvasProps {
    config: FluidConfig;
    onLog: (msg: string) => void;
    variant: number;
}

const FluidCanvas: React.FC<FluidCanvasProps> = ({ config, onLog, variant }) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const configRef = useRef(config);
    const variantRef = useRef(variant);

    const condensationStateRef = useRef({
        active: false,
        point: new THREE.Vector2(),
        timer: 0,
    });

    // Refs to store textures so we can update their transform
    const imageTextureRef = useRef<THREE.Texture | null>(null);
    const coverTextureRef = useRef<THREE.Texture | null>(null);

    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { variantRef.current = variant; }, [variant]);

    // Helper to update texture matrix for sizing modes
    const updateTextureTransform = (texture: THREE.Texture, width: number, height: number) => {
        if (!texture.image || !texture.image.width) return;
        
        const mode = configRef.current.sizingMode || 'COVER';
        const imageAspect = texture.image.width / texture.image.height;
        const screenAspect = width / height;
        
        // Reset
        texture.center.set(0.5, 0.5);
        texture.rotation = 0;
        texture.matrixAutoUpdate = true;
        
        if (mode === 'CONTAIN') {
            // Fit entire image in screen (Letterboxing)
            if (screenAspect > imageAspect) {
                // Screen is wider: constrain width to match image aspect
                // To make image smaller horizontally (to reveal sides), we increase repeat.x
                texture.repeat.set(screenAspect / imageAspect, 1);
            } else {
                // Screen is taller: constrain height
                texture.repeat.set(1, imageAspect / screenAspect);
            }
        } else if (mode === 'COVER') {
             // Fill screen (Crop)
             if (screenAspect > imageAspect) {
                 // Screen is wider: zoom to width
                 // To zoom in vertically (crop top/bottom), we reduce repeat.y
                 texture.repeat.set(1, imageAspect / screenAspect);
            } else {
                 // Screen is taller: zoom to height
                 texture.repeat.set(screenAspect / imageAspect, 1);
            }
        } else {
            // CLAMP - Default to 1:1 mapping
            texture.repeat.set(1, 1);
        }
    };

    // Effect to handle Sizing Mode updates
    useEffect(() => {
        if (!mountRef.current) return;
        const { width, height } = mountRef.current.getBoundingClientRect();
        if (imageTextureRef.current) updateTextureTransform(imageTextureRef.current, width, height);
        if (coverTextureRef.current) updateTextureTransform(coverTextureRef.current, width, height);
    }, [config.sizingMode]);

    useEffect(() => {
        if (!mountRef.current) return;
        const container = mountRef.current;
        
        onLog("Initializing Multi-Mode Fluid Solver...");

        const renderer = new THREE.WebGLRenderer({ 
            antialias: false, 
            alpha: false, 
            powerPreference: "high-performance",
            depth: false,
            stencil: false
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        // High resolution for sharp edges
        const simRes = 512; 
        const aspectRatio = window.innerWidth / window.innerHeight;

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
        let velocity = createDoubleFBO(simRes, simRes);
        let divergence = createFBO(simRes, simRes);
        let pressure = createDoubleFBO(simRes, simRes);

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
                uDt: { value: 0.016 },
                uAspectRatio: { value: aspectRatio },
                uDissipation: { value: 1.0 },
                uVelocity: { value: null },
                uSource: { value: null },
                uTarget: { value: null },
                uColor: { value: new THREE.Vector3() },
                uPoint: { value: new THREE.Vector2() },
                uRadius: { value: 0.01 },
                uStrength: { value: 0.0 },
                uDivergence: { value: null },
                uPressure: { value: null },
                uImage: { value: null },
                uCover: { value: null },
                uDensity: { value: null },
                uVariant: { value: 0 }
            },
            depthWrite: false,
            depthTest: false
        });

        const programs = {
            advection: createProgram(advectionShader),
            splat: createProgram(splatShader),
            divergence: createProgram(divergenceShader),
            pressure: createProgram(pressureShader),
            gradientSubtract: createProgram(gradientSubtractShader),
            condensation: createProgram(condensationShader),
            display: createProgram(displayShader)
        };

        const loader = new THREE.TextureLoader();
        
        const setupTexture = (url: string, ref: React.MutableRefObject<THREE.Texture | null>) => {
            return loader.load(url, (tex) => {
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.wrapS = THREE.ClampToEdgeWrapping;
                tex.wrapT = THREE.ClampToEdgeWrapping;
                ref.current = tex;
                updateTextureTransform(tex, window.innerWidth, window.innerHeight);
            });
        };

        programs.display.uniforms.uImage.value = setupTexture(
            'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?q=80&w=2670&auto=format&fit=crop', 
            imageTextureRef
        );
        programs.display.uniforms.uCover.value = setupTexture(
            'https://images.unsplash.com/photo-1621193677209-c3060b6d0329?q=80&w=2660&auto=format&fit=crop', 
            coverTextureRef
        );

        // Input Handling
        const pointer = new THREE.Vector2(0.5, 0.5);
        const lastPointer = new THREE.Vector2(0.5, 0.5);
        let isInteracting = false;

        const updatePointer = (x: number, y: number) => {
            pointer.set(x / window.innerWidth, 1.0 - (y / window.innerHeight));
        };

        const onDown = (e: PointerEvent) => {
            if(!e.isPrimary) return;
            isInteracting = true;
            condensationStateRef.current.active = false; // Cancel any ongoing condensation
            updatePointer(e.clientX, e.clientY);
            
            // Offset lastPointer slightly to force a splat on a static click
            // The simulation loop compares pointer vs lastPointer to generate velocity.
            lastPointer.set(pointer.x - 0.01, pointer.y - 0.01);
            
            (e.target as Element).setPointerCapture(e.pointerId);
        };

        const onMove = (e: PointerEvent) => {
            if(!e.isPrimary) return;
            updatePointer(e.clientX, e.clientY);
        };

        const onUp = (e: PointerEvent) => { 
            isInteracting = false; 
            condensationStateRef.current = {
                active: true,
                point: new THREE.Vector2().copy(pointer),
                timer: 90 // Run for ~1.5 seconds at 60fps
            };
            if (e.target instanceof Element && e.target.hasPointerCapture(e.pointerId)) {
                e.target.releasePointerCapture(e.pointerId);
            }
        };

        const onResize = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            renderer.setSize(w, h);
            programs.display.uniforms.uAspectRatio.value = w / h;
            
            if (imageTextureRef.current) updateTextureTransform(imageTextureRef.current, w, h);
            if (coverTextureRef.current) updateTextureTransform(coverTextureRef.current, w, h);
        };

        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointermove', onMove);
        container.addEventListener('pointerup', onUp);
        container.addEventListener('pointerleave', onUp);
        window.addEventListener('resize', onResize);

        const renderStep = (target: THREE.WebGLRenderTarget | null) => {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
        };

        let lastTime = Date.now();

        const update = () => {
            const now = Date.now();
            let dt = Math.min((now - lastTime) / 1000, 0.016);
            lastTime = now;

            const currentVariant = variantRef.current;
            
            const condensationState = condensationStateRef.current;
            if (condensationState.active && condensationState.timer > 0) {
                programs.condensation.uniforms.uTarget.value = velocity.read().texture;
                programs.condensation.uniforms.uPoint.value.copy(condensationState.point);
                
                // Strength fades out as timer decreases
                const strength = (condensationState.timer / 90.0) * 0.03;
                programs.condensation.uniforms.uStrength.value = strength;
                programs.condensation.uniforms.uRadius.value = 0.02; // A bit larger than a splat

                quad.material = programs.condensation;
                renderStep(velocity.write());
                velocity.swap();

                condensationState.timer--;
                if (condensationState.timer <= 0) {
                    condensationState.active = false;
                }
            }


            if (isInteracting) {
                const dx = pointer.x - lastPointer.x;
                const dy = pointer.y - lastPointer.y;
                const distSq = dx*dx + dy*dy;

                // Reduced threshold for interactivity
                if (distSq > 0.000001) { 
                    const dist = Math.sqrt(distSq);
                    const steps = Math.max(1, Math.ceil(dist / 0.002));

                    for (let i = 0; i < steps; i++) {
                        const t = (i + 1) / steps;
                        const lerpX = lastPointer.x + dx * t;
                        const lerpY = lastPointer.y + dy * t;

                        programs.splat.uniforms.uTarget.value = velocity.read().texture;
                        programs.splat.uniforms.uPoint.value.set(lerpX, lerpY);
                        programs.splat.uniforms.uColor.value.set(dx * 5000.0, dy * 5000.0, 1.0);
                        programs.splat.uniforms.uRadius.value = configRef.current.splatRadius / 10000.0;
                        quad.material = programs.splat;
                        renderStep(velocity.write());
                        velocity.swap();

                        programs.splat.uniforms.uTarget.value = density.read().texture;
                        programs.splat.uniforms.uPoint.value.set(lerpX, lerpY);
                        programs.splat.uniforms.uColor.value.set(5.0, 5.0, 5.0);
                        programs.splat.uniforms.uRadius.value = configRef.current.splatRadius / 5000.0;
                        quad.material = programs.splat;
                        renderStep(density.write());
                        density.swap();
                    }
                }
                lastPointer.copy(pointer);
            }

            if (currentVariant !== 0) {
                programs.divergence.uniforms.uVelocity.value = velocity.read().texture;
                quad.material = programs.divergence;
                renderStep(divergence);

                programs.pressure.uniforms.uDivergence.value = divergence.texture;
                quad.material = programs.pressure;
                for (let i = 0; i < 50; i++) {
                    programs.pressure.uniforms.uPressure.value = pressure.read().texture;
                    renderStep(pressure.write());
                    pressure.swap();
                }

                programs.gradientSubtract.uniforms.uPressure.value = pressure.read().texture;
                programs.gradientSubtract.uniforms.uVelocity.value = velocity.read().texture;
                quad.material = programs.gradientSubtract;
                renderStep(velocity.write());
                velocity.swap();
            }

            programs.advection.uniforms.uDt.value = dt;
            programs.advection.uniforms.uDissipation.value = configRef.current.velocityDissipation; 
            programs.advection.uniforms.uSource.value = velocity.read().texture;
            programs.advection.uniforms.uVelocity.value = velocity.read().texture;
            quad.material = programs.advection;
            renderStep(velocity.write());
            velocity.swap();

            programs.advection.uniforms.uDissipation.value = configRef.current.densityDissipation;
            programs.advection.uniforms.uSource.value = density.read().texture;
            programs.advection.uniforms.uVelocity.value = velocity.read().texture;
            quad.material = programs.advection;
            renderStep(density.write());
            density.swap();

            programs.display.uniforms.uDensity.value = density.read().texture;
            programs.display.uniforms.uVelocity.value = velocity.read().texture;
            programs.display.uniforms.uPressure.value = pressure.read().texture;
            programs.display.uniforms.uVariant.value = currentVariant;
            quad.material = programs.display;
            renderStep(null);

            requestAnimationFrame(update);
        };

        update();

        return () => {
            if (mountRef.current) mountRef.current.removeChild(renderer.domElement);
            container.removeEventListener('pointerdown', onDown);
            container.removeEventListener('pointermove', onMove);
            container.removeEventListener('pointerup', onUp);
            container.removeEventListener('pointerleave', onUp);
            window.removeEventListener('resize', onResize);
            renderer.dispose();
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
                zIndex: 0,
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                cursor: 'crosshair',
                pointerEvents: 'auto'
            }} 
        />
    );
};

export default FluidCanvas;
