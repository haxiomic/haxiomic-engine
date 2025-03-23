import { Blending, ColorRepresentation, DoubleSide, IUniform, LinearFilter, LinearMipMapLinearFilter, MathUtils, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, RepeatWrapping, ShaderMaterialParameters, Texture, Uniform, Vector2 } from "three";
import { Layer } from "../Layer.js";
import { RGBASwizzle } from "../materials/CopyMaterial.js";
import { ShaderMaterial } from "../materials/ShaderMaterial.js";

export class TextureVisualizer {

	root: Object3D;
	texturePlanes = new Map<string, Mesh<PlaneGeometry, TextureDisplayMaterial>>();
	readonly gridWidth = 4;

	constructor() {
		this.root = new Object3D();
		this.root.layers.set(Layer.Developer);
	}

	displayTexture(id: string, texture: Texture, lodLevel: number = 0, swizzle: RGBASwizzle = '') {
		let texturePlane = this.texturePlanes.get(id);

		if (texturePlane == null) {
			let material = new TextureDisplayMaterial({
				map: texture,
				side: DoubleSide,
				fog: false,
			});
			texturePlane = new Mesh(new PlaneGeometry(1, 1), material);
			texturePlane.layers.set(Layer.Developer);
			this.texturePlanes.set(id, texturePlane);
			this.root.add(texturePlane);

			// show id in top left corner
			let fontSizePx = 64;
			let nameDisplay = this.generateTextCanvas(id, fontSizePx, `600 ${fontSizePx}px HelveticaNeue, "Helvetica Neue", Helvetica, sans-serif`, 0.1, true, 1024)!;
			let textAspect = nameDisplay.textWidth / nameDisplay.textHeight;
			let nameTexture = new Texture(nameDisplay?.canvas);
			nameTexture.anisotropy = 16;
			nameTexture.wrapT = RepeatWrapping;
			nameTexture.wrapS = RepeatWrapping;
			nameTexture.repeat.set(
				nameDisplay.textWidth / nameDisplay.canvas.width,
				nameDisplay.textHeight / nameDisplay.canvas.height
			)
			nameTexture.generateMipmaps = true;
			nameTexture.minFilter = LinearMipMapLinearFilter;
			nameTexture.magFilter = LinearFilter;
			nameTexture.needsUpdate = true;

			let namePlane = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
				map: nameTexture,
				transparent: true,
				depthWrite: false,
				polygonOffset: true,

				toneMapped: false,
				fog: false,
				side: DoubleSide,
			}));
			namePlane.layers.set(Layer.Developer);
			namePlane.position.z = 0.01;
			texturePlane.add(namePlane);

			let nameHeight = 0.1;
			namePlane.scale.set(nameHeight * textAspect * 0.5, nameHeight * 0.5, 1);
			// position at bottom
			namePlane.position.y = -0.5 + nameHeight * 0.5;
		}

		texturePlane.material.set(texture, lodLevel, swizzle);

		this.layout();
	}

	removeTexture(id: string) {
		let texturePlane = this.texturePlanes.get(id);
		if (texturePlane != null) {
			this.root.remove(texturePlane);
			this.texturePlanes.delete(id);
		}
		this.layout();
	}

	layout() {
		let i = 0;
		this.texturePlanes.forEach((texturePlane) => {
			texturePlane.position.x = i % this.gridWidth;
			texturePlane.position.y = Math.floor(i / this.gridWidth);
			i++;
		});
	}

	generateTextCanvas(text: string, fontSizePx: number, fontCSS: string, ySafetyMarginFraction: number = 5, requirePOT: boolean = true, maxTextureWidth?: number) {
		let ySafetyMarginPx = ySafetyMarginFraction * fontSizePx;
		let textMeasureDiv = document.createElement('div');
		textMeasureDiv.style.position = 'absolute';
		textMeasureDiv.style.display = 'inline-block';
		textMeasureDiv.style.top = '10px';
		textMeasureDiv.style.left = '0';
		textMeasureDiv.style.zIndex = '9999';
		textMeasureDiv.style.outline = '1px solid cyan';
		document.body.appendChild(textMeasureDiv);
		textMeasureDiv.style.visibility = 'hidden';
		textMeasureDiv.style.whiteSpace = 'nowrap';
		textMeasureDiv.style.font = fontCSS;
		textMeasureDiv.innerText = text;

		let textBounds = textMeasureDiv.getBoundingClientRect();

		// we no longer need textMeasureDiv after getting its bounding rect
		textMeasureDiv.innerHTML = '';
		textMeasureDiv.remove();

		let scaleFactor = 1.;

		// limit canvas size by maxTextureWidth if supplied
		if (maxTextureWidth != null) {
			let w = scaleFactor * textBounds.width;
			if (w > maxTextureWidth) {
				scaleFactor *= maxTextureWidth/w;
			}
		}

		// scale to next highest POT
		let textWidth = textBounds.width * scaleFactor;
		let textHeight = (textBounds.height + ySafetyMarginPx) * scaleFactor;
		
		let textureWidth = requirePOT ? MathUtils.ceilPowerOfTwo(textWidth) : textWidth;
		let textureHeight = requirePOT ? MathUtils.ceilPowerOfTwo(textHeight) : textHeight;

		// create text mesh and texture
		let textCanvas = document.createElement('canvas');
		textCanvas.width = textureWidth;
		textCanvas.height = textureHeight;
		textCanvas.style.width = textCanvas.width/scaleFactor + 'px';
		textCanvas.style.height = textCanvas.height/scaleFactor + 'px';
		
		// debug display
		// document.body.appendChild(textCanvas);
		// textCanvas.style.position = 'absolute';
		// textCanvas.style.left = '0';
		// textCanvas.style.top = '0';
		// textCanvas.style.zIndex = '9999';
		// textCanvas.style.outline = '1px solid green';

		let ctx = textCanvas.getContext('2d');
		if (ctx == null) {
			console.error('Could not create 2d drawing context for text rendering');
			return null;
		}

		ctx.font = fontCSS;

		// textBounds.height = Ascender - Descender

		let textHeightPx = textBounds.height;
		let approxDescenderPx = textHeightPx - fontSizePx;
		ctx.fillStyle = '#00000000';
		ctx.fillRect(0, 0, textCanvas.width, textCanvas.height);

		ctx.fillStyle = '#FFFFFF';
		ctx.scale(scaleFactor, scaleFactor);

		// text shadow
		ctx.shadowColor = '#000000';
		ctx.shadowBlur = 2;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// text outline
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 6;
		ctx.strokeText(text, 0, textCanvas.height/scaleFactor - approxDescenderPx - ySafetyMarginPx * 0.5);

		// position text at the bottom of the canvas
		ctx.fillText(text, 0, textCanvas.height/scaleFactor - approxDescenderPx - ySafetyMarginPx * 0.5);

		return {
			canvas: textCanvas,
			textWidth: textWidth,
			textHeight: textHeight,
		}
	}

}

class TextureDisplayMaterial extends ShaderMaterial<
	{
		source: Uniform<Texture | null>
		lodLevel: Uniform<number>
	}, {
		SWIZZLE: RGBASwizzle
	}> {
	
	constructor(params?: {
		map: Texture
	} & Omit<ShaderMaterialParameters, 'uniforms' | 'defines'>) {
		const { map, ...rest } = params || {};
		super({
			uniforms: {
				source: new Uniform(params?.map || null),
				lodLevel: new Uniform(0),
			},
			defines: {
				SWIZZLE: '.rgba',
			},
			vertexShader: /*glsl*/`
				varying vec2 vUv;
				void main() {
					vUv = uv;

					vec4 world = modelMatrix * vec4( position, 1.0 );
					vec4 view = viewMatrix * world;
					vec4 clip = projectionMatrix * view;

					gl_Position = clip;
				}
			`,
			fragmentShader: /*glsl*/`
				uniform sampler2D source;
				uniform float lodLevel;

				varying vec2 vUv;

				#include <common>
				#include <dithering_pars_fragment>

				void main() {
					gl_FragColor = textureLod(source, vUv, lodLevel)SWIZZLE;

					#include <tonemapping_fragment>
					#include <colorspace_fragment>
					#include <premultiplied_alpha_fragment>
					#include <dithering_fragment>
				}
			`,
			...rest
		});
	}

	set(texture: Texture, lodLevel: number, swizzle: RGBASwizzle = '') {
		this.uniforms.source.value = texture;
		this.uniforms.lodLevel.value = lodLevel;
		let definesChanged = this.defines.SWIZZLE !== swizzle;
		if (definesChanged) {
			this.defines.SWIZZLE = swizzle;
			this.needsUpdate = true;
		}
	}

}