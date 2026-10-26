import { DoubleSide, Texture, Uniform } from "three";
import { premultipliedAlphaGlsl } from "../rendering/DisplayTransform.js";
import { RawShaderMaterial } from "./RawShaderMaterial.js";
import { ShaderMaterial } from "./ShaderMaterial.js";
import { RGBASwizzle } from "./Swizzle.js";

/**
 * Intended to be used as a material for a fullscreen fragment pass to copy the contents of a texture
 *
 * Applies the renderer's tone mapping and output colour space when the pass has them. With
 * `{ premultipliedSource: true }` they apply to un-premultiplied colour, premultiplied again after, for a source
 * that holds premultiplied alpha; opaque pixels and pixels with alpha 0 are unaffected. Coverage is read after the
 * swizzle. Off by default: the copy then transforms the stored values as they are.
 */
export class CopyMaterial extends ShaderMaterial<
	{
		source: Uniform<Texture | null>,
		sourceMipmapLevel: Uniform<number>,
	},
	{
		SWIZZLE: string,
		PREMULTIPLIED_SOURCE?: string,
	}
> {

	/** Whether tone mapping and the output colour space apply to un-premultiplied colour (constructor option) */
	get premultipliedSource(): boolean { return this.defines.PREMULTIPLIED_SOURCE != null; }

	constructor(swizzle: RGBASwizzle = '', options: { premultipliedSource?: boolean } = {}) {
		const premultipliedSource = options.premultipliedSource ?? false;
		super({
			uniforms: {
				source: new Uniform(null),
				sourceMipmapLevel: new Uniform(0),
			},
			defines: premultipliedSource ? { SWIZZLE: swizzle, PREMULTIPLIED_SOURCE: '1' } : { SWIZZLE: swizzle },
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

				#ifdef PREMULTIPLIED_SOURCE
${premultipliedAlphaGlsl}
				#endif

				void main() {
					gl_FragColor = textureLod(source, vUv, sourceMipmapLevel)SWIZZLE;

					#if defined( PREMULTIPLIED_SOURCE ) && !defined( PREMULTIPLIED_ALPHA )
					vec4 premultiplied = gl_FragColor;
					gl_FragColor.rgb = unpremultiplyColor(premultiplied);
					#endif

					#include <tonemapping_fragment>
					#include <colorspace_fragment>

					#if defined( PREMULTIPLIED_SOURCE ) && !defined( PREMULTIPLIED_ALPHA )
					gl_FragColor.rgb = premultiplyColor(gl_FragColor.rgb, premultiplied);
					#endif
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