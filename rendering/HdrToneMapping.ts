/**
 * Pure GLSL functions: linear sRGB tone curves and extended sRGB encoding.
 * Compose these into your final shader explicitly. No uniforms or material
 * mutations are introduced. Headroom must be finite and at least 1.
 */
export const hdrToneMappingGlsl = /* glsl */`

// three's fitted ACES with an extended highlight shoulder. The SDR fit is
// retained below the blend region; this is an artistic HDR extension.
const mat3 DISPLAY_ACES_INPUT = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 DISPLAY_ACES_OUTPUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 displayAcesFit(vec3 v) {
    return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
}
float displayAcesFitInverse(float y) {
    float a = 0.983729 * y - 1.0;
    float b = 0.4329510 * y - 0.0245786;
    float c = 0.238081 * y + 0.000090537;
    return (-b - sqrt(b * b - 4.0 * a * c)) / (2.0 * a);
}
vec3 hdrAcesToneMapping(vec3 color, float headroom) {
    vec3 v = DISPLAY_ACES_INPUT * (color / 0.6);
    vec3 sdr = displayAcesFit(v);
    if (headroom <= 1.0) return clamp(DISPLAY_ACES_OUTPUT * sdr, 0.0, 1.0);
    const float MID = 0.18 / 0.6;
    float stretch = MID / displayAcesFitInverse(displayAcesFit(vec3(MID)).x / headroom);
    vec3 hdr = headroom * displayAcesFit(v / stretch);
    return clamp(DISPLAY_ACES_OUTPUT * mix(sdr, hdr, smoothstep(0.4, 0.95, sdr)), 0.0, headroom);
}

// Khronos PBR Neutral with its peak raised from 1 to the headroom: below
// 0.76 × headroom only the shadow toe applies; above, colours compress and
// desaturate towards the headroom as the SDR curve does towards 1.
vec3 hdrNeutralToneMapping(vec3 color, float headroom) {
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    float start = 0.76 * headroom;
    if (peak < start) return color;
    float d = headroom - start;
    float newPeak = headroom - d * d / (peak + d - start);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (0.15 * (peak - newPeak) / headroom + 1.0);
    return mix(color, vec3(newPeak), g);
}

// The sRGB transfer function, continued above 1 (the canvas is extended sRGB).
vec3 hdrLinearToSrgb(vec3 linear) {
    vec3 a = abs(linear);
    return sign(linear) * mix(1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, a * 12.92, vec3(lessThanEqual(a, vec3(0.0031308))));
}
`;
