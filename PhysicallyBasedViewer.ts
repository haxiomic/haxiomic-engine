import { ACESFilmicToneMapping, AgXToneMapping, AmbientLight, ArrayCamera, AxesHelper, Camera, CineonToneMapping, Color, ColorManagement, DirectionalLight, DirectionalLightHelper, GridHelper, HalfFloatType, Layers, LinearToneMapping, Matrix4, NearestFilter, NoColorSpace, NoToneMapping, Object3D, PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, REVISION, RGBAFormat, Scene, SRGBColorSpace, Texture, ToneMapping, Vector2, WebGLRenderer, WebGLRendererParameters, WebGLRenderTarget } from "three";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Console } from "./Console.js";
import { DevUI } from "./dev/DevUI.js";
import { EnvironmentProbes } from "./dev/EnvironmentProbes.js";
import { TextureVisualizer } from "./dev/TextureVisualizer.js";
import { EventEmitter } from "./EventEmitter.js";
import InteractionManager from "./interaction/InteractionManager.js";
import ThreeInteraction from "./interaction/ThreeInteraction.js";
import { Layer } from "./Layer.js";
import { ObjectUtils } from "./ObjectUtils.js";
import { Rendering } from "./rendering/Rendering.js";
import RenderTargetStore from "./rendering/RenderTargetStore.js";
// three js stats
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { TransformGizmo } from "./dev/TransformGizmo.js";

export type PhysicallyBasedViewerOptions<Controls extends {
	enabled?: boolean,
	update?: (dt_s: number) => void,
} = OrbitControls> = {
	canvas: HTMLCanvasElement,
	name?: string,
	camera?: PerspectiveCamera,
	devMode?: boolean,
	controls?: Controls | ((camera: Camera, interactionManager: InteractionManager) => Controls),
	interactionManager?: InteractionManager,
	defaultEnvironment?: boolean,
	defaultLights?: boolean,
	postProcessing?: {
		enabled?: boolean,
		bloom?: boolean,
		bloomStrength?: number,
		bloomRadius?: number,
		bloomThreshold?: number,
		msaaSamples?: number,
	},
	/** explicitly provide parameters to new WebGLRenderer */
	webglRendererParameters?: WebGLRendererParameters,
	toneMapping?: ToneMapping,
	toneMappingExposure?: number,
	shadows?: boolean,
	pixelRatio?: number,
	/** when true, scene.background is set to the environment texture when it is loaded */
	changeBackgroundWithEnvironment?: boolean,
	/** when true, camera position is saved to local storage and restored next load */
	cacheCameraTransform?: boolean,
}

/**
 */
export class PhysicallyBasedViewer<
	Controls extends {
		enabled?: boolean,
		update?: (dt_s: number) => void,
	} = OrbitControls
> {

	readonly name: string;
	readonly logTag: string;
	readonly canvas: HTMLCanvasElement;
	readonly renderer: WebGLRenderer;
	readonly scene = new Scene();
	camera: PerspectiveCamera;

	controls: Controls;
	pixelRatio = window.devicePixelRatio;

	readonly events = {
		beforeUpdate: new EventEmitter<{
			t_s: number,
			dt_s: number,
			camera: Camera,
			scene: Scene,
		}>(),
		beforeRender: new EventEmitter<{
			renderer: WebGLRenderer,
			t_s: number,
			dt_s: number,
			camera: Camera,
			scene: Scene,
		}>(),
		dispose: new EventEmitter<void>(),
		environmentChanged: new EventEmitter<{ scene: Scene, environment: Texture }>(),
	}

	readonly directionalLight: DirectionalLight;

	readonly devMode = new URL(window.location.href).searchParams.has('dev');

	readonly clearColor = {
		rgb: new Color(0x000000),
		alpha: 0,
	}
	readonly renderLayers: Layers;

	toneMapping: ToneMapping = CineonToneMapping;
	toneMappingExposure = 1.0;

	readonly interactionManager: InteractionManager;
	readonly threeInteraction: ThreeInteraction;

	// post processing
	postProcessingEnabled = true;
	readonly effectComposer: EffectComposer;
	readonly renderPass: RenderPass;
	readonly bloomPass: UnrealBloomPass;

	readonly gltfLoader: GLTFLoader;
	protected frameLoopHandle: number = -1;

	protected fallbackAmbientLight = new AmbientLight(0xffffff, 2.0);

	protected renderTargetStore = new RenderTargetStore();

	get postProcessMsaaSamples() {
		return this.effectComposerTarget.samples;
	}
	set postProcessMsaaSamples(samples: number) {
		let samplesChanged = samples !== this.effectComposerTarget.samples;
		if (!samplesChanged) return;
		this.effectComposerTarget.samples = samples;
		this.effectComposer.reset(this.effectComposerTarget);
	}
	protected effectComposerTarget: WebGLRenderTarget;

	dev: {
		root: Object3D,
		textureVisualizer: TextureVisualizer,
		grid: GridHelper,
		stats: Stats,
	} | null = null;

	constructor(
		options: PhysicallyBasedViewerOptions<Controls>
	) {
		this.name = options.name ?? 'PhysicallyBasedViewer';
		this.logTag = `<magenta><b>${this.name}<//>`;
		this.pixelRatio = options.pixelRatio ?? this.pixelRatio;
		this.postProcessingEnabled = options.postProcessing?.enabled ?? this.postProcessingEnabled;
		this.toneMapping = options.toneMapping ?? this.toneMapping;
		this.toneMappingExposure = options.toneMappingExposure ?? this.toneMappingExposure;
		this.renderLayers = new Layers();
		this.renderLayers.enable(Layer.UserInterface);

		this.devMode = options.devMode ?? this.devMode;

		this.camera = options.camera ?? new PerspectiveCamera(40, undefined, 0.01, 100);

		const canvas = options.canvas;
		this.canvas = canvas;

		ColorManagement.enabled = true;
		const renderer = this.renderer = new WebGLRenderer({
			canvas: canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance',
			...options.webglRendererParameters,
		});

		// debug shaders
		renderer.debug.onShaderError = this.onShaderError;

		if (this.devMode) {
			Console.log(`${this.logTag}: <b>three v${REVISION}</>, <cyan>dev mode active<//>`);
			Console.log(`Capabilities`, renderer.capabilities);
			this.renderLayers.enable(Layer.Developer);
		}

		let context = renderer.getContext();
		if (`drawingBufferColorSpace` in context) {
			// context.drawingBufferColorSpace = 'display-p3';
			// Console.log(`${this.logTag}: Using display-p3 color space`);
		}

		// PBR setup
		renderer.toneMappingExposure = this.toneMappingExposure;
		renderer.toneMapping = this.toneMapping;

		const interactionManager = this.interactionManager = options.interactionManager ?? new InteractionManager(canvas, {
			autoCapturePointer: true,
			disableDefaultBehavior: true,
		});

		// three.js interaction system
		this.threeInteraction = new ThreeInteraction(interactionManager, this.scene, this.camera);

		this.gltfLoader = new GLTFLoader();

		if (options.controls == null) {
			let orbitControls = new OrbitControls(this.camera, createDomEventProxy(interactionManager) as any);
			orbitControls.enableDamping = true;
			orbitControls.dampingFactor = 0.1;
			orbitControls.rotateSpeed = 1.1;
			orbitControls.zoomSpeed = 0.5;
			orbitControls.maxDistance = Infinity;
			orbitControls.addEventListener('start', () => {
				canvas.style.cursor = 'grabbing';
			});
			orbitControls.addEventListener('end', () => {
				canvas.style.cursor = 'grab';
			});
			this.controls = orbitControls as any;
		} else {
			this.controls = typeof options.controls === 'function' ? options.controls(this.camera, interactionManager) : options.controls;
		}

		canvas.style.cursor = 'grab';

		interactionManager.attachEventListeners();

		this.camera.position.z = 2;

		// directional light for sun-lit geometry shading
		this.directionalLight = new DirectionalLight(0xffffff, 3.0);
		this.directionalLight.position.set(0, 1, 0);

		// create fallback ambient light to use while HDR environment map is loading
		if (options.defaultLights !== false) {
			this.scene.add(this.fallbackAmbientLight);
			this.scene.add(this.directionalLight);
		}

		// Sync scene background with environment
		if (options.changeBackgroundWithEnvironment === true) {
			this.events.environmentChanged.addListener((e) => {
				e.scene.background = e.environment;
			});
		}

		// load HDR environment map
		if (options.defaultEnvironment !== false) {
			this.loadEnvironment(PhysicallyBasedViewer.defaultEnvironments.studio_small_08_64_hdr);
		}

		// post processing
		this.effectComposerTarget = new WebGLRenderTarget(1, 1, {
			anisotropy: 0,
			colorSpace: NoColorSpace,
			depthBuffer: true,
			format: RGBAFormat,
			generateMipmaps: false,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
			samples: options.postProcessing?.msaaSamples ?? 0,
			stencilBuffer: false,
			type: HalfFloatType,
			wrapS: undefined,
			wrapT: undefined,
		})

		this.effectComposer = new EffectComposer(renderer, this.effectComposerTarget);

		// Scene Render Pass
		this.renderPass = new RenderPass(this.scene, this.camera);
		this.effectComposer.addPass(this.renderPass);

		// Bloom Pass
		this.bloomPass = new UnrealBloomPass(
			new Vector2(1, 1),
			options.postProcessing?.bloomStrength ?? 0.25,
			options.postProcessing?.bloomRadius ?? 0.1,
			options.postProcessing?.bloomThreshold ?? 0.0,
		);
		this.effectComposer.addPass(this.bloomPass);

		// Enable shadows
        if (options.shadows !== false) {
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = PCFSoftShadowMap;
            // renderer.shadowMap.type = VSMShadowMap;
            this.directionalLight.castShadow = true;
            this.directionalLight.shadow.mapSize.width = 1024;
            this.directionalLight.shadow.mapSize.height = 1024;
            this.directionalLight.shadow.camera.near = 0.5;
            this.directionalLight.shadow.camera.far = 500;
        }

		// Camera position caching
		if (options.cacheCameraTransform) {
			let cameraPositionKey = `${this.name}_cameraPosition`;
			let cameraRotationKey = `${this.name}_cameraRotation`;
			let cameraPosition = localStorage.getItem(cameraPositionKey);
			let cameraRotation = localStorage.getItem(cameraRotationKey);
			if (cameraPosition) {
				let position = JSON.parse(cameraPosition);
				this.camera.position.fromArray(position);
			}
			if (cameraRotation) {
				let rotation = JSON.parse(cameraRotation);
				this.camera.rotation.fromArray(rotation);
			}

			// save the camera position to local storage
			let _lastTransform = new Matrix4();
			let _lastSaveTimestamp_s = NaN;
			let cacheInterval_s = 0.1;
			this.events.beforeRender.on(({ camera, t_s }) => {
				let timeSinceLastSave_s = t_s - _lastSaveTimestamp_s;
				let needsSave = timeSinceLastSave_s > cacheInterval_s || isNaN(_lastSaveTimestamp_s);
				// check if the camera has moved
				if (needsSave && !_lastTransform.equals(camera.matrixWorld)) {
					_lastTransform.copy(camera.matrixWorld);
					localStorage.setItem(cameraPositionKey, JSON.stringify(camera.position.toArray()));
					localStorage.setItem(cameraRotationKey, JSON.stringify(camera.rotation.toArray()));
					_lastSaveTimestamp_s = t_s;
				}
			});
		}

		// dev mode
		if (this.devMode) {
			let renderingFolder = DevUI.addFolder('Rendering');
			renderingFolder.close();
			renderingFolder.add(this, 'pixelRatio', 0.1, 3, 0.1);
			renderingFolder.add(this, 'toneMapping', {
				NoToneMapping,
				LinearToneMapping,
				CineonToneMapping,
				ACESFilmicToneMapping,
				AgXToneMapping,
			});
			renderingFolder.add(this, 'postProcessingEnabled');
			renderingFolder.add(this, 'toneMappingExposure', 0, 10);
			renderingFolder.add(this, 'postProcessMsaaSamples', 0, renderer.capabilities.maxSamples, 1).name('MSAA');

			// bloom
			let bloomFolder = renderingFolder.addFolder('Bloom');
			bloomFolder.add(this.bloomPass, 'enabled');
			bloomFolder.add(this.bloomPass, 'strength', 0, 3);
			bloomFolder.add(this.bloomPass, 'radius', 0, 1);
			bloomFolder.add(this.bloomPass, 'threshold', 0, 1);

			this.dev = {
				root: new Object3D(),
				textureVisualizer: new TextureVisualizer(),
				grid: new GridHelper(10, 100, 0x444444, 0x444444),
				stats: new Stats(),
			}
			document.body.appendChild(this.dev.stats.dom);

			let devRoot = this.dev.root;
			this.scene.add(devRoot);
			devRoot.layers.set(Layer.Developer);

			this.dev.textureVisualizer.root.position.x = 1.;
			this.dev.textureVisualizer.root.position.y = -1.;

			devRoot.add(this.dev.textureVisualizer.root);

			// add grid
			this.dev.grid.layers.set(Layer.Developer);
			devRoot.add(this.dev.grid);

			// add axes visualizer
			let axes = new AxesHelper();
			axes.layers.set(Layer.Developer);
			this.dev.grid.add(axes);

			// add directional light visualizer and controls
			let directionalLight = this.directionalLight;

			if (directionalLight.parent != null) {
				let directionalLightVisualizer = new DirectionalLightHelper(directionalLight, 0.5);
				directionalLightVisualizer.layers.set(Layer.Developer);
				devRoot.add(directionalLightVisualizer);

				let directionalLightFolder = DevUI.addFolder('Directional Light');
				directionalLightFolder.add(directionalLight, 'intensity', 0, 10);
				directionalLightFolder.addColor(directionalLight, 'color');
				directionalLightFolder.close();

				let directionalLightGizmo = new TransformGizmo(directionalLight, {
					rotation: false,
				});
				directionalLightGizmo.onChange = () => {
					directionalLightVisualizer.update();
				}
				directionalLightGizmo.traverse((node) => {
					node.layers.disable(Layer.Default);
					node.layers.enable(Layer.Developer);
				});
				directionalLightGizmo.events.change.addListener((e) => { });
				directionalLightGizmo.scale.setScalar(0.4);
				directionalLight.add(directionalLightGizmo);
			}

			let grid = this.dev.grid;
			interactionManager.events.keyDown.addListener((event) => {
				// 'g' key to toggle the grid
				if (event.key === 'g' && event.target === document.body) {
					grid.visible = !grid.visible;
				}

				// shift + P for environment probes
				if (event.key === 'P' && event.target === document.body) {
					let probes = ObjectUtils.getAllInstances(this.scene, EnvironmentProbes);
					if (probes.length === 0) {
						let environmentProbes = new EnvironmentProbes();
						this.scene.add(environmentProbes);
					} else {
						for (let probe of probes) {
							probe.removeFromParent();
							probe.dispose();
						}
					}
				}

				// p to toggle post processing
				if (event.key === 'p' && event.target === document.body) {
					this.postProcessingEnabled = !this.postProcessingEnabled;
					DevUI.ui.controllersRecursive().find(c => c.property === 'postProcessingEnabled')?.updateDisplay();
				}

				// b to toggle bloom
				if (event.key === 'b' && event.target === document.body) {
					this.bloomPass.enabled = !this.bloomPass.enabled;
					DevUI.ui.controllersRecursive().find(c => c.property === 'enabled' && c.object === this.bloomPass)?.updateDisplay();
				}

				// d to toggle dev layer
				if (event.key === 'd' && event.target === document.body) {
					this.renderLayers.toggle(Layer.Developer);
					if (this.dev) {
						this.dev.root.visible = this.renderLayers.isEnabled(Layer.Developer);
					}
				}
			});
		}

		renderer.setAnimationLoop((time, frame) => this.render());
	}

	private _lastRenderTime_ms: number = NaN;

	render(renderTarget: WebGLRenderTarget | null = null, camera: Camera = this.camera) {
		let { renderer, scene } = this;
		let renderTime_ms = performance.now();
		let dt_ms = isNaN(this._lastRenderTime_ms) ? 16 : (renderTime_ms - this._lastRenderTime_ms);
		let maxDt_ms = 1000 / 30;
		dt_ms = Math.min(dt_ms, maxDt_ms);
		this._lastRenderTime_ms = renderTime_ms;
		let dt_s = dt_ms / 1000;

		this.dev?.stats.update();

		let canvas = renderer.domElement;
		
		let targetWidth = Math.floor(canvas.clientWidth * this.pixelRatio);
		let targetHeight = Math.floor(canvas.clientHeight * this.pixelRatio);

		if ((canvas.width !== targetWidth) || (canvas.height !== targetHeight)) {
			// canvas.width = targetWidth;
			// canvas.height = targetHeight;
			renderer.setSize(targetWidth, targetHeight, false);
		}

		let aspect = targetWidth / targetHeight;
		if (isPerspectiveCamera(camera) && camera.aspect != aspect) {
			camera.aspect = aspect;
			camera.updateProjectionMatrix();
		} else if (isArrayCamera(camera)) {
			for (let cam of camera.cameras) {
				cam.aspect = aspect;
				cam.updateProjectionMatrix();
			}
		}

		this.events.beforeUpdate.dispatch({
			t_s: renderTime_ms / 1000,
			dt_s,
			camera,
			scene,
		});

		// updates
		if (this.controls.enabled !== false) {
			this.controls.update?.(dt_s)
		}

		this.events.beforeRender.dispatch({
			renderer,
			t_s: renderTime_ms / 1000,
			dt_s,
			camera,
			scene,
		});

		// effect composer pipeline
		if (this.postProcessingEnabled) {
			this.renderer.toneMappingExposure = this.toneMappingExposure;
			this.renderer.toneMapping = this.toneMapping;
			this.renderer.outputColorSpace = SRGBColorSpace;
			this.renderer.setClearColor(this.clearColor.rgb, this.clearColor.alpha);
			this.renderer.autoClearDepth = true;
			this.renderer.autoClearStencil = true;
			this.camera.layers.mask = this.renderLayers.mask;

			if (this.effectComposer.renderTarget1.width !== targetWidth || this.effectComposer.renderTarget1.height !== targetHeight) {
				this.effectComposer.setSize(targetWidth, targetHeight);
			}
			this.renderer.setViewport(0, 0, targetWidth, targetHeight);
			this.effectComposer.render(dt_s);
		} else {
			Rendering.renderPass(renderer, {
				target: renderTarget,
				scene: scene,
				camera: camera,
				layers: this.renderLayers,
				clearColor: this.clearColor,
				clearDepth: true,
				clearStencil: true,
				toneMapping: this.toneMapping,
				toneMappingExposure: this.toneMappingExposure,
				restoreGlobalState: true,
			});
		}
	}

	dispose = () => {
		Console.log(`${this.logTag}: dispose()</>`);
		window.cancelAnimationFrame(this.frameLoopHandle);
		this.interactionManager.removeEventListeners();
		this.threeInteraction.dispose();
		this.events.dispose.dispatch();
		this.renderTargetStore.clearAndDispose();
		this.renderer.dispose();
	}

	protected _loadEnvironmentPromise: Promise<any> = Promise.resolve(null);
	loadEnvironment = (url: string, onProgress: (event: ProgressEvent) => void = () => { }) => {
		let texturePromise = this._loadEnvironmentPromise.finally(() => new Promise<Texture>((resolve, reject) => {
			const pmremGenerator = new PMREMGenerator(this.renderer)
			pmremGenerator.compileEquirectangularShader()
			new RGBELoader().load(
				url,
				(texture: Texture) => {
					const environment = pmremGenerator.fromEquirectangular(texture).texture
					this.scene.environment = environment;

					this.fallbackAmbientLight.removeFromParent();
					texture.dispose()
					this.events.environmentChanged.dispatch({ environment, scene: this.scene });
					resolve(environment);
				},
				onProgress,
				reject
			);
		}));
		this._loadEnvironmentPromise = texturePromise;
		return texturePromise;
	}

	protected onShaderError(
		gl: WebGLRenderingContext,
		program: WebGLProgram,
		glVertexShader: WebGLShader,
		glFragmentShader: WebGLShader,
	) {
		const parseForErrors = function (gl: WebGLRenderingContext, shader: WebGLShader, name: string) {
			const errors = gl.getShaderInfoLog(shader)?.trim() ?? "";
			const prefix = "Errors in " + name + ":" + "\n\n" + errors;

			if (errors !== "") {
				const code = gl.getShaderSource(shader)?.replace(/\t/g, "  ") ?? "";
				const lines = code.split("\n");
				var linedCode = "";
				var i = 1;
				for (var line of lines) {
					linedCode += (i < 10 ? " " : "") + i + ":\t\t" + line + "\n";
					i++;
				}

				Console.error(prefix + "\n" + linedCode);
			}
		}

		parseForErrors(gl, glVertexShader, 'Vertex Shader');
		parseForErrors(gl, glFragmentShader, 'Fragment Shader');
	}

	static defaultEnvironments = {
		// base64 encoded version of https://hdrihaven.com/files/hdris/studio_small_08_1k.hdr resized to 64x32
		studio_small_08_64_hdr: `data:@file/octet-stream;base64,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`
	}
}

type InteractionEvents = typeof InteractionManager.prototype.events;

// tested with OrbitControls
// improves events handling and allows better interaction with our event system
function createDomEventProxy(interactionManager: InteractionManager, priority?: number) {
	let eventMap: Partial<{ [K in keyof InteractionEvents as Lowercase<K>]: InteractionEvents[K] }> = {};
	for (let key in interactionManager.events) {
		(eventMap as any)[key.toLowerCase()] = (interactionManager.events as any)[key];
	}
	// we remap pointer up to global pointer up to catch edge cases, for example, right click drag out of browser window
	eventMap.pointerup = eventMap.globalpointerup;
	return {
		getRootNode: () => interactionManager.el.getRootNode(),
		addEventListener: (type: string, listener: (event: Event) => void, options: {}) => {
			let eventEmitter: EventEmitter<Event> = (eventMap as any)[type.toLowerCase()];
			if (eventEmitter != null) {
				eventEmitter.addListener(listener, priority);
			} else {
				Console.warn(`DomEventProxy: unknown event type "${type}"`);
			}
		},
		removeEventListener: (type: string, listener: (event: Event) => void, options: {}) => {
			let eventEmitter: EventEmitter<Event> = (eventMap as any)[type.toLowerCase()];
			if (eventEmitter != null) {
				eventEmitter.removeListener(listener);
			} else {
				Console.warn(`DomEventProxy: unknown event type "${type}"`);
			}
		},
		style: {},
		setPointerCapture: (pointerId: number) => {
			interactionManager.el.setPointerCapture(pointerId);
		},
		releasePointerCapture: (pointerId: number) => {
			interactionManager.el.releasePointerCapture(pointerId);
		},
		getBoundingClientRect: () => {
			return interactionManager.el.getBoundingClientRect();
		},
		get clientWidth() {
			return interactionManager.el.clientWidth;
		},
		get clientHeight() {
			return interactionManager.el.clientHeight;
		},
	}

}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
	return camera.type === 'PerspectiveCamera';
}

function isArrayCamera(camera: Camera): camera is ArrayCamera {
	return camera.type === 'ArrayCamera';
}