import { Blending, ColorRepresentation, DoubleSide, LinearFilter, LinearMipMapLinearFilter, MathUtils, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, RepeatWrapping, ShaderMaterial, Texture, Uniform, Vector2 } from "three";
import { Layer } from "../Layer";

export class TextureVisualizer extends Object3D {

	texturePlanes = new Map<string, Mesh<PlaneGeometry, MeshBasicMaterial>>();
	readonly gridWidth = 4;

	constructor() {
		super();
		this.layers.set(Layer.Developer);
	}

	displayTexture(id: string, texture: Texture) {
		let texturePlane = this.texturePlanes.get(id);

		if (texturePlane == null) {
			// let material = new TextureDisplayMaterial(texture);
			let material = new MeshBasicMaterial({
				map: texture,
				side: DoubleSide,
			});
			texturePlane = new Mesh(new PlaneGeometry(1, 1), material);
			texturePlane.onBeforeRender = (renderer, scene, camera, geometry, _material, group) => {
				// renderer.getSize(material.uniforms.targetSize.value);
			};
			texturePlane.layers.set(Layer.Developer);
			this.texturePlanes.set(id, texturePlane);
			this.add(texturePlane);
		}

		// texturePlane.material.uniforms.source.value = texture;
		texturePlane.material.map = texture;

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


		this.layout();
	}

	removeTexture(id: string) {
		let texturePlane = this.texturePlanes.get(id);
		if (texturePlane != null) {
			this.remove(texturePlane);
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

class TextureDisplayMaterial extends ShaderMaterial {

	uniforms: {
		source: Uniform;
		targetSize: Uniform;
	} = this.uniforms;
	
	constructor(texture: Texture, params?: {
		transparent?: boolean;
		color?: ColorRepresentation,
		blending?: Blending,
	}) {
		super({
			vertexShader: `
				uniform vec2 targetSize;

				varying vec2 vUv;
				void main() {
					vUv = uv;

					vec4 p = vec4( position, 1.0 );
					vec4 worldP = modelMatrix * p;

					vec4 viewP = viewMatrix * worldP;
					vec4 clipP = projectionMatrix * viewP;

					gl_Position = clipP;
				}
			`,
			fragmentShader: `
				precision highp float;
				uniform sampler2D source;
				varying vec2 vUv;
				void main() {
					gl_FragColor = texture2D(source, vUv);
				}
			`,
			...params
		});

		this.uniforms = {
			source: new Uniform(texture),
			targetSize: new Uniform(new Vector2(1, 1)),
		}
	}

}