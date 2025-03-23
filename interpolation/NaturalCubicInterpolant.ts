import { Interpolant } from "three";
import { NaturalCubicSpline } from "./NaturalCubicSpline.js";

export class NaturalCubicInterpolant extends Interpolant {

	naturalCubicSplines = new Array<NaturalCubicSpline>();

	constructor(
		times: ArrayLike<number>,
		flatValues: ArrayLike<number>,
		valueSize: number, // number of dimensions per element
		options: {} = {},
		resultBuffer?: any
	) {
		super(times, flatValues, valueSize, resultBuffer);

		// split flat values into separate arrays for each dimension
		let channels = new Array<Array<number>>();
		for (let i = 0; i < valueSize; i++) {
			channels.push(new Array<number>());
		}

		// extract values into channels
		for (let i = 0; i < flatValues.length; i++) {
			let channel = channels[i % valueSize];
			channel.push(flatValues[i]);
		}

		// initialize natural cubic splines
		for (let i = 0; i < valueSize; i++) {
			this.naturalCubicSplines.push(new NaturalCubicSpline(times, channels[i]));
		}
	}

	_pPrev: number[] = [];
	_p0: number[] = [];
	_p1: number[] = [];
	_pNext: number[] = [];
	_v0: number[] = [];
	_v1: number[] = [];
	interpolate_(i1: number, t0: number, t: number, t1: number) {
		let i0 = i1 - 1;
		let u = (t - t0) / (t1 - t0);

		let result = this.resultBuffer;

		for (let j = 0; j < this.valueSize; j++){
			let spline = this.naturalCubicSplines[j];
			result[j] = spline.getPosition(t);
		}

		return result;
	}

}