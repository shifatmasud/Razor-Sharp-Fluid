
export const baseVertexShader = `
    varying vec2 vUv;
    varying vec2 vDisplacement;
    uniform sampler2D uDepthMap;
    uniform vec2 uMouse;
    uniform float uParallaxStrength;

    void main() {
        vUv = uv;
        
        // Vertex displacement parallax
        float depth = texture2D(uDepthMap, vUv).r;
        vec2 displacement = (uMouse - 0.5) * depth * uParallaxStrength;
        vDisplacement = displacement;
        
        vec3 newPosition = position;
        newPosition.xy += displacement;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
`;

export const simVertexShader = `
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
        vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`;

export const dissipationShader = `
    uniform sampler2D uSource;
    uniform float uDissipation;
    varying vec2 vUv;

    void main() {
        vec4 color = texture2D(uSource, vUv);
        color.rgb *= uDissipation;
        gl_FragColor = color;
    }
`;

export const displayShader = `
    uniform sampler2D uDensity;
    uniform sampler2D uImage;
    uniform sampler2D uDepthMap;
    uniform vec2 uTexelSize;
    uniform vec2 uPoint;
    uniform float uAspectRatio;

    varying vec2 vUv;
    varying vec2 vDisplacement;

    void main() {
        // Calculate screen-space UV to sample the static fluid
        // vDisplacement is in [-1, 1] quad space, so we scale by 0.5 for UV space
        vec2 uvScreen = vUv + vDisplacement * 0.5;
        
        float d = 0.0;
        // Sample density using screen-space UV to keep it static
        for (int i = -1; i <= 1; i++) {
            for (int j = -1; j <= 1; j++) {
                vec2 offset = vec2(float(i), float(j)) * uTexelSize;
                d = max(d, texture2D(uDensity, uvScreen + offset).r);
            }
        }
        
        // Distance in screen space
        vec2 p = uvScreen - uPoint;
        p.x *= uAspectRatio;
        float distSq = dot(p, p);
        
        float threshold = 0.95 + distSq * 2.0;
        float mask = smoothstep(threshold, threshold + 0.001, d); 
        
        vec4 imageColor = texture2D(uImage, vUv);
        vec4 depthColor = texture2D(uDepthMap, vUv);
        
        // Visible: the texture
        // Hidden (revealed by trail): the depth map
        vec3 finalColor = mix(imageColor.rgb, depthColor.rgb, mask);

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;
