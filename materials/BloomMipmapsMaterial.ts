import { Texture, Uniform } from "three";
import { blurredMipmapTopLevel } from "../rendering/BlurredMipmapChain.js";
import { ShaderMaterial } from "./ShaderMaterial.js";

/**
 * Blends mipmaps over level 0
 * 
 * Use with `generateBlurredMipmaps()` to create a blurred mipmap chain
 * 
 * **Requires minFilter set to `LINEAR_MIPMAP_LINEAR` filtering**
 *
 * Levels are summed from `minLod` up to (not including) `maxLod`. By default
 * `maxLod` follows the source's mipmap count, so a larger source sums more of
 * the widest, near screen-wide levels and blooms differently. Pass a fixed
 * `maxLod` for the same bloom at every resolution: levels the chain doesn't
 * reach reuse its top level, which already spans the whole image.
 *
 * Levels past the last one `generateBlurredMipmaps()` renders are never read.
 */
export class BloomMipmapsMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>,
    /** Usually the same as source */
    mipmapSource: Uniform<Texture | null>,
    bloomStrength: Uniform<number>,
    bloomFalloff: Uniform<number>,
    minLod: Uniform<number>,
    maxLod?: Uniform<number>,
    /** Last level the blurred chain renders; set before each render */
    topLod?: Uniform<number>,
    // Color grading uniforms (only used when colorGrading option is enabled)
    colorGradeContrast?: Uniform<number>,
    colorGradeSaturation?: Uniform<number>,
    colorGradeExponent?: Uniform<number>,
}> {

    bakeUniforms: boolean;

    /**
     * Sum levels up to this one (exclusive) at every source size, or follow the
     * source's mipmap count when undefined.
     */
    fixedMaxLod: number | undefined;

    constructor(options_?: {
        bakeUniforms?: boolean,
        /** Enable color grading (contrast, saturation, exponent adjustments) */
        colorGrading?: boolean,
        /** See `fixedMaxLod` */
        maxLod?: number,
    }) {
        const defaultOptions = {
            bakeUniforms: true,
            colorGrading: false,
        }
        let options = { ...defaultOptions, ...options_ };

        const dynamicBloomAccumulation = /*glsl*/`
            for (float i = minLod; i < maxLod; i++) {
                bloom += textureLod(mipmapSource, vUv, min(i, topLod)) * pow(i, -bloomFalloff);
            }`.replace(/\n/g, '\\\n');
        
        super({
            uniforms: {
                source: new Uniform(null),
                mipmapSource: new Uniform(null),
                bloomStrength: new Uniform(0.01),
                bloomFalloff: new Uniform(-0.138),
                minLod: new Uniform(1),
                maxLod: new Uniform(0),
                topLod: new Uniform(0),
                // Color grading uniforms (0 = no change)
                colorGradeContrast: new Uniform(0.0),
                colorGradeSaturation: new Uniform(0.0),
                colorGradeExponent: new Uniform(0.0),
            },
            defines: {
                BAKE_UNIFORMS: 0,
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

                uniform float bloomStrength;

                #if BAKE_UNIFORMS
                #define bloomFalloff BLOOM_FALLOFF
                #define maxLod MAX_LOD
                #define minLod MIN_LOD
                #else
                uniform float bloomFalloff;
                uniform float maxLod;
                uniform float minLod;
                uniform float topLod;
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

                varying vec2 vUv;

                #include <common>
                #include <dithering_pars_fragment>

                void main() {
                    // mix in lods
                    vec4 lod0 = texture2D(source, vUv);

                    vec4 bloom = vec4(0.0);
                    
                    {
                        BLOOM_ACCUMULATION
                    }

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
        this.fixedMaxLod = options.maxLod;

        let definesState = {
            bakeUniforms: false,
            maxLod: NaN,
            minLod: NaN,
            topLod: NaN,
            bloomFalloff: NaN,
        }

        this.onBeforeRender = () => {
            // ensure there's always a mipmap source
            if (!this.uniforms.mipmapSource!.value) {
                this.uniforms.mipmapSource!.value = this.uniforms.source.value;
            }

            const mipmapSource = this.uniforms.mipmapSource!.value;
            const mipmapCount: number = mipmapSource?.mipmaps?.length ?? 0;
            // The chain stops when either side reaches 1 pixel, which can be
            // short of the levels allocated: never read past what it renders.
            const image = mipmapSource?.image as { width?: number, height?: number } | undefined;
            const topLod = Math.max(0, Math.min(
                mipmapCount - 1,
                image?.width && image?.height ? blurredMipmapTopLevel(image.width, image.height) : Infinity,
            ));
            const maxLod = this.fixedMaxLod ?? Math.min(Math.max(0, mipmapCount - 1), topLod + 1);
            this.uniforms.maxLod!.value = maxLod;
            this.uniforms.topLod!.value = topLod;
            const minLod = Math.min(this.uniforms.minLod.value, maxLod);

            // check for state change
            let definesNeedUpdate = definesState.bakeUniforms !== this.bakeUniforms;

            // we only need to update if the values have changed
            // or the bakeUniforms flag has changed
            if (this.bakeUniforms) {
                let bakedUniformValuesChanged = (
                    (definesState.minLod !== minLod) ||
                    (definesState.maxLod !== maxLod) ||
                    (definesState.topLod !== topLod) ||
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
                        topLod,
                        bloomFalloff: this.uniforms.bloomFalloff.value,
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
                definesState.topLod = topLod;
                definesState.bloomFalloff = this.uniforms.bloomFalloff.value

                this.needsUpdate = true;
            }
        }

        /**
         * The weighted levels to sum: level i weighs pow(i, -bloomFalloff) and is
         * read at min(i, topLod). Terms reading the same level are merged.
         */
        function bloomTerms(
            { minLod, maxLod, topLod, bloomFalloff }: { minLod: number, maxLod: number, topLod: number, bloomFalloff: number }
        ) {
            const epsilon = 1e-6; // Small value to avoid log(0)/pow(0, negative)
            const terms: { lod: number, weight: number }[] = [];
            for (let i = minLod; i < maxLod; i++) {
                let weight = Math.pow(Math.max(i, epsilon), -bloomFalloff);
                // pow(0, 0) is 1
                if (Math.abs(i) < epsilon && Math.abs(bloomFalloff) < epsilon) weight = 1.0;
                const lod = Math.min(i, topLod);
                const last = terms[terms.length - 1];
                if (last && last.lod === lod) last.weight += weight;
                else terms.push({ lod, weight });
            }
            return terms;
        }

        /**
         * Reduce textureLod calls by combining pairs of adjacent levels (trilinear filtering)
         * Requires LINEAR_MIPMAP_LINEAR filtering for this to work
         */
        function getBloomAccumulationShaderOptimized(
            params: { minLod: number, maxLod: number, topLod: number, bloomFalloff: number }
        ): string {
            const epsilon = 1e-6;
            const terms = bloomTerms(params);
            let glsl = '';
            for (let t = 0; t < terms.length; t++) {
                const a = terms[t], b = terms[t + 1];
                if (b && b.lod === a.lod + 1) {
                    // One trilinear read between the two levels carries both weights
                    const total = a.weight + b.weight;
                    if (total > epsilon) {
                        const f = Math.max(0.0, Math.min(1.0, b.weight / total));
                        glsl += /*glsl*/ `bloom += textureLod(mipmapSource, vUv, ${(a.lod + f).toFixed(5)}) * ${total.toFixed(5)};\n`;
                    }
                    t++;
                } else if (a.weight > epsilon) {
                    glsl += /*glsl*/ `bloom += textureLod(mipmapSource, vUv, ${a.lod.toFixed(1)}) * ${a.weight.toFixed(5)};\n`;
                }
            }
            // escape newlines for embedding in a define
            return glsl.replace(/\n/g, '\\\n');
        }
    }

}