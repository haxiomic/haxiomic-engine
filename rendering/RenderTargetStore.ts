import { MagnificationTextureFilter, MathUtils, NoColorSpace, RGBAFormat, TextureDataType, WebGLRenderTarget } from 'three';

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
			filtering: MagnificationTextureFilter,
			msaaSamples?: number,
		},
		onCreate?: (target: RenderTarget) => void,
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
				// console.log(`RenderTargetStore creating render target ${name}`);
				target = new WebGLRenderTarget(width, height, {
					colorSpace: NoColorSpace,
					anisotropy: 0,
					generateMipmaps: false,
					depthTexture: undefined,
					stencilBuffer: false,
					depthBuffer: options.depthBuffer ?? false,
					type: options.type,
					format: RGBAFormat,
					minFilter: options.filtering,
					magFilter: options.filtering,
					samples: options.msaaSamples ?? 0,
				}) as RenderTarget;
				target.name = name;
				this._renderTargets[name] = target;
				onCreate?.(target);
			}
			else {
				target.texture.type = options.type;
				target.texture.format = RGBAFormat;
				target.texture.minFilter = options.filtering;
				target.texture.magFilter = options.filtering;
				target.depthBuffer = options.depthBuffer ?? false;
				if (
					target.width != width ||
					target.height != height
				) {
					target.setSize(width, height);
				}
			}
		}

		if (target != null) {
			target.texture.width = target.width;
			target.texture.height = target.height;
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