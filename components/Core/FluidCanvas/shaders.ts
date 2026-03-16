
export const baseVertexShader = `
    varying vec2 vUv;
    varying vec2 vScreenUv;
    uniform sampler2D uDepthMap;
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
        
        // Sampling depth map for vertex deformation
        float depth = texture2D(uDepthMap, coverUV).r;

        vec3 newPosition = position;
        
        // Physical Z-axis push based on depth map
        // This creates real 3D geometry
        newPosition.z += depth * 0.4 * uTransition; 
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        
        // Calculate screen-space UV for parallax-invariant sampling of the fluid mask
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
    uniform vec2 uResolution;
    uniform float uAspectRatio;
    uniform float uImageAspectRatio;
    uniform float uTransition;

    uniform float uTime;
    uniform float uIsInteracting;

    varying vec2 vUv;
    varying vec2 vScreenUv;

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

    vec3 colorRamp(float t) {
        // Cinematic palette: Deep Shadow Blue -> Teal -> Amber -> Highlight Cream
        vec3 low = vec3(0.02, 0.05, 0.1);
        vec3 mid = vec3(0.1, 0.4, 0.45);
        vec3 high = vec3(1.0, 0.6, 0.2);
        vec3 peak = vec3(1.0, 0.95, 0.8);
        
        vec3 color = mix(low, mid, smoothstep(0.0, 0.4, t));
        color = mix(color, high, smoothstep(0.4, 0.8, t));
        color = mix(color, peak, smoothstep(0.8, 1.0, t));
        return color;
    }

    void main() {
        // Use gl_FragCoord to get the absolute screen position
        // This truly separates the fluid mask from the 3D camera/vertex deformation
        vec2 uvScreen = gl_FragCoord.xy / uResolution;
        
        // Use mesh UV for the image (which has the 3D deformation)
        vec2 uv = vUv;
        vec2 coverUV = getCoverUV(uv, uAspectRatio, uImageAspectRatio);
        
        float d = 0.0;
        // Sample density
        for (int i = -1; i <= 1; i++) {
            for (int j = -1; j <= 1; j++) {
                vec2 offset = vec2(float(i), float(j)) * uTexelSize;
                d = max(d, texture2D(uDensity, uvScreen + offset).r);
            }
        }
        
        // Apply a power curve to the density to make it "compress" inward as it fades
        // This ensures the edges die faster than the core, creating a shrinking effect
        d = pow(d, 1.5);
        
        // Distance in screen space (0-1 range)
        vec2 p = uvScreen - uPoint;
        p.x *= uAspectRatio;
        float distSq = dot(p, p);
        
        float threshold = 0.95 + distSq * 2.0;
        // Sharper mask that contracts as density drops, but with enough feathering for smoothness
        float mask = smoothstep(threshold - 0.05, threshold + 0.05, d); 
        
        vec4 imageColor = texture2D(uImage, coverUV);
        float depthRaw = texture2D(uDepthMap, coverUV).r;
        vec3 depthCinematic = colorRamp(depthRaw);
        
        // Depth Scan Effect
        // A moving wave that highlights depth levels when interacting
        float scanPos = mod(uTime * 0.4, 1.2) - 0.1; 
        
        // Performance tradeoff: wider smoothstep for "diffused" look
        // This simulates a blurry scanline without expensive multi-sampling
        float scanWidth = 0.02;
        float scanEdge = 0.08; 
        float scanLine = smoothstep(scanPos - scanWidth - scanEdge, scanPos - scanWidth, depthRaw) * 
                         (1.0 - smoothstep(scanPos, scanPos + scanEdge, depthRaw));
        
        // Add a secondary faster wave for more tech feel
        float scanPos2 = mod(uTime * 0.8, 1.4) - 0.2;
        float scanLine2 = smoothstep(scanPos2 - 0.04, scanPos2 - 0.01, depthRaw) * 
                          (1.0 - smoothstep(scanPos2, scanPos2 + 0.01, depthRaw));
        
        // White color, subtle opacity, controlled by lerped interaction
        vec3 scanColor = vec3(1.0) * (scanLine * 0.3 + scanLine2 * 0.15) * uIsInteracting;
        
        // Calculate normals from depth map for subtle lighting
        float off = 1.0 / 512.0;
        float dL = texture2D(uDepthMap, coverUV + vec2(-off, 0.0)).r;
        float dR = texture2D(uDepthMap, coverUV + vec2(off, 0.0)).r;
        float dT = texture2D(uDepthMap, coverUV + vec2(0.0, off)).r;
        float dB = texture2D(uDepthMap, coverUV + vec2(0.0, -off)).r;
        
        vec3 normal = normalize(vec3((dL - dR) * uTransition * 2.0, (dB - dT) * uTransition * 2.0, 1.0));
        vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
        float diff = max(dot(normal, lightDir), 0.0);
        float ambient = 0.85;
        float lighting = mix(1.0, ambient + diff * 0.15, uTransition);

        vec3 finalColor = mix(imageColor.rgb, depthCinematic, mask);
        finalColor += scanColor * (1.0 - mask); // Only show scan on revealed depth
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
