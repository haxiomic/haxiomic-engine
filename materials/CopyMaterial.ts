import { DoubleSide, Texture, Uniform } from "three";
import { RawShaderMaterial } from "./RawShaderMaterial.js";
import { ShaderMaterial } from "./ShaderMaterial.js";
import { RGBASwizzle } from "./RGBASwizzle.ts";

/**
 * Intended to be used as a material for a fullscreen fragment pass to copy the contents of a texture
 */
export class CopyMaterial extends ShaderMaterial<
	{
		source: Uniform<Texture | null>,
		sourceMipmapLevel: Uniform<number>,
	},
	{
		SWIZZLE: string,
	}
> {

	constructor(swizzle: RGBASwizzle = '') {
		super({
			uniforms: {
				source: new Uniform(null),
				sourceMipmapLevel: new Uniform(0),
			},
			defines: {
				SWIZZLE: swizzle,
			},
			vertexShader: /*glsl*/`
				varying vec2 vUv;
				void main() {
					vUv = position.xy * 0.5 + 0.5;
					gl_Position = vec4(position, 1.);
				}
			`,
			fragmentShader: /*glsl*/`
				precision highp float;
				uniform sampler2D source;
				uniform float sourceMipmapLevel;
				varying vec2 vUv;

				#include <common>

				void main() {
					gl_FragColor = textureLod(source, vUv, sourceMipmapLevel)SWIZZLE;

					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`,
			side: DoubleSide,
			depthWrite: false,
			depthTest: false,
		});
	}

	set(texture: Texture, sourceMipmapLevel: number, swizzle: RGBASwizzle = '') {
		this.uniforms.source.value = texture;
		this.uniforms.sourceMipmapLevel.value = sourceMipmapLevel;
		let definesChanged = this.defines.SWIZZLE !== swizzle;
		if (definesChanged) {
			this.defines.SWIZZLE = swizzle;
			this.needsUpdate = true;
		}
	}

}

/**
 * Intended to be used as a material for a fullscreen fragment pass to copy the contents of a texture
 */
export class RawCopyMaterial extends RawShaderMaterial<
	{
		source: Uniform<Texture | null>,
		sourceMipmapLevel: Uniform<number>,
	},
	{
		SWIZZLE: string,
	}
> {

	constructor(swizzle: RGBASwizzle = '') {
		super({
			uniforms: {
				source: new Uniform(null),
				sourceMipmapLevel: new Uniform(0),
			},
			defines: {
				SWIZZLE: swizzle,
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
				uniform float sourceMipmapLevel;
				varying vec2 vUv;

				void main() {
					gl_FragColor = texture2D(source, vUv, sourceMipmapLevel)SWIZZLE;
				}
			`,
			side: DoubleSide,
			depthWrite: false,
			depthTest: false,
		});
	}

	set(texture: Texture, sourceMipmapLevel: number, swizzle: RGBASwizzle = '') {
		this.uniforms.source.value = texture;
		this.uniforms.sourceMipmapLevel.value = sourceMipmapLevel;
		let definesChanged = this.defines.SWIZZLE !== swizzle;
		if (definesChanged) {
			this.defines.SWIZZLE = swizzle;
			this.needsUpdate = true;
		}
	}

}