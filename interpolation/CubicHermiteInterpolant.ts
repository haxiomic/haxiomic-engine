import { Interpolant } from "three";

export class CubicHermiteInterpolant extends Interpolant {

	tension: number;
	closed: boolean;
	keyframeSmoothness: number[] | Float32Array;

	constructor(
		times: number[] | Float32Array,
		flatValues: number[] | Float32Array,
		valueSize: number,
		options?: {
			closed: boolean,
			tension: number,
			keyframeSmoothness?: number[] | Float32Array,
		},
		resultBuffer?: any
	) {
		options = options || {
			closed: false,
			tension: 0,
		};
		super(times, flatValues, valueSize, resultBuffer);
		this.tension = options.tension;
		this.closed = options.closed;
		this.keyframeSmoothness = options.keyframeSmoothness || [];
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

		let { value: pPrev, time: tPrev } = this.getSample(i0 - 1, this._pPrev);
		let { value: p0 } = this.getSample(i0, this._p0);
		let { value: p1 } = this.getSample(i1, this._p1);
		let { value: pNext, time: tNext } = this.getSample(i1 + 1, this._pNext);

		let smoothness = 1.0 - this.tension;
		
		let keyframeSmoothness = lerp(this.keyframeSmoothness[i0], this.keyframeSmoothness[i1], u);
		if (isFinite(keyframeSmoothness)) {
			smoothness *= keyframeSmoothness;
		}

		let result = this.resultBuffer;

		let mode = 0;
		switch (mode) {
			case 0: {
			// polynomial construction
			let u2 = u * u;
			let u3 = u2 * u;

			let h00 = 2 * u3 - 3 * u2 + 1;
			let h10 = u3 - 2 * u2 + u;
			let h01 = -2 * u3 + 3 * u2;
			let h11 = u3 - u2;

			let dt = t1 - t0;

			let v0 = this.getTangentCatmullRom(i0, smoothness, this._v0);
			let v1 = this.getTangentCatmullRom(i1, smoothness, this._v1);

			let size = this.valueSize;
			for (let i = 0; i < size; i++) {
				result[i] =
					h00 * p0[i] +
					h10 * v0[i] * dt +
					h01 * p1[i] +
					h11 * v1[i] * dt;
			}
			} break;

			case 1: {
			// bezier-lerp construction
			// equivalent to the above, useful as a reference for alternative implementations
			let dtp = t0 - tPrev;
			let dt = t1 - t0;
			let dtn = tNext - t1;

			let size = this.valueSize;
			for (let j = 0; j < size; j++) {
				let xp = pPrev[j];
				let x0 = p0[j];
				let x1 = p1[j];
				let xn = pNext[j];

				// https://splines.readthedocs.io/en/latest/euclidean/catmull-rom-non-uniform.html#Using-Non-Uniform-B%C3%A9zier-Segments
				let c0 =
					x0 + 
					dt * dt * (x0 - xp) / (3 * dtp * (dt + dtp)) * smoothness +
					dtp * (x1 - x0) / (3 * (dt + dtp)) * smoothness
				;
				
				let c1 =
					x1 - 
					dtn * (x1 - x0) / (3 * (dtn + dt)) * smoothness -
					dt * dt * (xn - x1) / (3 * dtn * (dtn + dt)) * smoothness
				;

				let l0 = lerp(x0, c0, u);
				let l1 = lerp(c0, c1, u);
				let l2 = lerp(c1, x1, u);

				let m0 = lerp(l0, l1, u);
				let m1 = lerp(l1, l2, u);

				result[j] = lerp(m0, m1, u);
			}
			} break;

		}

		return result;
	}

	getSample(i: number, result: number[]): {
		time: number,
		value: number[],
	} {
		let times = this.parameterPositions;
		let t: number;

		// handle wrapping
		if (i < 0) {
			if (this.closed) {
				// loop wrapping
				// we assume the last keyframe is the same as the first keyframe
				let dt = times[times.length - 1] - times[times.length - 2];
				t = times[0] - dt;
				this.readValues(times.length - 2, result);
				return {
					time: t,
					value: result,
				}
			} else {
				// mirror wrapping
				let dt = times[1] - times[0];
				t = times[0] - dt * Math.abs(i);
				return {
					time: t,
					value: this.lerp(0, 1, 0 - Math.abs(i), result),
				}
			}
		} else if (i >= times.length) {
			if (this.closed) {
				// loop wrapping
				let dt = times[1] - times[0];
				t = times[times.length - 1] + dt;
				this.readValues(1, result);
				return {
					time: t,
					value: result,
				}
			} else {
				// mirror wrapping
				let i1 = times.length - 1; // last entry
				let i0 = times.length - 2; // second to last entry
				let dt = times[i1] - times[i0];
				t = times[i1] + dt * (i - i1);
				return {
					time: t,
					value: this.lerp(i0, i1, 1 + (i - i1), result),
				}
			}
		} else {
			// no wrapping
			t = times[i];
			this.readValues(i, result);
			return {
				time: t,
				value: result,
			}
		}
	}

	readValues(i: number, result: Array<number>) {
		let values = this.sampleValues;
		let size = this.valueSize;
		for (let j = 0; j < size; j++) {
			result[j] = values[i * size + j];
		}
		return result;
	}

	/**
	 * Lerp between values at indices a and b
	 */
	lerp(aIndex: number, bIndex: number, u: number, result: number[]) {
		let values = this.sampleValues;
		let size = this.valueSize;
		for (let j = 0; j < size; j++) {
			let a = values[aIndex * size + j];
			let b = values[bIndex * size + j];
			result[j] = a + (b - a) * u;
		}
		return result;
	}

	_tPrev: number[] = []
	_tCenter: number[] = []
	_tNext: number[] = []
	getTangentCatmullRom(i: number, m: number, result: number[]) {
		let { value: prev, time: tPrev } = this.getSample(i - 1, this._tPrev);
		let { value: center, time: tCenter } = this.getSample(i, this._tCenter);
		let { value: next, time: tNext } = this.getSample(i + 1, this._tNext);

		let dtPrev = tCenter - tPrev;
		let dtNext = tNext - tCenter;
		let dtAll = tNext - tPrev;

		let size = this.valueSize;
		for (let j = 0; j < size; j++) {
			let xPrev = prev[j];
			let xCenter = center[j];
			let xNext = next[j];

			result[j] = m * (
				dtNext * (xCenter - xPrev) / (dtPrev * dtAll) + 
				dtPrev * (xNext - xCenter) / (dtNext * dtAll)
			);
		}

		return result;
	}

}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}