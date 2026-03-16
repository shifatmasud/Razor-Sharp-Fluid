
export const baseVertexShader = `
    varying vec2 vUv;
    varying vec2 vScreenUv;
    varying vec2 vDisplacement;
    uniform sampler2D uDepthMap;
    uniform vec2 uMouse;
    uniform float uParallaxStrength;
    uniform float uAspectRatio;
    uniform float uImageAspectRatio;
    uniform float uTransition;

    vec2 getCoverUV(vec2 uv, float screenAspect, float imageAspect) {
        vec2 res = uv;
        if (screenAspect > imageAspect) {
            float scale = screenAspect / imageAspect;
            res.y = (uv.y - 0.5) / scale + 0.5;
        } else {
            float scale = imageAspect / screenAspect;
            res.x = (uv.x - 0.5) / scale + 0.5;
        }
        return res;
    }

    void main() {
        vUv = uv;
        vec2 coverUV = getCoverUV(uv, uAspectRatio, uImageAspectRatio);
        
        // Sampling depth map
        float depth = texture2D(uDepthMap, coverUV).r;

        // Pure physical vertex deformation
        // No artificial XY displacement, no rotation-based parallax
        // The depth is expressed purely through Z-axis displacement
        vDisplacement = vec2(0.0);
        
        vec3 newPosition = position;
        
        // Physical Z-axis push based on depth map
        // This creates real 3D geometry
        newPosition.z += depth * 0.4 * uTransition; 
        
        vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Calculate screen-space UV for parallax-invariant sampling
        vScreenUv = (gl_Position.xy / gl_Position.w) * 0.5 + 0.5;
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
    uniform float uImageAspectRatio;
    uniform float uTransition;

    varying vec2 vUv;
    varying vec2 vScreenUv;
    varying vec2 vDisplacement;

    vec2 getCoverUV(vec2 uv, float screenAspect, float imageAspect) {
        vec2 res = uv;
        if (screenAspect > imageAspect) {
            float scale = screenAspect / imageAspect;
            res.y = (uv.y - 0.5) / scale + 0.5;
        } else {
            float scale = imageAspect / screenAspect;
            res.x = (uv.x - 0.5) / scale + 0.5;
        }
        return res;
    }

    void main() {
        vec2 coverUV = getCoverUV(vUv, uAspectRatio, uImageAspectRatio);
        
        // Use screen-space UV to sample the fluid density
        // This ensures the fluid trail ignores the 3D vertex parallax
        vec2 uvScreen = vScreenUv;
        
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
        
        vec4 imageColor = texture2D(uImage, coverUV);
        vec4 depthColor = texture2D(uDepthMap, coverUV);
        
        // Calculate normals from depth map for subtle lighting
        float off = 1.0 / 512.0;
        float dL = texture2D(uDepthMap, coverUV + vec2(-off, 0.0)).r;
        float dR = texture2D(uDepthMap, coverUV + vec2(off, 0.0)).r;
        float dT = texture2D(uDepthMap, coverUV + vec2(0.0, off)).r;
        float dB = texture2D(uDepthMap, coverUV + vec2(0.0, -off)).r;
        
        // Scale normal by transition to flatten it when inactive
        vec3 normal = normalize(vec3((dL - dR) * uTransition * 2.0, (dB - dT) * uTransition * 2.0, 1.0));
        vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
        float diff = max(dot(normal, lightDir), 0.0);
        float ambient = 0.85;
        float lighting = mix(1.0, ambient + diff * 0.15, uTransition);

        // Visible: the texture
        // Hidden (revealed by trail): the depth map
        vec3 finalColor = mix(imageColor.rgb, depthColor.rgb, mask);
        finalColor *= lighting;

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

export const blurShader = `
    varying vec2 vUv;
    void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

export const blurFragmentShader = `
    precision highp float;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;
    uniform vec2 uDirection;
    varying vec2 vUv;
    
    void main() {
        vec2 off = uDirection / uResolution;
        float result = 0.0;
        
        // 9-tap Gaussian blur
        result += texture2D(uTexture, vUv - off * 4.0).r * 0.0162162162;
        result += texture2D(uTexture, vUv - off * 3.0).r * 0.0540540541;
        result += texture2D(uTexture, vUv - off * 2.0).r * 0.1216216216;
        result += texture2D(uTexture, vUv - off * 1.0).r * 0.1945945946;
        result += texture2D(uTexture, vUv).r * 0.2270270270;
        result += texture2D(uTexture, vUv + off * 1.0).r * 0.1945945946;
        result += texture2D(uTexture, vUv + off * 2.0).r * 0.1216216216;
        result += texture2D(uTexture, vUv + off * 3.0).r * 0.0540540541;
        result += texture2D(uTexture, vUv + off * 4.0).r * 0.0162162162;
        
        gl_FragColor = vec4(vec3(result), 1.0);
    }
`;
