import { nearestPowerOfTwo } from "../math/Math.js";
import { AnyPixelFormat, ClampToEdgeWrapping, DepthTexture, LinearFilter, MagnificationTextureFilter, MathUtils, MinificationTextureFilter, NoColorSpace, RGBAFormat, TextureDataType, UnsignedByteType, WebGLRenderer, WebGLRenderTarget, Wrapping } from 'three';

export enum PowerOfTwoMode {
	None,
	Ceil,
	Floor,
	Nearest,
}

type RenderTarget = WebGLRenderTarget & {
	name: string;
	texture: {
		width: number;
		height: number;
	}
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
	format?: AnyPixelFormat,
	colorSpace?: string,
	allocateMipmaps?: boolean,
	anisotropy?: number,
}

export default class RenderTargetStore {

	static defaultOptions: RenderTargetStoreOptions = {
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
		width: number,
		height: number,
		options?: RenderTargetStoreOptions,
		onCreateOrResize?: (target: RenderTarget, event: 'create' | 'resize') => void,
	) {
		let target = this.renderTargets[key];

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

		if (target == null) {
			const defaultOptions = RenderTargetStore.defaultOptions;
			// console.info(`RenderTargetStore creating render target ${name}`);
			target = new WebGLRenderTarget(textureWidth, textureHeight, {
				colorSpace: options?.colorSpace ?? defaultOptions.colorSpace,
				anisotropy: options?.anisotropy ?? defaultOptions.anisotropy,
				generateMipmaps: false,
				stencilBuffer: false,
				depthBuffer: options?.depthBuffer || !!options?.depthTexture,
				depthTexture: options?.depthTexture ?? null,
				type: options?.type ?? defaultOptions.type,
				format: options?.format ?? defaultOptions.format,
				magFilter: options?.magFilter ?? defaultOptions.magFilter,
				minFilter: options?.minFilter ?? options?.magFilter ?? defaultOptions.minFilter,
				wrapS: options?.wrapS ?? defaultOptions.wrapS,
				wrapT: options?.wrapT ?? defaultOptions.wrapT,
				samples: options?.msaaSamples ?? defaultOptions.msaaSamples,
			}) as RenderTarget;
			target.texture.width = target.width;
			target.texture.height = target.height;
			target.name = key;
			this.renderTargets[key] = target;

			if (options?.allocateMipmaps) {
				initMipmapArray(target);
			}
			onCreateOrResize?.(target, 'create');
		} else {
			// update options
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
			if (
				target.width != textureWidth ||
				target.height != textureHeight
			) {
				target.setSize(textureWidth, textureHeight);
				target.texture.width = target.width;
				target.texture.height = target.height;

				if (options?.allocateMipmaps) {
					initMipmapArray(target);
				}
				onCreateOrResize?.(target, 'resize');
			}
		}

		return target;
	}

	clearAndDispose() {
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
				store.clearAndDispose();
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

	static getOptionsFromRenderTarget(target: WebGLRenderTarget): RenderTargetStoreOptions {
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
			format: target.texture.format,
			allocateMipmaps: target.texture.mipmaps != null,
		}
	}

}

const storeSymbol = Symbol('RenderTargetStore');

export function initMipmapArray(target: WebGLRenderTarget) {
	const mipmapCount = Math.floor(Math.log2(Math.max(target.width, target.height))) + 1;
	target.texture.mipmaps = new Array(mipmapCount).fill({});
}