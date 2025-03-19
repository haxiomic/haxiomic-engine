import { ShaderMaterial } from "@haxiomic-engine/materials/ShaderMaterial";
import { Texture, Uniform } from "three";

/**
 * Blends mipmaps over level 0
 * 
 * Use with `generateBlurredMipmaps()` to create a blurred mipmap chain
 */
export class BloomMipmapsMaterial extends ShaderMaterial<{
    source: Uniform<Texture | null>,
    bloomStrength: Uniform<number>,
    bloomFalloff: Uniform<number>,
    mipmapCount: Uniform<number>,
}> {

    constructor() {
        super({
            uniforms: {
                source: new Uniform(null),
                bloomStrength: new Uniform(0.01),
                bloomFalloff: new Uniform(-0.138),
                mipmapCount: new Uniform(0),
            },
            vertexShader: /*glsl*/`
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /*glsl*/`
                uniform sampler2D source;
                uniform float bloomStrength;
                uniform float bloomFalloff;
                uniform float mipmapCount;

                varying vec2 vUv;

                #include <common>
                #include <dithering_pars_fragment>
                
                void main() {
                    // mix in lods
                    vec4 lod0 = texture2D(source, vUv);

                    gl_FragColor = lod0;

                    vec4 bloom = vec4(0.0);
                    
                    // @! this could be unrolled
                    float maxLod = mipmapCount - 1.0;
                    for (float i = 1.0; i < maxLod; i++) {
                        bloom += textureLod(source, vUv, i) * pow(i, -bloomFalloff);
                    }

                    gl_FragColor = lod0 + bloom * bloomStrength;

                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                    #include <premultiplied_alpha_fragment>
                    #include <dithering_fragment>
                }
            `,
        });

        this.onBeforeRender = () => {
            let mipmapCount = this.uniforms.source.value?.mipmaps?.length;
            this.uniforms.mipmapCount.value = mipmapCount ?? 0;
        }
    }

}