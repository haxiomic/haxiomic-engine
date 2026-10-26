import { Texture, Uniform } from "three";
import { bloomAccumulationDynamicStatements, bloomAccumulationStatements, bloomBSplineGlsl, bloomLodRange } from "../rendering/BloomAccumulation.js";
import { premultipliedAlphaGlsl } from "../rendering/DisplayTransform.js";
import { ShaderMaterial } from "./ShaderMaterial.js";

/**
 * Blends mipmaps over level 0
 *
 * Use with `generateBlurredMipmaps()` to create a blurred mipmap chain
 *
 * **Requires minFilter set to `LINEAR_MIPMAP_LINEAR` filtering**
 *
 * For bloom that doesn't flicker on moving highlights, set `bloomSource` to `generatePyramidBloom()`'s result instead:
 * `mipmapSource`, `bloomFalloff`, `minLod` and `maxLod` are then unused.
 *
 * The source is taken as premultiplied (what three renders into a target), so tone mapping, the output encoding and
 * the colour grade apply to un-premultiplied colour, which is premultiplied again after. Opaque pixels come out as
 * they would without this; partially transparent ones keep their colour instead of brightening. Pass
 * `premultipliedSource: false` to transform the stored colour as it is. The accumulation is also available as GLSL to
 * compose: see `bloomAccumulationGlsl()`.
 */
export class BloomMipmapsMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>,
    /** Usually the same as source */
    mipmapSource: Uniform<Texture | null>,
    /** Precomputed bloom (from `generatePyramidBloom()`); when set it replaces the mip accumulation */
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
    /** Whether tone mapping and encoding apply to un-premultiplied colour (constructor option) */
    get premultipliedSource(): boolean { return this.defines.PREMULTIPLIED_SOURCE === 1; }

    constructor(options_?: {
        bakeUniforms?: boolean,
        /** Enable color grading (contrast, saturation, exponent adjustments) */
        colorGrading?: boolean,
        /**
         * Read the finest n mip levels with a cubic B-spline (4 fetches each) instead of bilinear, removing the shimmer
         * a bilinear read of a coarse level leaves. Use 2 with `generateBlurredMipmaps({ antiAliased: true })`; costs
         * ≈ 0.02 ms at 1080p. @default 0
         */
        smoothLevels?: number,
        /**
         * The source holds premultiplied alpha, as three's render targets do: tone mapping, the output encoding and
         * the colour grade apply to un-premultiplied colour, premultiplied again after. Opaque pixels and pixels with
         * alpha 0 are unaffected. `false` transforms the stored colour as it is. @default true
         */
        premultipliedSource?: boolean,
    }) {
        const defaultOptions = {
            bakeUniforms: true,
            colorGrading: false,
            smoothLevels: 0,
            premultipliedSource: true,
        }
        let options = { ...defaultOptions, ...options_ };
        const smoothLevels = Math.max(0, Math.floor(options.smoothLevels));

        const dynamicBloomAccumulation = bloomAccumulationDynamicStatements(smoothLevels).replace(/\n/g, '\\\n');

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
                PREMULTIPLIED_SOURCE: options.premultipliedSource ? 1 : 0,
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
${smoothLevels > 0 ? bloomBSplineGlsl : ''}
${premultipliedAlphaGlsl}
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

                    #if PREMULTIPLIED_SOURCE
                    // transform the colour, not the colour scaled by its coverage
                    vec4 premultiplied = gl_FragColor;
                    gl_FragColor.rgb = unpremultiplyColor(premultiplied);
                    #endif

                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>

                    #if COLOR_GRADING
                    gl_FragColor.rgb = applyColorGrading(gl_FragColor.rgb);
                    #endif

                    #if PREMULTIPLIED_SOURCE
                    gl_FragColor.rgb = premultiplyColor(gl_FragColor.rgb, premultiplied);
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

            const { minLod, maxLod } = bloomLodRange(this.uniforms.mipmapSource!.value, this.uniforms.minLod.value);
            this.uniforms.maxLod!.value = maxLod;

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
                    this.defines.BLOOM_ACCUMULATION = bloomAccumulationStatements({
                        minLod,
                        maxLod,
                        falloff: this.uniforms.bloomFalloff.value,
                        smoothLevels,
                    }).replace(/\n/g, '\\\n');
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
    }

}
