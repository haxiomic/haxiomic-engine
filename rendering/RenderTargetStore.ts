import { AnyPixelFormat, ClampToEdgeWrapping, MagnificationTextureFilter, MathUtils, MinificationTextureFilter, NoColorSpace, RGBAFormat, TextureDataType, WebGLRenderTarget, Wrapping } from 'three';

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

export default class RenderTargetStore {

	_renderTargets: { [key: string]: RenderTarget } = {};

	getRenderTarget(
		name: string,
		options?: {
			powerOfTwoMode?: PowerOfTwoMode,
			depthBuffer?: boolean,
			width: number,
			height: number,
			type: TextureDataType,
			magFilter: MagnificationTextureFilter,
			minFilter?: MinificationTextureFilter,
			msaaSamples?: number,
			wrapS?: Wrapping,
			wrapT?: Wrapping,
			format?: AnyPixelFormat,
		},
		onCreateOrResize?: (target: RenderTarget) => void,
	) {
		let target = this._renderTargets[name];

		if (options != null) {
			let width = 0;
			let height = 0;

			switch (options.powerOfTwoMode) {
				default:
				case PowerOfTwoMode.None: {
					width = Math.round(options.width);
					height = Math.round(options.height);
				} break;
				case PowerOfTwoMode.Ceil: {
					// ~~ is a faster Math.floor
					width = ~~MathUtils.ceilPowerOfTwo(options.width);
					height = ~~MathUtils.ceilPowerOfTwo(options.height);
				} break;
				case PowerOfTwoMode.Floor: {
					width = ~~MathUtils.floorPowerOfTwo(options.width);
					height = ~~MathUtils.floorPowerOfTwo(options.height);
				} break;
				case PowerOfTwoMode.Nearest: {
					width = ~~nearestPowerOfTwo(options.width);
					height = ~~nearestPowerOfTwo(options.height);
				} break;
			}

			if (target == null) {
				// console.info(`RenderTargetStore creating render target ${name}`);
				target = new WebGLRenderTarget(width, height, {
					colorSpace: NoColorSpace,
					anisotropy: 0,
					generateMipmaps: false,
					stencilBuffer: false,
					depthBuffer: options.depthBuffer ?? false,
					// depthTexture: options.depthBuffer ? undefined : null,
					type: options.type,
					format: options.format ?? RGBAFormat,
					magFilter: options.magFilter,
					minFilter: options.minFilter ?? options.magFilter,
					wrapS: options.wrapS ?? ClampToEdgeWrapping,
					wrapT: options.wrapT ?? ClampToEdgeWrapping,
					samples: options.msaaSamples ?? 0,
				}) as RenderTarget;
				target.texture.width = target.width;
				target.texture.height = target.height;
				target.name = name;
				this._renderTargets[name] = target;
				onCreateOrResize?.(target);
			}
			else {
				target.texture.type = options.type;
				target.texture.format = options.format ?? RGBAFormat;
				target.texture.magFilter = options.magFilter;
				target.texture.minFilter = options.minFilter ?? options.magFilter,
				target.texture.wrapS = options.wrapS ?? ClampToEdgeWrapping;
				target.texture.wrapT = options.wrapT ?? ClampToEdgeWrapping;
				target.depthBuffer = options.depthBuffer ?? false;
				if (
					target.width != width ||
					target.height != height
				) {
					target.setSize(width, height);
					target.texture.width = target.width;
					target.texture.height = target.height;
					onCreateOrResize?.(target);
				}
			}
		}

		return target;
	}

	clearAndDispose() {
		for (let name in this._renderTargets) {
			let target = this._renderTargets[name];
			target.dispose();
		}
		this._renderTargets = {};
	}

}

function nearestPowerOfTwo(value: number) {
    const exponent = Math.round(Math.log2(value));
    const powerOfTwo = Math.pow(2, exponent);
    return powerOfTwo;
}