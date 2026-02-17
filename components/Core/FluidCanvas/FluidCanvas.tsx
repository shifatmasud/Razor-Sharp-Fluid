
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
}

const FluidCanvas: React.FC<FluidCanvasProps> = ({ config }) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const configRef = useRef(config);

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
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        const simRes = 512; 
        let aspectRatio = window.innerWidth / window.innerHeight;

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
                uAspectRatio: { value: aspectRatio },
                uTarget: { value: null },
                uColor: { value: new THREE.Vector3() },
                uPoint: { value: new THREE.Vector2() },
                uRadius: { value: 0.01 },
                uSource: { value: null },
                uDissipation: { value: 0.98 },
                uDensity: { value: null },
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
            pointer.set(x / window.innerWidth, 1.0 - (y / window.innerHeight));
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

        const onResize = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            renderer.setSize(w, h);
            aspectRatio = w / h;
            programs.splat.uniforms.uAspectRatio.value = aspectRatio;
            programs.display.uniforms.uAspectRatio.value = aspectRatio;
        };

        onResize();

        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointermove', onMove);
        container.addEventListener('pointerup', onUp);
        container.addEventListener('pointerleave', onUp);
        window.addEventListener('resize', onResize);

        const renderStep = (target: THREE.WebGLRenderTarget | null) => {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
        };

        const clock = new THREE.Clock();

        const update = () => {
            requestAnimationFrame(update);
            
            const deltaTime = Math.min(clock.getDelta(), 1 / 30); // Cap delta to prevent large jumps on tab resume

            // 1. Dissipate the existing density
            programs.dissipate.uniforms.uSource.value = density.read().texture;
            
            // Frame-rate independent dissipation
            // Assumes config.densityDissipation was tuned for 60fps.
            const dissipation = Math.pow(configRef.current.densityDissipation, deltaTime * 60.0);
            programs.dissipate.uniforms.uDissipation.value = dissipation;

            quad.material = programs.dissipate;
            renderStep(density.write());
            density.swap();

            // 2. Splat new density if interacting
            if (isInteracting) {
                const dx = pointer.x - lastPointer.x;
                const dy = pointer.y - lastPointer.y;

                // Correct distance for aspect ratio. This treats the distance
                // in a space that is uniform, matching how it appears on screen.
                const dxCorrected = dx * aspectRatio;
                const distSq = dxCorrected * dxCorrected + dy * dy;

                if (distSq > 0.000001) {
                    const dist = Math.sqrt(distSq);

                    // The splat radius is defined in pixels. To compare it with our corrected
                    // distance, we need to convert it to the same coordinate space. Since our
                    // corrected distance is relative to screen height, we do the same for the radius.
                    const radiusInPixels = configRef.current.splatRadius;
                    const radiusInUV_Y = radiusInPixels / window.innerHeight;

                    // The interpolation step distance must be smaller than the radius to ensure overlap.
                    const stepDistance = radiusInUV_Y * 0.25; // Quarter radius for smoother, overlapping splats
                    const steps = Math.max(1, Math.ceil(dist / stepDistance));

                    for (let i = 0; i < steps; i++) {
                        const t = (i + 1) / steps;
                        const lerpX = lastPointer.x + dx * t;
                        const lerpY = lastPointer.y + dy * t;
                        
                        programs.splat.uniforms.uTarget.value = density.read().texture;
                        programs.splat.uniforms.uPoint.value.set(lerpX, lerpY);
                        programs.splat.uniforms.uColor.value.set(1.0, 1.0, 1.0);
                        
                        // The splat radius uniform expects a squared value.
                        programs.splat.uniforms.uRadius.value = radiusInUV_Y * radiusInUV_Y;

                        quad.material = programs.splat;
                        renderStep(density.write());
                        density.swap();
                    }
                }
                lastPointer.copy(pointer);
            }

            // 3. Render to screen
            programs.display.uniforms.uDensity.value = density.read().texture;
            programs.display.uniforms.uPoint.value.copy(pointer);
            quad.material = programs.display;
            renderStep(null);
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
            density.read().dispose();
            density.write().dispose();
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
                pointerEvents: 'auto',
                backgroundColor: '#000000'
            }} 
        />
    );
};

export default FluidCanvas;
