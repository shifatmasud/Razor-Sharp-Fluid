
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
        vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`;

export const divergenceShader = `
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;

    varying vec2 vUv;

    void main() {
        float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
        float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
        float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;

        float C = texture2D(uVelocity, vUv).x;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        
        // Divergence
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`;

export const pressureShader = `
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    uniform vec2 uTexelSize;

    varying vec2 vUv;

    void main() {
        float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
        float C = texture2D(uDivergence, vUv).x;

        float pressure = (L + R + B + T - C) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`;

export const gradientSubtractShader = `
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;

    varying vec2 vUv;

    void main() {
        float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;

export const advectionShader = `
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 uTexelSize;
    uniform float uDt;
    uniform float uDissipation;

    varying vec2 vUv;

    void main() {
        vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexelSize;
        vec4 result = texture2D(uSource, coord);
        // Direct multiplication for precise decay control
        gl_FragColor = result * uDissipation;
    }
`;

export const condensationShader = `
    uniform sampler2D uTarget;
    uniform float uAspectRatio;
    uniform vec2 uPoint;
    uniform float uRadius;
    uniform float uStrength;

    varying vec2 vUv;

    void main() {
        vec2 p = vUv - uPoint.xy;
        p.x *= uAspectRatio;

        // Direction from current fragment TO the point
        vec2 dir = uPoint.xy - vUv;
        dir.x *= uAspectRatio;

        float dist = length(dir);
        // Avoid division by zero and normalize
        if (dist > 0.0001) {
            dir /= dist;
        }

        // A smooth falloff for the force field
        float falloff = exp(-dot(p, p) / uRadius);

        // The inward velocity to add
        vec2 inward_vel = dir * uStrength * falloff;

        // Add to the base velocity
        vec2 base = texture2D(uTarget, vUv).xy;
        gl_FragColor = vec4(base + inward_vel, 0.0, 1.0);
    }
`;

export const displayShader = `
    uniform sampler2D uDensity;
    uniform sampler2D uVelocity;
    uniform sampler2D uPressure;
    uniform sampler2D uImage;
    uniform sampler2D uCover;
    uniform int uVariant; // 0: Razor, 1: Soft, 2: Liquid, 3: Pressure, 4: Neon

    varying vec2 vUv;

    void main() {
        vec3 density = texture2D(uDensity, vUv).rgb;
        float d = density.r;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        
        vec3 finalColor = vec3(0.0);
        vec3 cover = texture2D(uCover, vUv).rgb;

        // Variant 0: Razor (High-Threshold / Shrinking Droplet)
        if (uVariant == 0) {
            // Shrinking Droplet Technique:
            // We splat a density of 5.0, but cut off at 0.9.
            // As density decays, the "visible blob" shrinks geometrically.
            // This creates a super clean, curvy, fractal-less sharp trail.
            float mask = smoothstep(0.9, 0.92, d); 
            vec3 img = texture2D(uImage, vUv).rgb;
            finalColor = mix(cover, img, mask);
        }
        // Variant 1: Soft (Smoke Reveal)
        else if (uVariant == 1) {
            float mask = smoothstep(0.0, 0.5, d);
            vec3 img = texture2D(uImage, vUv).rgb;
            finalColor = mix(cover, img, mask);
        }
        // Variant 2: Liquid (Heavy Refraction)
        else if (uVariant == 2) {
            vec2 distUv = vUv + vel * 0.01;
            vec3 img = texture2D(uImage, distUv).rgb;
            float mask = smoothstep(0.0, 0.2, d);
            finalColor = mix(cover, img, mask);
        }
        // Variant 3: Pressure (Debug Visualization)
        else if (uVariant == 3) {
            float p = texture2D(uPressure, vUv).x;
            finalColor = vec3(p * 2.0 + 0.5, 0.0, -p * 2.0 + 0.5);
            finalColor += d * 0.2;
        }
        // Variant 4: Neon (Chromatic Glow)
        else if (uVariant == 4) {
            vec3 img = texture2D(uImage, vUv).rgb;
            float mask = smoothstep(0.05, 0.3, d);
            float edge = smoothstep(0.05, 0.1, d) - smoothstep(0.2, 0.3, d);
            vec3 glow = vec3(0.0, 1.0, 1.0) * edge * 2.0;
            finalColor = mix(cover, img, mask) + glow;
        }

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;
