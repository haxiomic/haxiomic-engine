import { Texture, Uniform } from "three";
import { ShaderMaterial } from "./ShaderMaterial.js";

/**
 * Blends mipmaps over level 0
 *
 * Use with `generateBlurredMipmaps()` to create a blurred mipmap chain
 *
 * **Requires minFilter set to `LINEAR_MIPMAP_LINEAR` filtering**
 *
 * Or set `bloomSource` to the result of `generatePyramidBloom()` (resolution-independent bloom) or
 * `generatePyramidBloomLegacy()` (the same bloom as the mip chain): computed without the mip chain's aliasing, so small
 * bright highlights do not shimmer as they move. Level weights and radii are then set by those functions, and
 * `mipmapSource`, `bloomFalloff`, `minLod` and `maxLod` are unused.
 *
 * With `generateBlurredMipmaps({ antiAliased: true })`, set `smoothLevels: 2` to also read the finest levels with a
 * cubic B-spline instead of bilinear filtering: a bilinear read of a coarse level is not shift-invariant, which is the
 * remaining shimmer once the levels themselves are alias-free.
 */
export class BloomMipmapsMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>,
    /** Usually the same as source */
    mipmapSource: Uniform<Texture | null>,
    /** Precomputed bloom term from `generatePyramidBloom()` or `generatePyramidBloomLegacy()`, replaces the mipmap accumulation when set */
    bloomSource?: Uniform<Texture | null>,
    bloomStrength: Uniform<number>,
    bloomFalloff: Uniform<number>,
    minLod: Uniform<number>,
    maxLod?: Uniform<number>,
    // Color grading uniforms (only used when colorGrading option is enabled)
    colorGradeContrast?: Uniform<number>,
    colorGradeSaturation?: Uniform<number>,
    colorGradeExponent?: Uniform<number>,
}> {

    bakeUniforms: boolean;
    readonly smoothLevels: number;

    constructor(options_?: {
        bakeUniforms?: boolean,
        /** Enable color grading (contrast, saturation, exponent adjustments) */
        colorGrading?: boolean,
        /**
         * Read the finest `smoothLevels` levels (from `minLod`) with a cubic B-spline (4 bilinear fetches each) instead
         * of one bilinear fetch: smooth and shift-invariant. Meant for `generateBlurredMipmaps({ antiAliased: true })`.
         * The B-spline blurs slightly more than bilinear (1/3 vs 1/6 texel² of the level). @default 0
         */
        smoothLevels?: number,
    }) {
        const defaultOptions = {
            bakeUniforms: true,
            colorGrading: false,
            smoothLevels: 0,
        }
        let options = { ...defaultOptions, ...options_ };
        const smoothLevels = Math.max(0, Math.floor(options.smoothLevels));

        const dynamicBloomAccumulation = (smoothLevels > 0 ? /*glsl*/`
            for (float i = minLod; i < maxLod; i++) {
                bloom += (i < minLod + ${smoothLevels.toFixed(1)} ? sampleLevelBSpline(mipmapSource, vUv, i) : textureLod(mipmapSource, vUv, i)) * pow(i, -bloomFalloff);
            }` : /*glsl*/`
            for (float i = minLod; i < maxLod; i++) {
                bloom += textureLod(mipmapSource, vUv, i) * pow(i, -bloomFalloff);
            }`).replace(/\n/g, '\\\n');

        const bsplineFunction = smoothLevels > 0 ? /*glsl*/`
                // cubic B-spline read of one mip level with 4 bilinear fetches
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
` : '';

        super({
            uniforms: {
                source: new Uniform(null),
                mipmapSource: new Uniform(null),
                bloomSource: new Uniform(null),
                bloomStrength: new Uniform(0.01),
                bloomFalloff: new Uniform(-0.138),
                minLod: new Uniform(1),
                maxLod: new Uniform(0),
                // Color grading uniforms (0 = no change)
                colorGradeContrast: new Uniform(0.0),
                colorGradeSaturation: new Uniform(0.0),
                colorGradeExponent: new Uniform(0.0),
            },
            defines: {
                BAKE_UNIFORMS: 0,
                USE_BLOOM_SOURCE: 0,
                COLOR_GRADING: options.colorGrading ? 1 : 0,
                // escape newlines
                BLOOM_ACCUMULATION: dynamicBloomAccumulation,
            },
            vertexShader: /*glsl*/`
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: /*glsl*/`
                uniform sampler2D source;
                uniform sampler2D mipmapSource;
                uniform sampler2D bloomSource;

                uniform float bloomStrength;

                #if BAKE_UNIFORMS
                #define bloomFalloff BLOOM_FALLOFF
                #define maxLod MAX_LOD
                #define minLod MIN_LOD
                #else
                uniform float bloomFalloff;
                uniform float maxLod;
                uniform float minLod;
                #endif

                #if COLOR_GRADING
                uniform float colorGradeContrast;
                uniform float colorGradeSaturation;
                uniform float colorGradeExponent;

                const vec3 COLOR_GRADE_LUMA = vec3(0.2126, 0.7152, 0.0722);

                vec3 applyColorGrading(vec3 c) {
                    // Contrast: expand/compress around 0.5
                    c = (c - 0.5) * (colorGradeContrast + 1.0) + 0.5;
                    // Saturation: mix between luminance and color
                    float luma = dot(c, COLOR_GRADE_LUMA);
                    c = mix(vec3(luma), c, colorGradeSaturation + 1.0);
                    // Exponent: gamma-like adjustment
                    c = pow(c, vec3(colorGradeExponent + 1.0));
                    return c;
                }
                #endif
${bsplineFunction}
                varying vec2 vUv;

                #include <common>
                #include <dithering_pars_fragment>

                void main() {
                    // mix in lods
                    #if USE_BLOOM_SOURCE
                    // explicit lod: with bloomSource the source's mip levels are not generated, and a mipmapped
                    // minFilter could otherwise blend in stale levels
                    vec4 lod0 = textureLod(source, vUv, 0.0);
                    #else
                    vec4 lod0 = texture2D(source, vUv);
                    #endif

                    vec4 bloom = vec4(0.0);

                    #if USE_BLOOM_SOURCE
                    bloom = texture2D(bloomSource, vUv);
                    #else
                    {
                        BLOOM_ACCUMULATION
                    }
                    #endif

                    gl_FragColor = lod0 + bloom * bloomStrength;

                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>

                    #if COLOR_GRADING
                    gl_FragColor.rgb = applyColorGrading(gl_FragColor.rgb);
                    #endif

                    #include <premultiplied_alpha_fragment>
                    #include <dithering_fragment>
                }
            `,
            depthTest: false,
            depthWrite: false,
        });

        this.bakeUniforms = options.bakeUniforms ?? true;
        this.smoothLevels = smoothLevels;

        let definesState = {
            bakeUniforms: false,
            maxLod: NaN,
            minLod: NaN,
            bloomFalloff: NaN,
        }

        this.onBeforeRender = () => {
            const useBloomSource = this.uniforms.bloomSource?.value != null ? 1 : 0;
            if (this.defines.USE_BLOOM_SOURCE !== useBloomSource) {
                this.defines.USE_BLOOM_SOURCE = useBloomSource;
                this.needsUpdate = true;
            }

            // ensure there's always a mipmap source
            if (!this.uniforms.mipmapSource!.value) {
                this.uniforms.mipmapSource!.value = this.uniforms.source.value;
            }

            let mipmapCount: number = this.uniforms.mipmapSource!.value?.mipmaps?.length ?? 0;
            let maxLod = Math.max(0, mipmapCount - 1);
            this.uniforms.maxLod!.value = maxLod;
            const minLod = Math.min(this.uniforms.minLod.value, maxLod);

            // check for state change
            let definesNeedUpdate = definesState.bakeUniforms !== this.bakeUniforms;

            // we only need to update if the values have changed
            // or the bakeUniforms flag has changed
            if (this.bakeUniforms) {
                let bakedUniformValuesChanged = (
                    (definesState.minLod !== minLod) ||
                    (definesState.maxLod !== maxLod) ||
                    (definesState.bloomFalloff !== this.uniforms.bloomFalloff.value)
                );
                definesNeedUpdate = definesNeedUpdate || bakedUniformValuesChanged;
            }

            if (definesNeedUpdate) {
                if (this.bakeUniforms) {
                    this.defines.BAKE_UNIFORMS = 1;
                    this.defines.BLOOM_ACCUMULATION = getBloomAccumulationShaderOptimized({
                        minLod,
                        maxLod,
                        bloomFalloff: this.uniforms.bloomFalloff.value,
                        smoothLevels,
                    });
                    this.defines.BLOOM_FALLOFF = this.uniforms.bloomFalloff.value.toFixed(3);
                    this.defines.MIN_LOD = minLod.toFixed(1);
                    this.defines.MAX_LOD = maxLod.toFixed(1);
                } else {
                    this.defines.BAKE_UNIFORMS = 0;
                    this.defines.BLOOM_ACCUMULATION = dynamicBloomAccumulation;
                    delete this.defines.BLOOM_FALLOFF;
                    delete this.defines.MAX_LOD;
                    delete this.defines.MIN_LOD;
                }

                definesState.bakeUniforms = this.bakeUniforms;
                definesState.minLod = minLod;
                definesState.maxLod = maxLod;
                definesState.bloomFalloff = this.uniforms.bloomFalloff.value

                this.needsUpdate = true;
            }
        }

        function getBloomAccumulationShader(
            { minLod, maxLod, bloomFalloff }: { minLod: number, maxLod: number, bloomFalloff: number }
        ) {
            let glsl = '';
            for (let i = minLod; i < maxLod; i++) {
                let multiplier = Math.pow(i, -bloomFalloff);
                glsl += /*glsl*/`bloom += textureLod(mipmapSource, vUv, ${i.toFixed(1)}) * ${multiplier.toFixed(3)};\n`;
            }
            return glsl.replace(/\n/g, '\\\n');
        }

        /**
         * Reduce textureLod calls by combining pairs of levels (trilinear filtering)
         * Required LINEAR_MIPMAP_LINEAR filtering for this to work
         */
        function getBloomAccumulationShaderOptimized(
            { minLod, maxLod, bloomFalloff, smoothLevels }: { minLod: number, maxLod: number, bloomFalloff: number, smoothLevels: number }
        ): string {
            let glsl = '';
            const epsilon = 1e-6; // Small value to avoid log(0)/pow(0, negative)

            // the finest smoothLevels levels: one B-spline read each
            let currentLod = minLod;
            for (; currentLod < Math.min(minLod + smoothLevels, maxLod); currentLod++) {
                const W = Math.pow(Math.max(currentLod, epsilon), -bloomFalloff);
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

                let W1 = Math.pow(w1_base, -bloomFalloff);
                const W2 = Math.pow(w2_base, -bloomFalloff);

                // Correct W1 specifically for pow(0, 0) case if falloff is exactly 0
                if (Math.abs(lod1) < epsilon && Math.abs(bloomFalloff) < epsilon) {
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
                let W_last = Math.pow(W_last_base, -bloomFalloff);

                // Correct W_last specifically for pow(0, 0) case
                 if (Math.abs(lastLod) < epsilon && Math.abs(bloomFalloff) < epsilon) {
                    W_last = 1.0;
                }


                // Add GLSL line only if weight is significant
                if (W_last > epsilon) {
                     // Use original precision spec for consistency or update as needed
                    glsl += /*glsl*/ `bloom += textureLod(mipmapSource, vUv, ${lastLod.toFixed(1)}) * ${W_last.toFixed(5)};\n`;
                }

            }

            // Replace newlines for embedding if necessary (kept from original)
            return glsl.replace(/\n/g, '\\\n');
        }
    }

}