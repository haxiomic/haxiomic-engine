import type { Texture } from "three";

/**
 * Bloom from a blurred mipmap chain, as GLSL to compose into your own shaders: the sum of mip levels `minLod` up to
 * (not including) `maxLod` of a texture built with `generateBlurredMipmaps()`, level i weighted `i^-falloff`. This is
 * the accumulation `BloomMipmapsMaterial` uses.
 *
 * ```ts
 * const { minLod, maxLod } = bloomLodRange(target.texture, 1)
 * const fragmentShader = `
 *     uniform sampler2D chain;
 *     varying vec2 vUv;
 *     ${bloomAccumulationGlsl({ minLod, maxLod, falloff: -0.138 })}
 *     void main() { gl_FragColor = texture2D(chain, vUv) + bloomAccumulation(chain, vUv) * 0.05; }
 * `
 * ```
 *
 * The baked form folds the weights into constants and reads pairs of levels with one trilinear fetch, so the texture
 * must use `LinearMipmapLinearFilter`; rebuild the shader when the level range or falloff changes. The dynamic form
 * takes them as arguments.
 */
export type BloomAccumulationOptions = {
    /** First level summed, usually 1. Clamp with `bloomLodRange()` */
    minLod: number,
    /** Levels below this are summed. `bloomLodRange()` gives the last level of the chain */
    maxLod: number,
    /** Level i is weighted `i^-falloff` */
    falloff: number,
    /** Read the finest n levels with a cubic B-spline (4 fetches each) instead of bilinear. @default 0 */
    smoothLevels?: number,
    /** Name of the GLSL function. @default 'bloomAccumulation' */
    name?: string,
}

/**
 * GLSL: `vec4 sampleLevelBSpline(sampler2D tex, vec2 uv, float lod)`, a cubic B-spline read of one mip level with
 * 4 bilinear fetches. Guarded, so it can be included more than once.
 */
export const bloomBSplineGlsl = /*glsl*/`
#ifndef BLOOM_BSPLINE_GLSL
#define BLOOM_BSPLINE_GLSL
vec4 sampleLevelBSpline(sampler2D tex, vec2 uv, float lod) {
    vec2 size = vec2(textureSize(tex, int(lod)));
    vec2 inv = 1.0 / size;
    vec2 tc = uv * size - 0.5;
    vec2 base = floor(tc);
    vec2 f = tc - base;
    vec2 f2 = f * f, f3 = f2 * f;
    vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    vec2 w3 = f3 / 6.0;
    vec2 g0 = w0 + w1, g1 = w2 + w3;
    vec2 h0 = (base - 0.5 + w1 / g0) * inv;
    vec2 h1 = (base + 1.5 + w3 / g1) * inv;
    return
        g0.y * (g0.x * textureLod(tex, vec2(h0.x, h0.y), lod) + g1.x * textureLod(tex, vec2(h1.x, h0.y), lod)) +
        g1.y * (g0.x * textureLod(tex, vec2(h0.x, h1.y), lod) + g1.x * textureLod(tex, vec2(h1.x, h1.y), lod));
}
#endif
`;

/**
 * GLSL function `vec4 <name>(sampler2D mipmapSource, vec2 vUv)` returning the bloom sum with the level range and
 * weights baked in.
 */
export function bloomAccumulationGlsl(options: BloomAccumulationOptions): string {
    const smoothLevels = sanitizeSmoothLevels(options.smoothLevels);
    const name = options.name ?? 'bloomAccumulation';
    return /*glsl*/`${smoothLevels > 0 ? bloomBSplineGlsl : ''}
vec4 ${name}(sampler2D mipmapSource, vec2 vUv) {
    vec4 bloom = vec4(0.0);
${bloomAccumulationStatements({ ...options, smoothLevels })}
    return bloom;
}
`;
}

/**
 * GLSL function `vec4 <name>(sampler2D mipmapSource, vec2 vUv, float firstLod, float endLod, float falloff)`: the
 * same sum with the range and falloff as arguments (`firstLod` = minLod, `endLod` = maxLod), one fetch per level.
 */
export function bloomAccumulationDynamicGlsl(options: { smoothLevels?: number, name?: string } = {}): string {
    const smoothLevels = sanitizeSmoothLevels(options.smoothLevels);
    const name = options.name ?? 'bloomAccumulation';
    return /*glsl*/`${smoothLevels > 0 ? bloomBSplineGlsl : ''}
vec4 ${name}(sampler2D mipmapSource, vec2 vUv, float firstLod, float endLod, float falloff) {
    vec4 bloom = vec4(0.0);
${bloomAccumulationDynamicStatements(smoothLevels, { minLod: 'firstLod', maxLod: 'endLod', falloff: 'falloff' })}
    return bloom;
}
`;
}

/**
 * The level range to sum for a mipmap chain: `maxLod` is the chain's last level (0 when it has no mip levels) and
 * `minLod` is clamped to it. Read again when the texture is resized, as its level count changes.
 */
export function bloomLodRange(mipmapSource: Texture | null | undefined, minLod: number): { minLod: number, maxLod: number } {
    const mipmapCount: number = mipmapSource?.mipmaps?.length ?? 0;
    const maxLod = Math.max(0, mipmapCount - 1);
    return { minLod: Math.min(minLod, maxLod), maxLod };
}

function sanitizeSmoothLevels(smoothLevels: number | undefined): number {
    return Math.max(0, Math.floor(smoothLevels ?? 0));
}

/**
 * Statements adding the baked sum into `bloom`, reading `mipmapSource` at `vUv`. Shared with `BloomMipmapsMaterial`.
 * Pairs of levels are read with one trilinear fetch.
 */
export function bloomAccumulationStatements(
    { minLod, maxLod, falloff, smoothLevels = 0 }: { minLod: number, maxLod: number, falloff: number, smoothLevels?: number }
): string {
    let glsl = '';
    const epsilon = 1e-6; // Small value to avoid log(0)/pow(0, negative)

    // the finest smoothLevels levels: one B-spline read each
    let currentLod = minLod;
    for (; currentLod < Math.min(minLod + smoothLevels, maxLod); currentLod++) {
        const W = Math.pow(Math.max(currentLod, epsilon), -falloff);
        glsl += /*glsl*/ `bloom += sampleLevelBSpline(mipmapSource, vUv, ${currentLod.toFixed(1)}) * ${W.toFixed(5)};\n`;
    }

    // Loop over pairs of levels
    for (; currentLod < maxLod - 1; currentLod += 2) {
        const lod1 = currentLod;
        const lod2 = currentLod + 1.0;

        // Calculate weights W1 and W2
        // Handle lod = 0 carefully
        const w1_base = Math.max(lod1, epsilon);
        const w2_base = Math.max(lod2, epsilon); // lod2 is always >= 1 if minLod >= 0

        let W1 = Math.pow(w1_base, -falloff);
        const W2 = Math.pow(w2_base, -falloff);

        // Correct W1 specifically for pow(0, 0) case if falloff is exactly 0
        if (Math.abs(lod1) < epsilon && Math.abs(falloff) < epsilon) {
            W1 = 1.0;
        }

        const W_total = W1 + W2;

        // Proceed only if the combined weight is significant
        if (W_total > epsilon) {
            // Calculate fractional offset f = W2 / W_total
            const f = W2 / W_total;
            // Clamp f just in case of numerical instability, although unlikely here
            const clamped_f = Math.max(0.0, Math.min(1.0, f));

            // Calculate the LOD to sample at for trilinear blend
            const sampleLod = lod1 + clamped_f;

            // The correction factor K is the total weight
            const K = W_total;

            // Add GLSL line for this pair
            // Use higher precision for sampleLod and K
            glsl += /*glsl*/ `bloom += textureLod(mipmapSource, vUv, ${sampleLod.toFixed(5)}) * ${K.toFixed(5)};\n`;
        }
    }

    // Handle the last level if the number of levels was odd
    // This occurs if currentLod stopped exactly at maxLod - 1
    if (currentLod < maxLod) { // Equivalent to checking currentLod == maxLod - 1
        const lastLod = currentLod; // which is maxLod - 1

        // Calculate weight for the last level
        const W_last_base = Math.max(lastLod, epsilon);
        let W_last = Math.pow(W_last_base, -falloff);

        // Correct W_last specifically for pow(0, 0) case
        if (Math.abs(lastLod) < epsilon && Math.abs(falloff) < epsilon) {
            W_last = 1.0;
        }

        // Add GLSL line only if weight is significant
        if (W_last > epsilon) {
            glsl += /*glsl*/ `bloom += textureLod(mipmapSource, vUv, ${lastLod.toFixed(1)}) * ${W_last.toFixed(5)};\n`;
        }
    }

    return glsl;
}

/**
 * Statements adding the sum into `bloom`, one fetch per level, reading the range and falloff from the GLSL names
 * given (by default `minLod`, `maxLod` and `bloomFalloff`). Shared with `BloomMipmapsMaterial`.
 */
export function bloomAccumulationDynamicStatements(
    smoothLevels: number = 0,
    names: { minLod: string, maxLod: string, falloff: string } = { minLod: 'minLod', maxLod: 'maxLod', falloff: 'bloomFalloff' },
): string {
    const { minLod, maxLod, falloff } = names;
    return smoothLevels > 0 ? /*glsl*/`
    for (float i = ${minLod}; i < ${maxLod}; i++) {
        bloom += (i < ${minLod} + ${smoothLevels.toFixed(1)} ? sampleLevelBSpline(mipmapSource, vUv, i) : textureLod(mipmapSource, vUv, i)) * pow(i, -${falloff});
    }` : /*glsl*/`
    for (float i = ${minLod}; i < ${maxLod}; i++) {
        bloom += textureLod(mipmapSource, vUv, i) * pow(i, -${falloff});
    }`;
}
