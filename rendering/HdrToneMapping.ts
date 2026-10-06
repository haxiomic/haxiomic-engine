import { ACESFilmicToneMapping, NeutralToneMapping, type ShaderMaterial, type ToneMapping } from "three";

/** Linear sRGB curves and sign-preserving extended sRGB encoding for HDR output. */
export const hdrToneMappingGlsl = /* glsl */`
uniform bool displayHdr;
uniform float displayHeadroom;
#ifndef TONE_MAPPING
// three declares this only with tone mapping on; the HDR branch runs only then.
uniform float toneMappingExposure;
#endif
uniform int displayToneCurve; // 0: ACES (ACESFilmicToneMapping), 1: PBR Neutral (NeutralToneMapping)

// three's fitted ACES with its highlights extended to the headroom. Up to the
// upper mid-tones it is the SDR curve; above, it blends into a copy stretched
// so its limit is the headroom while mid grey stays where SDR puts it.
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
vec3 displayAcesHdr(vec3 color, float headroom) {
    vec3 v = DISPLAY_ACES_INPUT * (color / 0.6);
    vec3 sdr = displayAcesFit(v);
    const float MID = 0.18 / 0.6;
    float stretch = MID / displayAcesFitInverse(displayAcesFit(vec3(MID)).x / headroom);
    vec3 hdr = headroom * displayAcesFit(v / stretch);
    return clamp(DISPLAY_ACES_OUTPUT * mix(sdr, hdr, smoothstep(0.4, 0.95, sdr)), 0.0, headroom);
}

// Khronos PBR Neutral with its peak raised from 1 to the headroom: below
// 0.76 × headroom only the shadow toe applies; above, colours compress and
// desaturate towards the headroom as the SDR curve does towards 1.
vec3 displayNeutralHdr(vec3 color, float headroom) {
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
vec3 displayExtendedSrgb(vec3 linear) {
    vec3 a = abs(linear);
    return sign(linear) * mix(1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, a * 12.92, vec3(lessThanEqual(a, vec3(0.0031308))));
}
`;


const outputChunks = /#include <tonemapping_fragment>\s*#include <colorspace_fragment>/;
const patched = new WeakSet<ShaderMaterial>();

/**
 * Extend a final ShaderMaterial pass from linear sRGB to extended sRGB.
 * Call before rendering to the canvas, with HdrOutput.targetHeadroom.
 * Intermediate targets must preserve linear values above 1 (HalfFloatType).
 * ACES and Neutral are supported; other curves keep three's SDR output.
 * A headroom of 1 uses the original chunks, exactly preserving SDR.
 * Do not use this helper for Display P3 or linear/Rec.2020 output.
 */
export function applyHdrToneMapping(material: ShaderMaterial, toneMapping: ToneMapping, headroom: number): void {
    if (!Number.isFinite(headroom) || headroom < 1) throw new RangeError('HDR headroom must be finite and at least 1');
    const curve = toneMapping === ACESFilmicToneMapping ? 0 : toneMapping === NeutralToneMapping ? 1 : -1;
    const active = headroom > 1 && curve >= 0 && material.toneMapped;
    if (!active && !patched.has(material)) return;
    if (!patched.has(material)) {
        if (!outputChunks.test(material.fragmentShader)) throw new Error('HDR output requires adjacent tone-mapping and colour-space shader chunks');
        material.fragmentShader = hdrToneMappingGlsl + material.fragmentShader.replace(outputChunks, /* glsl */`
            if (displayHdr) {
                vec3 mapped = displayToneCurve == 1
                    ? displayNeutralHdr(gl_FragColor.rgb * toneMappingExposure, displayHeadroom)
                    : displayAcesHdr(gl_FragColor.rgb * toneMappingExposure, displayHeadroom);
                gl_FragColor.rgb = displayExtendedSrgb(mapped);
            } else {
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `);
        material.uniforms.displayHdr = { value: false };
        material.uniforms.displayHeadroom = { value: 1 };
        material.uniforms.displayToneCurve = { value: 0 };
        material.needsUpdate = true;
        patched.add(material);
    }
    material.uniforms.displayHdr.value = active;
    material.uniforms.displayHeadroom.value = headroom;
    material.uniforms.displayToneCurve.value = Math.max(0, curve);
}
