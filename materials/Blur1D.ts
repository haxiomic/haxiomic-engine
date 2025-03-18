import { Texture, Uniform, Vector2 } from 'three';
import { RawShaderMaterial } from './RawShaderMaterial';
import { ShaderMaterial } from './ShaderMaterial';

/**
	@author haxiomic
**/
class Blur1D extends ShaderMaterial<{
	texture: Uniform<Texture | null>,
	textureLodLevel: Uniform<number>,
	invResolution: Uniform<Vector2>,
}> {

	static instances = new Map<string, Blur1D>();

	static get(ctx: WebGLRenderingContext, kernel: number, truncationSigma: number, directionX: number, directionY: number, texture: Texture, width: number, height: number, textureLodLevel = 0): Blur1D {
		kernel = Blur1D.nearestBestKernel(kernel);
		const key = `k${kernel},(${directionX},${directionY}):${truncationSigma}`;
		let instance = Blur1D.instances.get(key);
		if (!instance) {
			instance = new Blur1D(ctx, kernel, truncationSigma, directionX, directionY, true);
			Blur1D.instances.set(key, instance);
		}
		instance.uniforms.texture.value = texture;
		instance.uniforms.textureLodLevel.value = textureLodLevel;
		instance.uniforms.invResolution.value.set(1 / width, 1 / height);
		return instance;
	}

	kernel: number;
	directionX: number;
	directionY: number;

	constructor(ctx: WebGLRenderingContext, kernel: number, truncationSigma: number, directionX: number, directionY: number, linearSampling: boolean) {
		const shaderParts = Blur1D.generateShaderParts(ctx, kernel, truncationSigma, directionX, directionY, linearSampling);
		super({
			uniforms: {
				texture: new Uniform<Texture | null>(null),
				textureLodLevel: new Uniform(0),
				invResolution: new Uniform<Vector2>(new Vector2(1, 1)),
			},
			vertexShader: /*glsl*/`
				uniform vec2 invResolution;

				${shaderParts.varyingDeclarations.join('\n')}

				const vec2 madd = vec2(0.5, 0.5);

				void main() {
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

					vec2 texelCoord = (gl_Position.xy * madd + madd);

					${shaderParts.varyingValues.join('\n')}
				}
			`,
			fragmentShader: /*glsl*/`
				uniform sampler2D texture;
				uniform float textureLodLevel;

				${shaderParts.fragmentDeclarations.join('\n')}

				${shaderParts.varyingDeclarations.join('\n')}

				void main() {
					${shaderParts.fragmentVariables.join('\n')}

					vec4 blend = vec4(0.0);
					${shaderParts.textureSamples.join('\n')}
					gl_FragColor = blend;
				}
			`,
		});

		this.kernel = kernel;
		this.directionX = directionX;
		this.directionY = directionY;
	}

	// Continuing from the previously translated class...
	static generateShaderParts(ctx: WebGLRenderingContext, kernel: number, truncationSigma: number, directionX: number, directionY: number, linearSampling: boolean) {
		// Generate sampling offsets and weights
		const N = Blur1D.nearestBestKernel(kernel);
		const centerIndex = (N - 1) / 2;

		// Generate Gaussian sampling weights over kernel
		let offsets: number[] = [];
		let weights: number[] = [];
		let totalWeight = 0.0;

		for (let i = 0; i < N; i++) {
			const u = i / (N - 1);
			const w = Blur1D.gaussianWeight(u * 2.0 - 1, truncationSigma);
			offsets[i] = (i - centerIndex);
			weights[i] = w;
			totalWeight += w;
		}

		// normalize weights
		for (let i = 0; i < weights.length; i++) {
			weights[i] /= totalWeight;
		}

		// optimize: combine samples to take advantage of hardware linear sampling
		let lerpSampleOffsets: number[] = [];
		let lerpSampleWeights: number[] = [];

		if (linearSampling) {
			let i = 0;
			while (i < N) {
				const A = weights[i];
				const leftOffset = offsets[i];

				if (i + 1 < N) {
					const B = weights[i + 1];
					const lerpWeight = A + B;
					const alpha = B / (A + B);
					const lerpOffset = leftOffset + alpha;
					lerpSampleOffsets.push(lerpOffset);
					lerpSampleWeights.push(lerpWeight);
				} else {
					lerpSampleOffsets.push(leftOffset);
					lerpSampleWeights.push(A);
				}

				i += 2;
			}

			offsets = lerpSampleOffsets;
			weights = lerpSampleWeights;
		}

		// Generate shader parts
		const maxVaryingRows = ctx.getParameter(ctx.MAX_VARYING_VECTORS);
		const maxVaryingVec2 = maxVaryingRows;

		const varyingCount = Math.min(offsets.length, maxVaryingVec2);

		let varyingDeclarations = [];
		let varyingValues = [];
		let fragmentVariables = [];
		let textureSamples = [];

		for (let i = 0; i < varyingCount; i++) {
			varyingDeclarations.push(/*glsl*/`varying vec2 sampleCoord${i};`);
			varyingValues.push(/*glsl*/`sampleCoord${i} = texelCoord + vec2(${Blur1D.glslFloat(offsets[i] * directionX)}, ${Blur1D.glslFloat(offsets[i] * directionY)}) * invResolution;`);
		}

		for (let i = varyingCount; i < offsets.length; i++) {
			fragmentVariables.push(/*glsl*/`vec2 sampleCoord${i} = sampleCoord0 + vec2(${Blur1D.glslFloat((offsets[i] - offsets[0]) * directionX)}, ${Blur1D.glslFloat((offsets[i] - offsets[0]) * directionY)}) * invResolution;`);
		}

		for (let i = 0; i < offsets.length; i++) {
			textureSamples.push(/*glsl*/`blend += textureLod(texture, sampleCoord${i}, textureLodLevel) * ${Blur1D.glslFloat(weights[i])};`);
		}

		return {
			varyingDeclarations,
			varyingValues,
			fragmentDeclarations: varyingCount < offsets.length ? ['uniform vec2 invResolution;'] : [''],
			fragmentVariables,
			textureSamples,
		};
	}

	static nearestBestKernel(idealKernel: number): number {
		const v = Math.round(idealKernel);
		const candidates = [v, v - 1, v + 1, v - 2, v + 2];

		for (const k of candidates) {
			if (k % 2 !== 0 && Math.floor(k / 2) % 2 === 0 && k > 0) {
				return Math.max(k, 3);
			}
		}
		return Math.max(v, 3);
	}

	static gaussianWeight(x: number, truncationSigma: number): number {
		const sigma = truncationSigma;
		const denominator = Math.sqrt(2.0 * Math.PI) * sigma;
		const exponent = -(x * x) / (2.0 * sigma * sigma);
		const weight = (1.0 / denominator) * Math.exp(exponent);
		return weight;
	}

	static glslFloat(f: number): string {
		let s = f.toString();
		if (!s.includes('.')) {
			s += '.';
		}
		return s;
	}

}

export default Blur1D;
