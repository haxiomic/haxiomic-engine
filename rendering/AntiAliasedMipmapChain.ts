import { LinearFilter, Texture, Uniform, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import Blur1D from "../materials/Blur1D.js";
import { ShaderMaterial } from "../materials/ShaderMaterial.js";
import { mipmapCount } from "../math/Math.js";
import { Rendering } from "./Rendering.js";
import RenderTargetStore from "./RenderTargetStore.js";
import { Swizzle } from "../materials/Swizzle.js";
import { GaussianTapsMaterial, fullscreenVertexShader } from "./PyramidGaussianBlur.js";

/**
 * Alias-free version of `generateBlurredMipmaps()`, used by it with `antiAliased: true`: the same options, the same
 * levels and sizes, and each level blurred by the same amount (variance), so mip consumers (bloom, blurry reflections,
 * ground projection) keep their look without the shimmer of the original chain. It costs more at high resolution with
 * small kernels (measured at 4K: +0.06 ms at the default 1/16 kernel, +0.15 ms at 0.017).
 *
 * The original chain blurs each level with a 2σ-truncated kernel and decimates vertically with a 2-tap box, which
 * aliases: content moving by a pixel changes the levels by up to ~80% of their peak. Here each level is built from the
 * level above:
 * - from a level that is already smooth: binomial [1,3,3,1] downsample (alias-free on smooth content), then an exact
 *   Gaussian for the remaining variance at the new level
 * - level 1 (from the unblurred image), when the remaining blur would be under `minCoreSigma` texels: blur at full
 *   resolution and decimate in the same separable pass, which needs no prefilter because the Gaussian is one
 *
 * Edges are clamped per level, as in the original chain.
 */
export type AntiAliasedMipmapsOptions = {
	target: WebGLRenderTarget,
	/** As `generateBlurredMipmaps()` */
	blurKernel_heightFraction: number,
	/** As `generateBlurredMipmaps()` @default 0.5 */
	truncationSigma?: number,
	restoreGlobalState?: boolean,
	/**
	 * Level 1 uses downsample-then-blur only if the remaining blur is at least this many texels; below it, level 1 is
	 * blurred at full resolution then decimated. @default 3
	 */
	minCoreSigma?: number,
	/** Gaussian truncation of the per-level blurs, in σ @default 4 */
	coreTruncation?: number,
	/**
	 * Merge adjacent taps of the per-level blurs into bilinear fetches: about half the fetches. Hardware filter weights
	 * are ~8-bit, but the effect on these smooth, cascaded levels was not measurable. @default true
	 */
	coreLinearSampling?: boolean,
	/**
	 * As `generateBlurredMipmaps()`: blur only these channels, written back as a vec4 (e.g. '.a' → vec4(a)). Applied on
	 * every read of the target's levels, as the original chain does.
	 */
	swizzle?: Swizzle,
}

/** Number of levels `generateBlurredMipmaps()` renders: it halves until either side reaches 1 pixel */
function renderedTopLevel(width: number, height: number) {
	let level = 0;
	while (width > 1 && height > 1) {
		width = Math.floor(width / 2);
		height = Math.floor(height / 2);
		level++;
	}
	return level;
}

/**
 * Blur variance (in source pixels²) of each level of the original `generateBlurredMipmaps()` chain: its cascade of
 * truncated x (at the finer level) and y (at the level) Blur1D passes, plus its decimation. Index 0 is the source.
 * (Sampling a level adds the reconstruction filter on top: bilinear 1/6 texel², B-spline 1/3 texel².)
 */
export function blurredMipmapVariances(height: number, levels: number, blurKernel_heightFraction: number, truncationSigma = 0.5) {
	const t = truncationSigma;
	const kernelPixels = blurKernel_heightFraction * height * 0.5;
	// Blur1D truncates at ±1/t σ: variance of a truncated normal
	const b = 1 / t;
	const pdf = Math.exp(-b * b / 2) / Math.sqrt(2 * Math.PI);
	const truncatedFactor = 1 - (2 * b * pdf) / erf(b / Math.SQRT2);
	const sigmaTexels = (kernel: number) => t * (Blur1D.nearestBestKernel(kernel) - 1) / 2;
	const sx = sigmaTexels(kernelPixels), sy = sigmaTexels(kernelPixels * 0.5);
	const variances = [0];
	let v = 0;
	for (let i = 1; i <= levels; i++) {
		v += truncatedFactor * (sx * sx * Math.pow(4, i - 1) + sy * sy * Math.pow(4, i)) / 2;
		// the x pass samples level i-1 between texels and the y decimation is a 2-tap box: ≈ 0.5 level i-1 texels²
		v += 0.5 * Math.pow(4, i - 1);
		variances.push(v);
	}
	return variances;
}

/** binomial [1,3,3,1]/8 downsample variance, in fine texels² */
const BINOMIAL_VARIANCE = 0.75;
/** a level at least this smooth (σ in its own texels) downsamples without aliasing */
const SMOOTH_SIGMA = 0.8;

export function generateAntiAliasedMipmaps(renderer: WebGLRenderer, options: AntiAliasedMipmapsOptions) {
	const { target } = options;
	const truncationSigma = options.truncationSigma ?? 0.5;
	const minCoreSigma = options.minCoreSigma ?? 3;
	const coreTruncation = options.coreTruncation ?? 4;
	const restoreGlobalState = options.restoreGlobalState ?? true;

	if (target.texture.mipmaps == null) {
		target.texture.mipmaps = new Array(mipmapCount(target.width, target.height)).fill({});
	}

	const top = renderedTopLevel(target.width, target.height);
	const merged = options.coreLinearSampling ?? true;
	const swizzle = options.swizzle ?? '';
	const variances = blurredMipmapVariances(target.height, top, options.blurKernel_heightFraction, truncationSigma);
	const store = RenderTargetStore.getStoreForRenderTarget(target);
	const tempOptions = {
		magFilter: LinearFilter,
		minFilter: LinearFilter,
		type: target.texture.type,
		format: target.texture.format as any,
		wrapS: target.texture.wrapS,
		wrapT: target.texture.wrapT,
	};

	if (restoreGlobalState) Rendering.saveGlobalState(renderer);

	let width = target.width, height = target.height;
	for (let i = 1; i <= top; i++) {
		const fineWidth = width, fineHeight = height;
		width = Math.floor(width / 2);
		height = Math.floor(height / 2);
		const scale = Math.pow(2, i);
		const previousSigma = Math.sqrt(variances[i - 1]) / (scale / 2); // in level i-1 texels
		// remaining variance after a binomial downsample, in level i texels²
		const coreVariance = (variances[i] - variances[i - 1] - BINOMIAL_VARIANCE * Math.pow(4, i - 1)) / Math.pow(4, i);
		const downsampleThenBlur = coreVariance > 0 && (i > 1 ? previousSigma >= SMOOTH_SIGMA : Math.sqrt(coreVariance) >= minCoreSigma);

		if (downsampleThenBlur) {
			// binomial downsample of level i-1 → temp, exact Gaussian x → temp2, y → level i
			const down = store.getRenderTarget(`pyramidMips_down_${i}`, width, height, tempOptions);
			const downsample = LodDownsampleMaterial.get(swizzle);
			downsample.uniforms.source.value = target.texture;
			downsample.uniforms.sourceLod.value = i - 1;
			downsample.uniforms.sourceSize.value.set(fineWidth, fineHeight);
			downsample.uniforms.outputSize.value.set(width, height);
			Rendering.shaderMaterialPass(renderer, { target: down, shader: downsample, restoreGlobalState: false });

			const taps = GaussianTapsMaterial.computeTaps(Math.sqrt(coreVariance), coreTruncation, merged);
			const x = store.getRenderTarget(`pyramidMips_x_${i}`, width, height, tempOptions);
			const blurX = GaussianTapsMaterial.get(taps.length, 'x');
			blurX.setTaps(taps);
			blurX.uniforms.source.value = down.texture;
			blurX.uniforms.sourceInvSize.value.set(1 / width, 1 / height);
			blurX.uniforms.direction.value.set(1, 0);
			Rendering.shaderMaterialPass(renderer, { target: x, shader: blurX, restoreGlobalState: false });

			const blurY = GaussianTapsMaterial.get(taps.length, 'y');
			blurY.setTaps(taps);
			blurY.uniforms.source.value = x.texture;
			blurY.uniforms.sourceInvSize.value.set(1 / width, 1 / height);
			blurY.uniforms.direction.value.set(0, 1);
			Rendering.shaderMaterialPass(renderer, { target, targetMipmapLevel: i, shader: blurY, restoreGlobalState: false });
		} else {
			// blur at the finer level and decimate in the same separable pass: x (decimating x) → temp, y (decimating y) → level i
			const sigma = Math.sqrt(Math.max(variances[i] - variances[i - 1], 0.25)) / (scale / 2); // in level i-1 texels
			const radius = Math.min(BlurDecimateMaterial.MAX_RADIUS, Math.ceil(sigma * coreTruncation));
			const x = store.getRenderTarget(`pyramidMips_fx_${i}`, width, fineHeight, tempOptions);
			const blurX = BlurDecimateMaterial.get(radius, merged, swizzle);
			blurX.uniforms.source.value = target.texture;
			blurX.uniforms.sourceLod.value = i - 1;
			blurX.uniforms.sourceSize.value.set(fineWidth, fineHeight);
			blurX.uniforms.outputSize.value.set(width, fineHeight);
			blurX.uniforms.direction.value.set(1, 0);
			blurX.uniforms.sigma.value = sigma;
			Rendering.shaderMaterialPass(renderer, { target: x, shader: blurX, restoreGlobalState: false });

			const blurY = BlurDecimateMaterial.get(radius, merged, '');
			blurY.uniforms.source.value = x.texture;
			blurY.uniforms.sourceLod.value = 0;
			blurY.uniforms.sourceSize.value.set(width, fineHeight);
			blurY.uniforms.outputSize.value.set(width, height);
			blurY.uniforms.direction.value.set(0, 1);
			Rendering.shaderMaterialPass(renderer, { target, targetMipmapLevel: i, shader: blurY, restoreGlobalState: false });
		}
	}

	if (restoreGlobalState) Rendering.restoreGlobalState(renderer);
}

function erf(x: number) {
	// Abramowitz & Stegun 7.1.26
	const s = Math.sign(x);
	x = Math.abs(x);
	const k = 1 / (1 + 0.3275911 * x);
	const y = 1 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-x * x);
	return s * y;
}

/** GLSL `readSource()`: textureLod through a swizzle, cast back to vec4 as Blur1D does ('.a' → vec4(a), '.rg' → .rgrg) */
function swizzleReadGLSL(swizzle: Swizzle) {
	const n = Math.max(swizzle.length - 1, 0);
	const read = `textureLod(tex, uv, lod)${swizzle}`;
	const value = n === 0 || n === 4 ? read : n === 1 ? `vec4(${read})` : n === 2 ? `(${read}).rgrg` : `(${read}).rgbr`;
	return /*glsl*/`vec4 readSource(sampler2D tex, vec2 uv, float lod) { return ${value}; }`;
}

/**
 * [1,3,3,1]/8 downsample (4 bilinear taps) of one mip level, mapping texel centres by normalized coordinates as mip
 * sampling does (so odd sizes line up with how consumers read the level)
 */
class LodDownsampleMaterial extends ShaderMaterial<{
	source: Uniform<Texture | null>,
	sourceLod: Uniform<number>,
	sourceSize: Uniform<Vector2>,
	outputSize: Uniform<Vector2>,
}> {
	static instances = new Map<Swizzle, LodDownsampleMaterial>();
	static get(swizzle: Swizzle) {
		let instance = LodDownsampleMaterial.instances.get(swizzle);
		if (!instance) {
			instance = new LodDownsampleMaterial(swizzle);
			LodDownsampleMaterial.instances.set(swizzle, instance);
		}
		return instance;
	}
	constructor(swizzle: Swizzle) {
		super({
			uniforms: {
				source: new Uniform(null),
				sourceLod: new Uniform(0),
				sourceSize: new Uniform(new Vector2()),
				outputSize: new Uniform(new Vector2()),
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: /*glsl*/`
				uniform sampler2D source;
				uniform float sourceLod;
				uniform vec2 sourceSize;
				uniform vec2 outputSize;
				${swizzleReadGLSL(swizzle)}
				void main() {
					// output texel centre in source texel units
					vec2 c = gl_FragCoord.xy / outputSize * sourceSize;
					vec2 inv = 1.0 / sourceSize;
					gl_FragColor = 0.25 * (
						readSource(source, (c + vec2(-0.75, -0.75)) * inv, sourceLod) +
						readSource(source, (c + vec2( 0.75, -0.75)) * inv, sourceLod) +
						readSource(source, (c + vec2(-0.75,  0.75)) * inv, sourceLod) +
						readSource(source, (c + vec2( 0.75,  0.75)) * inv, sourceLod)
					);
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
	}
}

/**
 * One axis of a Gaussian blur at the finer level, evaluated at the coarser level's texel centres (blur + decimate in one
 * pass). Texel-centred taps with weights computed per fragment, so any size ratio is exact.
 */
class BlurDecimateMaterial extends ShaderMaterial<{
	source: Uniform<Texture | null>,
	sourceLod: Uniform<number>,
	sourceSize: Uniform<Vector2>,
	outputSize: Uniform<Vector2>,
	direction: Uniform<Vector2>,
	sigma: Uniform<number>,
}> {
	static MAX_RADIUS = 48;
	static instances = new Map<string, BlurDecimateMaterial>();
	/**
	 * Compiled per radius so the tap loop unrolls. `merged`: pairs of adjacent taps share one bilinear fetch, placed
	 * per fragment from the two weights (half the fetches; hardware filter weights are ~8-bit)
	 */
	static get(radius: number, merged: boolean, swizzle: Swizzle) {
		const key = `${radius}_${merged}_${swizzle}`;
		let instance = BlurDecimateMaterial.instances.get(key);
		if (!instance) {
			instance = new BlurDecimateMaterial(radius, merged, swizzle);
			BlurDecimateMaterial.instances.set(key, instance);
		}
		return instance;
	}
	constructor(radius: number, merged: boolean, swizzle: Swizzle) {
		const taps = merged ? /*glsl*/`
			for (int j = -RADIUS; j <= RADIUS; j += 2) {
				// texel centres a = base + j + 0.5 and b = a + 1, fetched together
				float xa = base + float(j) + 0.5;
				float da = xa - along, db = da + 1.0;
				float wa = exp(k * da * da);
				float wb = j + 1 <= RADIUS ? exp(k * db * db) : 0.0;
				float w = wa + wb;
				vec2 p = c + direction * (da + wb / w);
				sum += readSource(source, p * inv, sourceLod) * w;
				total += w;
			}
		` : /*glsl*/`
			for (int j = -RADIUS; j <= RADIUS; j++) {
				// texel centre base + j + 0.5 along the axis
				float x = base + float(j) + 0.5;
				float d = x - along;
				float w = exp(k * d * d);
				vec2 p = c + direction * d;
				sum += readSource(source, p * inv, sourceLod) * w;
				total += w;
			}
		`;
		super({
			uniforms: {
				source: new Uniform(null),
				sourceLod: new Uniform(0),
				sourceSize: new Uniform(new Vector2()),
				outputSize: new Uniform(new Vector2()),
				direction: new Uniform(new Vector2(1, 0)),
				sigma: new Uniform(1),
			},
			defines: {
				RADIUS: String(radius),
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: /*glsl*/`
				uniform sampler2D source;
				uniform float sourceLod;
				uniform vec2 sourceSize;
				uniform vec2 outputSize;
				uniform vec2 direction;
				uniform float sigma;
				${swizzleReadGLSL(swizzle)}
				void main() {
					// output texel centre in source texel units
					vec2 c = gl_FragCoord.xy / outputSize * sourceSize;
					float along = dot(c, direction);
					float base = floor(along);
					vec2 inv = 1.0 / sourceSize;
					float k = -0.5 / (sigma * sigma);
					vec4 sum = vec4(0.0);
					float total = 0.0;
					${taps}
					gl_FragColor = sum / total;
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
	}
}
