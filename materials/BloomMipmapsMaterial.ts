import { Texture, Uniform } from "three";
import { ShaderMaterial } from "./ShaderMaterial.js";

/**
 * Blends mipmaps over level 0
 * 
 * Use with `generateBlurredMipmaps()` to create a blurred mipmap chain
 */
export class BloomMipmapsMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>,
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
                bloom += textureLod(source, vUv, i) * pow(i, -bloomFalloff);
            }`.replace(/\n/g, '\\\n');
        
        super({
            uniforms: {
                source: new Uniform(null),
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

                    gl_FragColor = lod0;

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
            let mipmapCount: number = this.uniforms.source.value?.mipmaps?.length ?? 0;
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
                    this.defines.BLOOM_ACCUMULATION = getBloomAccumulationShader({
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
                glsl += /*glsl*/`bloom += textureLod(source, vUv, ${i.toFixed(1)}) * ${multiplier.toFixed(3)};\n`;
            }
            return glsl.replace(/\n/g, '\\\n');
        }
    }

}