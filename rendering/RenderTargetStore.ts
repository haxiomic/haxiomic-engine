import { nearestPowerOfTwo } from '../math/Math.js';
import { ClampToEdgeWrapping, ColorSpace, DepthTexture, LinearFilter, MagnificationTextureFilter, MathUtils, MinificationTextureFilter, NoColorSpace, PixelFormat, RGBAFormat, TextureDataType, UnsignedByteType, WebGLRenderer, WebGLRenderTarget, Wrapping } from 'three';

export enum PowerOfTwoMode {
	None,
	Ceil,
	Floor,
	Nearest,
}

type RenderTarget = WebGLRenderTarget & {
	name: string;
	copyContentWhenReallocating: boolean;
}

export type RenderTargetStoreOptions = {
	powerOfTwoMode?: PowerOfTwoMode,
	depthBuffer?: boolean,
	depthTexture?: DepthTexture,
	type: TextureDataType,
	magFilter: MagnificationTextureFilter,
	minFilter?: MinificationTextureFilter,
	msaaSamples?: number,
	wrapS?: Wrapping,
	wrapT?: Wrapping,
	format?: PixelFormat,
	colorSpace?: ColorSpace,
	allocateMipmaps?: boolean,
	anisotropy?: number,
}

export default class RenderTargetStore {

	static defaultOptions = {
		powerOfTwoMode: PowerOfTwoMode.None,
		depthBuffer: false,
		depthTexture: undefined,
		type: UnsignedByteType,
		magFilter: LinearFilter,
		minFilter: LinearFilter,
		msaaSamples: 0,
		anisotropy: 0,
		wrapS: ClampToEdgeWrapping,
		wrapT: ClampToEdgeWrapping,
		format: RGBAFormat,
		allocateMipmaps: false,
		colorSpace: NoColorSpace,
	}

	protected renderTargets: { [key: string]: RenderTarget } = {};

	getRenderTarget(
		key: string,
		width?: number,
		height?: number,
		options?: RenderTargetStoreOptions,
		/** You may use this to copy content when reallocating as target will be valid during the callback */
		onCreateOrReallocate?: (event: 'create' | 'reallocate', newTarget: RenderTarget, oldTarget: RenderTarget) => void,
	) {
		let target: RenderTarget | undefined = this.renderTargets[key];

		if (width == null || height == null) {
			return target;
		}

		width = Math.max(1, width);
		height = Math.max(1, height);

		// determine texture size
		let textureWidth = 0;
		let textureHeight = 0;
		switch (options?.powerOfTwoMode) {
			default:
			case PowerOfTwoMode.None: {
				textureWidth = Math.round(width);
				textureHeight = Math.round(height);
			} break;
			case PowerOfTwoMode.Ceil: {
				// ~~ is a faster Math.floor
				textureWidth = ~~MathUtils.ceilPowerOfTwo(width);
				textureHeight = ~~MathUtils.ceilPowerOfTwo(height);
			} break;
			case PowerOfTwoMode.Floor: {
				textureWidth = ~~MathUtils.floorPowerOfTwo(width);
				textureHeight = ~~MathUtils.floorPowerOfTwo(height);
			} break;
			case PowerOfTwoMode.Nearest: {
				textureWidth = ~~nearestPowerOfTwo(width);
				textureHeight = ~~nearestPowerOfTwo(height);
			} break;
		}

		// creation
		if (target == null) {
			const defaultOptions = RenderTargetStore.defaultOptions;
			const colorSpace = options?.colorSpace ?? defaultOptions.colorSpace;
			const anisotropy = options?.anisotropy ?? defaultOptions.anisotropy;
			const generateMipmaps = false;
			const stencilBuffer = false;
			const depthBuffer = options?.depthBuffer || !!options?.depthTexture;
			const depthTexture = options?.depthTexture ?? null;
			const type = options?.type ?? defaultOptions.type;
			const format = options?.format ?? defaultOptions.format;
			const magFilter = options?.magFilter ?? defaultOptions.magFilter;
			const minFilter = options?.minFilter ?? options?.magFilter ?? defaultOptions.minFilter;
			const wrapS = options?.wrapS ?? defaultOptions.wrapS;
			const wrapT = options?.wrapT ?? defaultOptions.wrapT;
			const samples = options?.msaaSamples ?? defaultOptions.msaaSamples;
			const allocateMipmaps = options?.allocateMipmaps ?? defaultOptions.allocateMipmaps;

			// console.info(`RenderTargetStore creating render target ${name}`);
			target = new WebGLRenderTarget(textureWidth, textureHeight, {
				colorSpace,
				anisotropy,
				generateMipmaps,
				stencilBuffer,
				depthBuffer,
				depthTexture,
				type,
				format,
				magFilter,
				minFilter,
				wrapS,
				wrapT,
				samples,
			}) as RenderTarget;

			// target.texture.width = target.width;
			// target.texture.height = target.height;
			target.name = key;
			this.renderTargets[key] = target;

			if (allocateMipmaps) {
				initMipmapArray(target);
			}
			onCreateOrReallocate?.('create', target, target);
		} else {
			let needsReallocation = (
				target.width != textureWidth ||
				target.height != textureHeight ||
				options?.msaaSamples !== target?.samples ||
				options?.type !== target?.texture.type
			);

			// update options, here we do not use defaults intentionally
			if (options != null) {
				target.texture.type = options.type;
				target.texture.format = options.format ?? target.texture.format
				target.texture.magFilter = options.magFilter;
				target.texture.minFilter = options.minFilter ?? target.texture.minFilter
				target.texture.wrapS = options.wrapS ?? target.texture.wrapS;
				target.texture.wrapT = options.wrapT ?? target.texture.wrapT;
				target.texture.anisotropy = options.anisotropy ?? target.texture.anisotropy;
				target.samples = options.msaaSamples ?? target.samples;
				target.texture.colorSpace = options.colorSpace ?? target.texture.colorSpace;
				target.depthBuffer = options.depthBuffer ?? false;
				target.depthTexture = options.depthTexture ?? target.depthTexture;
			}

			// resize if needed
			if (needsReallocation) {
				// target.setSize(textureWidth, textureHeight);
				// target.texture.width = target.width;
				// target.texture.height = target.height;
				let newTarget: RenderTarget = new WebGLRenderTarget(textureWidth, textureHeight, {
					anisotropy: target.texture.anisotropy,
					colorSpace: target.texture.colorSpace as ColorSpace,
					depthBuffer: target.depthBuffer,
					depthTexture: target.depthTexture,
					format: target.texture.format as PixelFormat,
					generateMipmaps: target.texture.generateMipmaps,
					magFilter: target.texture.magFilter,
					minFilter: target.texture.minFilter,
					samples: target.samples,
					type: target.texture.type,
					wrapS: target.texture.wrapS,
					wrapT: target.texture.wrapT,
				}) as RenderTarget;
				newTarget.name = key;

				console.log(`RenderTargetStore reallocating render target ${key} to ${textureWidth}x${textureHeight}, ${newTarget.samples} samples, type ${newTarget.texture.type}`, target.texture);

				this.renderTargets[key] = newTarget;

				if (options?.allocateMipmaps) {
					initMipmapArray(newTarget);
				}

				onCreateOrReallocate?.('reallocate', newTarget, target);

				// clear old target
				target.dispose();
				target = newTarget;
			}
		}

		return target;
	}

	disposeRenderTarget(key: string) {
		const target = this.renderTargets[key];
		if (target) {
			target.dispose();
			delete this.renderTargets[key];
		}
	}

	clearAndDisposeAll() {
		for (let name in this.renderTargets) {
			let target = this.renderTargets[name];
			target.dispose();
		}
		this.renderTargets = {};
	}

	static getStoreForRenderTarget(target: WebGLRenderTarget) {
		let store: RenderTargetStore = (target as any)[storeSymbol];
		if (store == null) {
			store = new RenderTargetStore();
			(target as any)[storeSymbol] = store;
			// dispose store when target is disposed
			target.addEventListener('dispose', () => {
				store.clearAndDisposeAll();
			});
		}
		return store;
	}

	static getStoreForRenderer(renderer: WebGLRenderer) {
		let store: RenderTargetStore = (renderer as any)[storeSymbol];
		if (store == null) {
			store = new RenderTargetStore();
			(renderer as any)[storeSymbol] = store;
		}
		return store;
	}

	static getOptionsFromRenderTarget(target: RenderTarget): RenderTargetStoreOptions {
		return {
			powerOfTwoMode: PowerOfTwoMode.None,
			depthBuffer: target.depthBuffer,
			depthTexture: target.depthTexture ?? undefined,
			type: target.texture.type,
			magFilter: target.texture.magFilter,
			minFilter: target.texture.minFilter,
			msaaSamples: target.samples,
			wrapS: target.texture.wrapS,
			wrapT: target.texture.wrapT,
			format: target.texture.format as PixelFormat,
			allocateMipmaps: target.texture.mipmaps != null,
		}
	}

}

const storeSymbol = Symbol('RenderTargetStore');

export function initMipmapArray(target: WebGLRenderTarget) {
	const mipmapCount = Math.floor(Math.log2(Math.max(target.width, target.height))) + 1;
	target.texture.mipmaps = new Array(mipmapCount).fill({});
}