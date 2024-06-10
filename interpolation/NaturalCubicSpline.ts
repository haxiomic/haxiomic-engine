// reference https://github.com/theAlgorithmist/TSNaturalCubicSpline
export class NaturalCubicSpline {

	public invalidate: boolean;  // true when point accelerations need to be recomputed after a point value change
	public readonly times: Array<number>;
	public readonly values: Array<number>;
	public computedPointAccelerations: Array<number> = new Array();
	protected deltaT: Array<number> = new Array();
	protected intervalVelocity: Array<number> = new Array();


	protected pointCount: number;

	/**
	 * times must be strictly increasing
	 */
	constructor(times: ArrayLike<number>, values: ArrayLike<number>) {
		this.times = Array.from(times);
		this.values = Array.from(values);
		this.pointCount = times.length;

		this.invalidate = true;

		this.computePointAccelerations();
	}

	/**
	 * Compute the spline position for a given time
	 *
	 * @param {number} t time
	 */
	public getPosition(t: number): number {
		const { deltaT, intervalVelocity: vel, computedPointAccelerations: acc, values } = this;

		if (this.pointCount == 0) {
			return 0;
		} else if (this.pointCount == 1) {
			return values[0];
		}

		if (this.invalidate) {
			this.computePointAccelerations();
		}

		const { i, x } = this.getInterval(t);

		let x2 = x * x;
		let x3 = x2 * x;
		let T = deltaT[i];

		// cubic coefficients
		let A = (acc[i + 1] - acc[i]) / (6 * T);
		let B = acc[i] / 2;
		let C = vel[i] - T * (acc[i + 1] + 2.0 * acc[i]) / 6;
		let D = values[i];
		
		return A * x3 + B * x2 + C * x + D;
	}

	/**
	 * Compute the first-derivative of the cubic spline at the specified time
	 *
	 * @param {number} t time
	 */
	public getVelocity(t: number): number {
		const { deltaT, intervalVelocity: vel, computedPointAccelerations: acc, values } = this;

		if (this.pointCount == 0 || this.pointCount == 1) {
			return 0;
		}

		if (this.invalidate) {
			this.computePointAccelerations();
		}

		const { i, x } = this.getInterval(t);

		let x2 = x * x;
		let T = deltaT[i];

		// differentiating getPosition() to obtain:
		// cubic coefficients
		let A = 0.5 * (acc[i + 1] - acc[i]) / T;
		let B = acc[i];
		let C = vel[i] - T * (acc[i + 1] + 2.0 * acc[i]) / 6;
		
		return A * x2 + B * x + C;
	}

	/**
	 * Compute the second-derivative of the cubic spline at the specified time
	 *
	 * @param {number} t
	 */
	public getAcceleration(t: number): number {
		const { deltaT, intervalVelocity: vel, computedPointAccelerations: acc, values } = this;

		if (this.pointCount == 0 || this.pointCount == 1) {
			return 0;
		}

		if (this.invalidate) {
			this.computePointAccelerations();
		}

		const { i, x } = this.getInterval(t);

		let T = deltaT[i];

		// differentiating getVelocity() to obtain:
		// cubic coefficients
		let A = (acc[i + 1] - acc[i]) / T;
		let B = acc[i];

		// lerp acceleration between points
		return  A * x + B;
	}

	protected getInterval(t: number) {
		const times = this.times;
		// determine interval
		let i: number = 0;
		let x: number = t - times[0];
		let j: number = this.pointCount - 2;
		while (j >= 0) {
			if (t >= times[j]) {
				x = t - times[j];
				i = j;
				break;
			}
			j--;
		}

		return { i, x }
	}

	/**
	 * compute second-derivative values at the interpolation points (z in paper)
	 */
	protected computePointAccelerations(): void {
		const { deltaT, intervalVelocity, _u: u, _v: v, computedPointAccelerations: a, times, values } = this;

		// pre-generate h^-1
		let i: number = 0;
		while (i < this.pointCount - 1) {
			let dt = times[i + 1] - times[i];
			deltaT[i] = dt;
			intervalVelocity[i] = (values[i + 1] - values[i]) / dt;
			i++;
		}

		// recurrence relations for u(i) and v(i) (tri-diagonal solver)
		u[1] = 2.0 * (deltaT[0] + deltaT[1]);
		v[1] = 6.0 * (intervalVelocity[1] - intervalVelocity[0]);

		i = 2;
		while (i < this.pointCount - 1) {
			u[i] = 2.0 * (deltaT[i] + deltaT[i - 1]) - (deltaT[i - 1] * deltaT[i - 1]) / u[i - 1];
			v[i] = 6.0 * (intervalVelocity[i] - intervalVelocity[i - 1]) - (deltaT[i - 1] * v[i - 1]) / u[i - 1];
			i++;
		}

		// compute a(i), acceleration at point i
		a[this.pointCount - 1] = 0.0;
		i = this.pointCount - 2;

		while (i >= 1) {
			a[i] = (v[i] - deltaT[i] * a[i + 1]) / u[i];
			i--;
		}

		a[0] = 0.0;

		this.invalidate = false;
	}
	private _u: Array<number> = new Array();
	private _v: Array<number> = new Array();

}