import { Texture, Uniform } from "three";
import { ShaderMaterial } from "./ShaderMaterial.js";

/**
 * Blends mipmaps over level 0
 * 
 * Use with `generateBlurredMipmaps()` to create a blurred mipmap chain
 * 
 * **Requires minFilter set to `LINEAR_MIPMAP_LINEAR` filtering**
 */
export class BloomMipmapsMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>,
    mipmapSource?: Uniform<Texture | null>,
    bloomStrength: Uniform<number>,
    bloomFalloff: Uniform<number>,
    minLod: Uniform<number>,
    maxLod?: Uniform<number>,
}> {

    bakeUniforms: boolean;

    constructor(options_?: {
        bakeUniforms?: boolean,
    }) {
        const defaultOptions = {
            bakeUniforms: true,
        }
        let options = { ...defaultOptions, ...options_ };

        const dynamicBloomAccumulation = /*glsl*/`
            for (float i = minLod; i < maxLod; i++) {
                bloom += textureLod(mipmapSource, vUv, i) * pow(i, -bloomFalloff);
            }`.replace(/\n/g, '\\\n');
        
        super({
            uniforms: {
                source: new Uniform(null),
                mipmapSource: new Uniform(null),
                bloomStrength: new Uniform(0.01),
                bloomFalloff: new Uniform(-0.138),
                minLod: new Uniform(1),
                maxLod: new Uniform(0),
            },
            defines: {
                BAKE_UNIFORMS: 0,
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
                    #include <premultiplied_alpha_fragment>
                    #include <dithering_fragment>
                }
            `,
            depthTest: false,
            depthWrite: false,
        });

        this.bakeUniforms = options.bakeUniforms ?? true;

        let definesState = {
            bakeUniforms: false,
            maxLod: NaN,
            minLod: NaN,
            bloomFalloff: NaN,
        }

        this.onBeforeRender = () => {
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
            { minLod, maxLod, bloomFalloff }: { minLod: number, maxLod: number, bloomFalloff: number }
        ): string {
            let glsl = '';
            const epsilon = 1e-6; // Small value to avoid log(0)/pow(0, negative)

            // Loop over pairs of levels
            let currentLod = minLod;
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