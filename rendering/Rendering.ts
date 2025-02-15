import { Camera, Color, ColorRepresentation, Layers, Material, NoToneMapping, OrthographicCamera, Scene, ShaderMaterial, Texture, ToneMapping, Vector4, WebGLRenderer, WebGLRenderTarget } from "three";
import { CopyMaterial } from "../materials/CopyMaterial";
import ClipSpaceTriangle from "../objects/ClipSpaceTriangle";

export namespace Rendering {

	const _renderPassSnapshot = {
		renderTarget: null as WebGLRenderTarget | null,
		activeMipmapLevel: 0,
		activeCubeFace: 0,
		clearColor: {
			rgb: new Color(),
			alpha: 0,
		},
		viewport: new Vector4(),
	}

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

	export function saveGlobalState(renderer: WebGLRenderer) {
		// update _renderPassSnapshot
		_tempGlobalState.renderTarget = renderer.getRenderTarget();
		_tempGlobalState.activeMipmapLevel = renderer.getActiveMipmapLevel();
		_tempGlobalState.activeCubeFace = renderer.getActiveCubeFace();
		renderer.getClearColor(_tempGlobalState.clearColor.rgb);
		_tempGlobalState.clearColor.alpha = renderer.getClearAlpha();
		renderer.getViewport(_tempGlobalState.viewport);
	}

	export function restoreGlobalState(renderer: WebGLRenderer) {
		renderer.setRenderTarget(_tempGlobalState.renderTarget, _tempGlobalState.activeMipmapLevel, _tempGlobalState.activeCubeFace);
		renderer.setViewport(_tempGlobalState.viewport.x, _tempGlobalState.viewport.y, _tempGlobalState.viewport.z, _tempGlobalState.viewport.w);
		renderer.setClearColor(_tempGlobalState.clearColor.rgb, _tempGlobalState.clearColor.alpha);
	}

	export type RenderPassOptions = {
		scene: Scene,
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
		 * If provided the target will be cleared with this color before rendering
		 * Otherwise the target will not be cleared
		 */
		clearColor: {
			rgb: ColorRepresentation,
			alpha: number,
		} | false,
		/**
		 * If provided the target will be cleared with this depth before rendering
		 * Otherwise the target will not be cleared
		 */
		clearDepth: boolean,
		/**
		 * If provided the target will be cleared with this stencil before rendering
		 * Otherwise the target will not be cleared
		 */
		clearStencil: boolean,
		/**
		 * Override viewport, by default it will spans the entire target
		 */
		viewport?: Vector4,
		/**
		 * If provided the scene will be rendered with this material
		 */
		overrideMaterial?: Material,
		/**
		 * Override camera layers mask
		 */
		layers?: Layers,
		/**
		 * Restore global state after rendering
		 * @default false
		 */
		restoreGlobalState?: boolean,
	}

	/**
	 * Render to texture operation without changing global state
	 * 
	 * This should be used instead of `renderer.render()`
	 */
	export function renderPass(renderer: WebGLRenderer, options: RenderPassOptions) {
		let { target, scene, camera, viewport, clearColor, clearDepth, clearStencil, overrideMaterial, layers } = options;

		// save global state
		_renderPassSnapshot.renderTarget = renderer.getRenderTarget();
		_renderPassSnapshot.activeMipmapLevel = renderer.getActiveMipmapLevel();
		_renderPassSnapshot.activeCubeFace = renderer.getActiveCubeFace();
		let _overrideMaterial = scene.overrideMaterial;
		let _autoClear = renderer.autoClear;
		renderer.getViewport(_renderPassSnapshot.viewport);
		let _toneMapping = renderer.toneMapping;
		let _toneMappingExposure = renderer.toneMappingExposure;
		let _layersMask = camera.layers.mask;

		// change global state
		renderer.autoClear = false;
		renderer.toneMapping = options.toneMapping ?? NoToneMapping;
		renderer.toneMappingExposure = options.toneMappingExposure ?? 1.0;

		renderer.setRenderTarget(target, options.targetMipmapLevel, options.targetCubeFace);

		if (viewport != null) {
			renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
		} else if (target != null) {
			renderer.setViewport(0, 0, target.width, target.height);
		} else {
			let gl = renderer.getContext();
			renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		}

		if (overrideMaterial != null) {
			scene.overrideMaterial = overrideMaterial;
		}

		if (layers != null) {
			camera.layers.mask = layers.mask;
		}

		// clear options
		if (clearColor !== false) {
			renderer.getClearColor(_renderPassSnapshot.clearColor.rgb);
			_renderPassSnapshot.clearColor.alpha = renderer.getClearAlpha();
			renderer.setClearColor(clearColor.rgb, clearColor.alpha);
		}

		let needsClear = clearColor !== false || clearDepth === true || clearStencil === true;
		if (needsClear) {
			renderer.clear(clearColor !== false, clearDepth === true, clearStencil === true);
		}

		// render
		renderer.render(scene, camera);

		// restore global state
		// if we only use Rendering.renderPass() rather than renderer.render(), we don't need to restore the global state
		// changing renderTarget can be expensive, so we should avoid it if possible
		if (options.restoreGlobalState === true) {
			renderer.setRenderTarget(_renderPassSnapshot.renderTarget, _renderPassSnapshot.activeMipmapLevel, _renderPassSnapshot.activeCubeFace);
			renderer.setViewport(_renderPassSnapshot.viewport.x, _renderPassSnapshot.viewport.y, _renderPassSnapshot.viewport.z, _renderPassSnapshot.viewport.w);
			if (clearColor !== false) {
				renderer.setClearColor(_renderPassSnapshot.clearColor.rgb, _renderPassSnapshot.clearColor.alpha);
			}
		}

		scene.overrideMaterial = _overrideMaterial;
		renderer.autoClear = _autoClear;
		renderer.toneMapping = _toneMapping;
		renderer.toneMappingExposure = _toneMappingExposure;
		camera.layers.mask = _layersMask;
	}

	const fragmentPassCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const fragmentPassScene = new Scene();
	const fragmentPassMesh = new ClipSpaceTriangle();
	const fragmentPassClearColor = {
		rgb: new Color(1, 0, 1),
		alpha: 1,
	};
	fragmentPassScene.add(fragmentPassMesh);

	export type ShaderPassOptions = {
		target: WebGLRenderTarget | null,
		shader: ShaderMaterial,
		restoreGlobalState: boolean,
		viewport?: Vector4,
		/**
		 * Clears magenta if not provided, don't clear if null
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
	export function shaderPass(renderer: WebGLRenderer, options: ShaderPassOptions) {
		renderPass(renderer, {
			target: options.target,
			camera: fragmentPassCamera,
			scene: fragmentPassScene,
			clearColor: options.clearColor ?? fragmentPassClearColor,
			clearDepth: options.clearDepth ?? true,
			clearStencil: options.clearStencil ?? false,
			overrideMaterial: options.shader,
			toneMapping: NoToneMapping,
			restoreGlobalState: options.restoreGlobalState,
			viewport: options.viewport,
		});
	}

	export type BlitOptions = {
		source: Texture,
		target: WebGLRenderTarget | null,
		restoreGlobalState: boolean,
	}

	const copyMaterial = new CopyMaterial();
	/**
	 * Copy texture to target using fragment shader pass
	 */
	export function blit(renderer: WebGLRenderer, options: BlitOptions) {
		copyMaterial.uniforms.source.value = options.source;
		shaderPass(renderer, {
			target: options.target,
			shader: copyMaterial,
			restoreGlobalState: options.restoreGlobalState,
			clearColor: false,
			clearDepth: false,
			clearStencil: false,
		});
		copyMaterial.uniforms.source.value = null;
	}

	export type ClearOptions = {
		target: WebGLRenderTarget | null,
		clearColor: {
			rgb: ColorRepresentation,
			alpha: number,
		},
		clearDepth: boolean,
		clearStencil: boolean,
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
		});
	}

	export function generateMipmaps(renderer: WebGLRenderer, texture: Texture) {
		let gl = renderer.getContext();
		let webglTexture = (renderer.properties.get(texture) as any).__webglTexture;
		renderer.state.bindTexture(gl.TEXTURE_2D, webglTexture);
		gl.generateMipmap(gl.TEXTURE_2D);
	}

}