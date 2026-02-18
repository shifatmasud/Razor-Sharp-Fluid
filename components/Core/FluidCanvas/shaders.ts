
export const baseVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const splatShader = `
    uniform sampler2D uTarget;
    uniform float uAspectRatio;
    uniform vec3 uColor;
    uniform vec2 uPoint;
    uniform float uRadius;

    varying vec2 vUv;

    void main() {
        vec2 p = vUv - uPoint.xy;
        p.x *= uAspectRatio;
        // Additive blending to "paint" the splat onto the texture
        vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`;

// Shader for fading out the fluid trails over time
export const dissipationShader = `
    uniform sampler2D uSource;
    uniform float uDissipation;
    varying vec2 vUv;

    void main() {
        vec4 color = texture2D(uSource, vUv);
        // Multiply by the dissipation factor to fade out
        color.rgb *= uDissipation;
        gl_FragColor = color;
    }
`;

export const displayShader = `
    uniform sampler2D uDensity;
    uniform sampler2D uImage;
    uniform vec2 uTexelSize;
    uniform vec2 uPoint;
    uniform float uAspectRatio;

    varying vec2 vUv;

    void main() {
        float d = 0.0;
        
        // 3x3 Max Filter (a simple morphological dilation)
        // to fill in small holes and keep the trail solid.
        for (int i = -1; i <= 1; i++) {
            for (int j = -1; j <= 1; j++) {
                vec2 offset = vec2(float(i), float(j)) * uTexelSize;
                d = max(d, texture2D(uDensity, vUv + offset).r);
            }
        }
        
        vec2 p = vUv - uPoint;
        p.x *= uAspectRatio;
        float distSq = dot(p, p);
        
        // The base threshold determines the edge of the fluid.
        // A higher base threshold (0.95) and distance multiplier (2.0)
        // makes the shrink effect more aggressive and noticeable.
        float threshold = 0.95 + distSq * 2.0;

        // Sharp threshold for a clean, vector-like appearance.
        float mask = smoothstep(threshold, threshold + 0.001, d); 
        
        vec4 imageColor = texture2D(uImage, vUv);
        vec3 backgroundColor = vec3(0.0);

        vec3 finalColor = mix(backgroundColor, imageColor.rgb, mask);

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;