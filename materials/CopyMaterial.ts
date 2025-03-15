import { DoubleSide, RawShaderMaterial, Texture, Uniform } from "three";

/**
 * Intended to be used as a material for a fullscreen fragment pass to copy the contents of a texture
 */
export class CopyMaterial extends RawShaderMaterial {

	declare uniforms: {
		source: Uniform;
	};

	constructor() {
		super({
			uniforms: {
				source: new Uniform(null),
			},
			vertexShader: /*glsl*/`
				attribute vec2 position;
				varying vec2 vUv;
				void main() {
					vUv = position * 0.5 + 0.5;
					gl_Position = vec4(position, 0., 1.);
				}
			`,
			fragmentShader: /*glsl*/`
				precision highp float;
				uniform sampler2D source;
				varying vec2 vUv;
				void main() {
					gl_FragColor = texture2D(source, vUv);
				}
			`,
			side: DoubleSide,
		});
	}

	setParams(texture: Texture) {
		this.uniforms.source.value = texture;
	}

}