import { Camera, Color, ColorRepresentation, ColorSpace, IUniform, Layers, Material, Mesh, NoToneMapping, Object3D, OrthographicCamera, PixelFormat, Scene, Texture, ToneMapping, Vector4, WebGLRenderer, WebGLRenderTarget } from "three";
import { CopyMaterial, RawCopyMaterial } from "../materials/CopyMaterial.js";
import { RawShaderMaterial } from "../materials/RawShaderMaterial.js";
import { ShaderMaterial } from "../materials/ShaderMaterial.js";
import ClipSpaceTriangle from "../objects/ClipSpaceTriangle.js";
import { RGBASwizzle } from "../materials/Swizzle.js";
import { isObjectWidthMaterial, ObjectUtils, ObjectWidthMaterial } from "../utils/ObjectUtils.js";

export namespace Rendering {

	const _tempGlobalState = {
		renderTarget: null as WebGLRenderTarget | null,
		activeMipmapLevel: 0,
		activeCubeFace: 0,
		clearColor: {
			rgb: new Color(),
			alpha: 0,
		},
		viewport: new Vector4(),
	}

	function resetState(state: typeof _tempGlobalState) {
		state.renderTarget = null;
		state.activeMipmapLevel = 0;
		state.activeCubeFace = 0;
		state.clearColor.rgb.set(0, 0, 0);
		state.clearColor.alpha = 0;
		state.viewport.set(0, 0, 0, 0);
	}

	const SavedMaterialSymbol = Symbol('SavedMaterial');

	export function saveGlobalState(renderer: WebGLRenderer) {
		_tempGlobalState.renderTarget = renderer.getRenderTarget();
		_tempGlobalState.activeMipmapLevel = renderer.getActiveMipmapLevel();
		_tempGlobalState.activeCubeFace = renderer.getActiveCubeFace();
		renderer.getClearColor(_tempGlobalState.clearColor.rgb);
		_tempGlobalState.clearColor.alpha = renderer.getClearAlpha();
		renderer.getViewport(_tempGlobalState.viewport);
	}

	export function restoreGlobalState(renderer: WebGLRenderer) {
		renderer.setRenderTarget(_tempGlobalState.renderTarget, _tempGlobalState.activeCubeFace, _tempGlobalState.activeMipmapLevel);
		renderer.setViewport(_tempGlobalState.viewport.x, _tempGlobalState.viewport.y, _tempGlobalState.viewport.z, _tempGlobalState.viewport.w);
		renderer.setClearColor(_tempGlobalState.clearColor.rgb, _tempGlobalState.clearColor.alpha);
	}

	export type RenderPassOptions = {
		scene: Mesh | Scene,
		camera: Camera,
		/**
		 * Render to target or null to render to canvas
		 */
		target: WebGLRenderTarget | null,
		/**
		* target's mipmap level to render to
		*/
		targetMipmapLevel?: number,
		/**
		 * target's cube face to render to if target is a cube texture
		 */
		targetCubeFace?: number,
		/**
		 * @default NoToneMapping
		 */
		toneMapping?: ToneMapping,
		/**
		 * @default 1.0
		 */
		toneMappingExposure?: number,
		/**
		 * If provided the target will be cleared with this color before the scene draws
		 * Otherwise its colour is kept: a colour `scene.background`, which three clears with whatever `autoClear` says, is
		 * taken off the scene for the call (a texture background is drawn, as any object). Renders of the scene made inside
		 * the call (three's `Reflector`, `Refractor` and `Water`, and glass's transmission pass) see no background either,
		 * as if the app had set `scene.background = null` around the pass
		 *
		 * A clear covers the whole target, whatever `viewport` says: only a scissor test limits it (`target.scissorTest`,
		 * or the renderer's for the canvas), and the pass leaves that as it finds it
		 *
		 * A full clear (colour, depth and stencil) is three's, with `autoClear` on for the `render()` call: a scene's
		 * colour `background` clears in its place, the scene's own `onBeforeRender` runs before it, and code that renders
		 * from inside the scene (an object's `onBeforeRender`) sees `autoClear` on, as in plain three. Any other clear,
		 * and a full one with a texture background or the renderer's `autoClearColor/Depth/Stencil` changed, is made
		 * before `render()`, with `autoClear` off; a colour `background` then still clears, with those buffers
		 */
		clearColor: {
			rgb: ColorRepresentation,
			alpha: number,
		} | false,
		/**
		 * If true the target's depth will be cleared, to the far plane, before the scene draws
		 * Otherwise it is kept
		 */
		clearDepth: boolean,
		/**
		 * If true the target's stencil will be cleared, to 0, before the scene draws (a target has a stencil buffer only
		 * when made with one: three's canvas with `stencil: true`, a render target with `stencilBuffer: true`)
		 * Otherwise it is kept
		 */
		clearStencil?: boolean,
		/**
		 * Draw into this rectangle of the target, in the renderer's pixels (it multiplies them by its pixel ratio). By
		 * default the whole target, or its mip level. On a render target it's the target's `viewport` for the call
		 */
		viewport?: Vector4,
		/**
		 * If provided the scene will be rendered with this material
		 */
		overrideMaterial?: Material | ((obj: ObjectWidthMaterial) => Material | Material[]),
		/**
		 * Override camera layers mask
		 */
		layers?: Layers,
		/**
		 * Put the renderer's render target, viewport and clear colour back after rendering (everything else the pass
		 * changes is always put back)
		 * @default false
		 */
		restoreGlobalState: boolean,
	}

	/**
	 * Renders `scene` into `target`, as the options say. This should be used instead of `renderer.render()`
	 *
	 * What it changes on the renderer for the call (`autoClear`, tone mapping, the camera's layers,
	 * override materials) is put back after; the render target, viewport and clear colour only with `restoreGlobalState`.
	 * This holds when something in the pass throws, too, such as an override material function or a hook in `render()`
	 */
	export function renderPass(renderer: WebGLRenderer, options: RenderPassOptions) {
		let { target, scene, camera, viewport, clearColor, clearDepth, clearStencil, overrideMaterial, layers } = options;

		// save global state (this call's own: a pass may run inside another's render())
		const _renderTarget = renderer.getRenderTarget();
		const _activeMipmapLevel = renderer.getActiveMipmapLevel();
		const _activeCubeFace = renderer.getActiveCubeFace();
		const _viewport = renderer.getViewport(new Vector4());
		const _clearColor = renderer.getClearColor(new Color());
		const _clearAlpha = renderer.getClearAlpha();
		let _autoClear = renderer.autoClear;
		let _toneMapping = renderer.toneMapping;
		let _toneMappingExposure = renderer.toneMappingExposure;
		let _layersMask = camera.layers.mask;

		// What the pass changes on the scene and its target, recorded as it changes it, for the finally to put back
		// exactly that, whatever throws: an override material function, a hook inside render()
		let _savedOverrideMaterialGlobal: unknown;
		let _overrodeGlobal = false;
		// Objects whose `.material` we swapped for a per-object function override.
		// Recorded explicitly (rather than re-discovered via a second traverse)
		// so the restore is exact and immune to scene-graph changes during
		// `renderer.render` — an object added/removed mid-render must not leave a
		// swapped material stuck on it. A stuck override material is how the
		// "useProgram: program not valid" crash arises downstream: the picking
		// material (glslVersion GLSL3) leaks onto a beauty object and is later
		// re-patched, producing a GLSL3 shader that still uses `gl_FragColor`.
		let _overriddenObjects: ObjectWidthMaterial[] | undefined; // unset unless the overrideMaterial is a per-object function
		let _colorBackground: Color | undefined;
		let _targetViewport: Vector4 | undefined;

		try {
			// change global state
			renderer.autoClear = false;
			renderer.toneMapping = options.toneMapping ?? NoToneMapping;
			renderer.toneMappingExposure = options.toneMappingExposure ?? 1.0;

			const targetMipmapLevel = options.targetMipmapLevel ?? 0;

			renderer.setRenderTarget(target, options.targetCubeFace, targetMipmapLevel);

			if (viewport != null) {
				renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
			} else if (target != null) {
				// `target.width/height` are device pixels (the framebuffer's
				// real pixel count). `renderer.setViewport` is documented as
				// taking "logical pixel unit" — it stores the value and then
				// applies `_viewport × pixelRatio` to gl.viewport. So if we
				// pass device pixels here, gl.viewport ends up DPR-times too
				// large at any pixelRatio > 1, and the pass fills only the
				// (1/pixelRatio)² bottom-left fraction of the target. Divide
				// by pixelRatio so the multiply lands on the correct device-
				// pixel viewport. At pixelRatio=1 the math is unchanged.
				const dpr = renderer.getPixelRatio();
				renderer.setViewport(
					0, 0,
					Math.max((target.width >> targetMipmapLevel) / dpr, 1),
					Math.max((target.height >> targetMipmapLevel) / dpr, 1)
				);
			} else {
				// Same correction as above: drawingBufferWidth/Height are
				// device pixels, setViewport multiplies by pixelRatio.
				let gl = renderer.getContext();
				const dpr = renderer.getPixelRatio();
				renderer.setViewport(0, 0, gl.drawingBufferWidth / dpr, gl.drawingBufferHeight / dpr);
			}
		
			// set override material (storing the previous one)
			if (overrideMaterial != null) {
				if (typeof overrideMaterial === 'function') {
					// Capture a `const` for the traverse closure: TS won't narrow the
					// reassignable `_overriddenObjects` (let | undefined) inside it.
					// Recorded before the traverse, so that objects overridden before
					// a throw from the function are put back too.
					const overridden: ObjectWidthMaterial[] = [];
					_overriddenObjects = overridden;
					scene.traverse((obj) => {
						if (isScene(obj)) return; // skip scenes as they will globally override materials
						if (isObjectWidthMaterial(obj)) {
							const originalMaterial = obj.material;
							const newMaterial = overrideMaterial(obj as ObjectWidthMaterial);
							if (newMaterial !== originalMaterial) {
								(obj as ObjectWidthMaterial).material = newMaterial;
								// save the original material so we can restore it later
								(obj as any)[SavedMaterialSymbol] = originalMaterial;
								overridden.push(obj as ObjectWidthMaterial);
							}
						}
					});
				} else {
					if (isScene(scene)) {
						_savedOverrideMaterialGlobal = scene.overrideMaterial;
						scene.overrideMaterial = overrideMaterial;
					} else {
						_savedOverrideMaterialGlobal = scene.material;
						scene.material = overrideMaterial;
					}
					_overrodeGlobal = true;
				}
			}

			if (layers != null) {
				camera.layers.mask = layers.mask;
			}

			// clear options
			if (clearColor !== false) {
				renderer.setClearColor(clearColor.rgb, clearColor.alpha);
			}
			// a colour background is three's clear, made whatever autoClear says: with the colour kept, the scene has none
			if (clearColor === false && isScene(scene) && (scene.background as Color | null)?.isColor === true) {
				_colorBackground = scene.background as Color;
				scene.background = null;
			}
			// three applies a render target's own viewport each time it binds it, which it does again inside render() after
			// any shadow maps or transmission pass: so the pass's viewport goes on the target for the call
			_targetViewport = target?.viewport.clone();
			if (target != null) renderer.getCurrentViewport(target.viewport);

			// A full clear is three's, with autoClear: inside render(), after it has drawn any shadow maps and transmission
			// pass to their own targets, so the clear and the scene's draws are one GPU render pass. A clear made before
			// render() is a pass of its own there, which on tile-based GPUs writes the whole target out and reads it back.
			// Only a full clear with three's own buffers (autoClearColor/Depth/Stencil on, as three sets them), so that code
			// rendering from inside the scene sees a renderer as plain three leaves it: three's Reflector, Refractor and Water
			// clear their own target themselves only with autoClear off, and otherwise leave it to three's clear, with those
			// buffers. Not with a texture background either: three then clears with whatever clear colour its shadow map left
			// set (white). Any other clear is made before render(), with autoClear off, as it always was
			let needsClear = clearColor !== false || clearDepth === true || clearStencil === true;
			const fullClear = clearColor !== false && clearDepth === true && clearStencil === true;
			const threeBuffers = renderer.autoClearColor && renderer.autoClearDepth && renderer.autoClearStencil;
			const textureBackground = isScene(scene) && (scene.background as Texture | null)?.isTexture === true;
			if (fullClear && threeBuffers && !textureBackground) {
				renderer.autoClear = true;
			} else if (needsClear) {
				renderer.clear(clearColor !== false, clearDepth === true, clearStencil === true);
			}

			// render
			renderer.render(scene, camera);
		} finally {
			if (_colorBackground !== undefined) (scene as Scene).background = _colorBackground;
			if (_targetViewport !== undefined) target!.viewport.copy(_targetViewport);

			// All restores run in `finally` so a throw anywhere in the pass can
			// never leave global state or — critically — swapped override
			// materials stuck on scene objects.

			// restore global state
			// if we only use Rendering.renderPass() rather than renderer.render(), we don't need to restore the global state
			// changing renderTarget can be expensive, so we should avoid it if possible
			if (options.restoreGlobalState === true) {
				renderer.setRenderTarget(_renderTarget, _activeCubeFace, _activeMipmapLevel);
				renderer.setViewport(_viewport);
				if (clearColor !== false) {
					renderer.setClearColor(_clearColor, _clearAlpha);
				}
			}

			// restore override material (only if changed)
			if (_overriddenObjects !== undefined) {
				// Restore from the recorded list, not a fresh traverse: the
				// scene may have changed during render, and only these exact
				// objects were swapped.
				for (const obj of _overriddenObjects) {
					const savedMaterial = (obj as any)[SavedMaterialSymbol] as Material | Material[] | undefined;
					if (savedMaterial !== undefined) {
						(obj as ObjectWidthMaterial).material = savedMaterial;
						(obj as any)[SavedMaterialSymbol] = undefined; // clean up
					}
				}
			}
			if (_overrodeGlobal) {
				// global overrides
				if (isScene(scene)) {
					scene.overrideMaterial = _savedOverrideMaterialGlobal as Scene['overrideMaterial'];
				} else {
					scene.material = _savedOverrideMaterialGlobal as Mesh['material'];
				}
			}

			renderer.autoClear = _autoClear;
			renderer.toneMapping = _toneMapping;
			renderer.toneMappingExposure = _toneMappingExposure;
			camera.layers.mask = _layersMask;
		}
	}

	const fragmentPassCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const fragmentPassMesh = new ClipSpaceTriangle();
	const fragmentPassClearColor = {
		rgb: new Color(1, 0, 1),
		alpha: 1,
	};

	type Uniforms = Record<string, IUniform>;

	// Helper type to extract the value type from an IUniform
	type UniformValue<T> = T extends IUniform<infer V> ? V : never

	// Helper type to transform a record of IUniforms to a record of their values
	type UniformValues<U extends Uniforms> = {
		[K in keyof U]: UniformValue<U[K]>
	}

	export type ShaderPassOptions<U extends Uniforms = Uniforms> = {
		target: WebGLRenderTarget | null,
		targetMipmapLevel?: number,
		targetCubeFace?: number,
		shader: Material | ShaderMaterial<U> | RawShaderMaterial<U>,
		uniforms?: UniformValues<U>,
		restoreGlobalState: boolean,
		viewport?: Vector4,
		toneMapping?: ToneMapping,
		toneMappingExposure?: number,
		/**
		 * Clears magenta if not provided, doesn't clear if `false`
		 */
		clearColor?: {
			rgb: ColorRepresentation,
			alpha: number,
		} | false,
		/**
		 * @default true
		 */
		clearDepth?: boolean,
		/**
		 * @default false
		 */
		clearStencil?: boolean,
	}
	export function shaderMaterialPass<U extends Uniforms>(renderer: WebGLRenderer, options: ShaderPassOptions<U>) {
		if (options.uniforms != null) {
			for (let key in options.uniforms) {
				(options.shader as any).uniforms[key].value = options.uniforms[key];
			}
		}

		renderPass(renderer, {
			target: options.target,
			targetMipmapLevel: options.targetMipmapLevel,
			targetCubeFace: options.targetCubeFace,
			camera: fragmentPassCamera,
			scene: fragmentPassMesh,
			clearColor: options.clearColor ?? fragmentPassClearColor,
			clearDepth: options.clearDepth ?? true,
			clearStencil: options.clearStencil ?? false,
			overrideMaterial: options.shader,
			toneMapping: options.toneMapping ?? NoToneMapping,
			toneMappingExposure: options.toneMappingExposure ?? 1.0,
			restoreGlobalState: options.restoreGlobalState,
			viewport: options.viewport,
		});
	}

	const shaderPassMaterialCache: { [key: string]: Material } = {};
	export function shaderPass(
		renderer: WebGLRenderer,
		options: Omit<Rendering.ShaderPassOptions, 'shader'> & {
			shaderKey?: string,
			/**
			 * Varying `varying vec2 vUv;` is defined for you
			 */
			fragmentShader: string
		}
	) {
		const shaderKey = options.shaderKey ?? options.fragmentShader;
		let shader = shaderPassMaterialCache[shaderKey];
		if (!shader) {
			shader = new ShaderMaterial({
				fragmentShader: `varying vec2 vUv;` + options.fragmentShader,
				vertexShader: /*glsl*/`
					varying vec2 vUv;
					void main() {
						vUv = uv;
						gl_Position = vec4(position, 1.0);
					}
				`,
				precision: 'highp',
				uniforms: {},
			});
			for (let key in options.uniforms ?? {}) {
				(shader as any).uniforms[key] = { value: options.uniforms?.[key] };
			}
			shaderPassMaterialCache[shaderKey] = shader;
		}

		return Rendering.shaderMaterialPass(renderer, {
			...options,
			shader,
		});
	}

	export type BlitOptions = {
		source: Texture,
		sourceMipmapLevel?: number,
		target: WebGLRenderTarget | null,
		swizzle?: RGBASwizzle,
		/** if true, three.js renderer.outputColorSpace or target.texture.colorSpace will be respected for the copy. Default false */
		applyOutputColorSpace?: boolean,
		toneMapping?: ToneMapping,
		toneMappingExposure?: number,
		/**
		 * With `applyOutputColorSpace` or `toneMapping`: the source holds premultiplied alpha, so the transform applies to
		 * un-premultiplied colour, premultiplied again after. Opaque pixels and pixels with alpha 0 are unaffected. Has no
		 * effect on a plain copy. Default false
		 */
		premultipliedSource?: boolean,
		targetMipmapLevel?: number,
		targetCubeFace?: number,
		viewport?: Vector4,
		restoreGlobalState: boolean,
		/**
		 * Clear the target first: colour to transparent black, depth and stencil. Default false
		 */
		clear?: boolean,
	}

	const rawCopyMaterials: { [swizzle: string]: RawCopyMaterial } = {
	}
	const copyMaterials: { [swizzle: string]: CopyMaterial } = {
	}
	/**
	 * Copy texture to target using fragment shader pass
	 */
	export function blit(renderer: WebGLRenderer, options: BlitOptions) {
		const swizzle = options.swizzle ?? '';
		const colorTransformRequired = options.applyOutputColorSpace || options.toneMapping;
		
		let shader: Material;

		if (colorTransformRequired) {
			const premultipliedSource = options.premultipliedSource === true;
			const key = premultipliedSource ? `${swizzle}:premultiplied` : swizzle;
			let copyMaterial = copyMaterials[key];
			if (copyMaterial == null) {
				copyMaterial = new CopyMaterial(swizzle, { premultipliedSource });
				copyMaterials[key] = copyMaterial;
			}
			copyMaterial.uniforms.source.value = options.source;
			copyMaterial.uniforms.sourceMipmapLevel.value = options.sourceMipmapLevel ?? 0;
			shader = copyMaterial;
		} else {
			let rawCopyMaterial = rawCopyMaterials[swizzle];
			if (rawCopyMaterial == null) {
				rawCopyMaterial = new RawCopyMaterial(swizzle);
				rawCopyMaterials[swizzle] = rawCopyMaterial;
			}
			rawCopyMaterial.uniforms.source.value = options.source;
			rawCopyMaterial.uniforms.sourceMipmapLevel.value = options.sourceMipmapLevel ?? 0;
			shader = rawCopyMaterial;
		}
		
		shaderMaterialPass(renderer, {
			shader,
			target: options.target,
			targetMipmapLevel: options.targetMipmapLevel,
			targetCubeFace: options.targetCubeFace,
			viewport: options.viewport,
			toneMapping: options.toneMapping ?? NoToneMapping,
			toneMappingExposure: options.toneMappingExposure,
			restoreGlobalState: options.restoreGlobalState,
			clearColor: options.clear === true ? {rgb: 0x00000, alpha: 0} : false,
			clearDepth: options.clear === true,
			clearStencil: options.clear === true,
		});
	}

	export type ClearOptions = {
		target: WebGLRenderTarget | null,
		clearColor: {
			rgb: ColorRepresentation,
			alpha: number,
		},
		clearDepth: boolean,
		clearStencil: boolean,
		restoreGlobalState?: boolean,
	}

	const emptyScene = new Scene();
	export function clear(renderer: WebGLRenderer, options: ClearOptions) {
		renderPass(renderer, {
			target: options.target,
			camera: fragmentPassCamera,
			scene: emptyScene,
			clearColor: options.clearColor,
			clearDepth: options.clearDepth,
			clearStencil: options.clearStencil,
			toneMapping: NoToneMapping,
			restoreGlobalState: options.restoreGlobalState ?? false,
		});
	}

	export function generateMipmaps(renderer: WebGLRenderer, texture: Texture) {
		let gl = renderer.getContext();
		let webglTexture = (renderer.properties.get(texture) as any).__webglTexture;
		renderer.state.bindTexture(gl.TEXTURE_2D, webglTexture);
		gl.generateMipmap(gl.TEXTURE_2D);
	}

	export type ResizeTexture2DOptions = {
		source: Texture,
		width?: number,
		height?: number,
	}
	/**
	 * copy a 2D texture by rendering it to a new render target of the desired size
	 * The original is unchanged
	 */
	export function copyAndResizeTexture2D(renderer: WebGLRenderer, options: ResizeTexture2DOptions): Texture {
		const { source: texture, width, height } = options;
		const resizedTarget = new WebGLRenderTarget(
			width ?? texture.width,
			height ?? texture.height,
			{
				colorSpace: texture.colorSpace as ColorSpace | undefined,
				generateMipmaps: texture.generateMipmaps,
				magFilter: texture.magFilter,
				minFilter: texture.minFilter,
				wrapS: texture.wrapS,
				wrapT: texture.wrapT,
				type: texture.type,
				anisotropy: texture.anisotropy,
				flipY: texture.flipY,
				format: texture.format as PixelFormat | undefined,
				mapping: texture.mapping,
			}
		);

		resizedTarget.texture.image = texture.image;
		resizedTarget.texture.userData = structuredClone(texture.userData);

		Rendering.blit(renderer, {
			source: texture,
			target: resizedTarget,
			restoreGlobalState: true,
			applyOutputColorSpace: false,
		});

		return resizedTarget.texture;
	}

	/**
	 * Clear GPU-bound resources
	 */
	export function dispose() {
		for (let key in shaderPassMaterialCache) {
			shaderPassMaterialCache[key].dispose();
			delete shaderPassMaterialCache[key];
		}
		for (let key in rawCopyMaterials) {
			rawCopyMaterials[key].dispose();
			delete rawCopyMaterials[key];
		}
		for (let key in copyMaterials) {
			copyMaterials[key].dispose();
			delete copyMaterials[key];
		}

		resetState(_tempGlobalState);
	}

}

function isScene(object: Object3D): object is Scene {
	return (object as Scene).isScene;
}