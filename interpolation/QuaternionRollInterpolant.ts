import { Interpolant, LinearInterpolant, Matrix4, Quaternion, Vector3 } from "three";
import { CubicHermiteInterpolant } from "./CubicHermiteInterpolant";
import { NaturalCubicInterpolant } from "./NaturalCubicInterpolant";

export class QuaternionRollInterpolant extends Interpolant {

	quaternions = new Array<Quaternion>();
	zCurve: Interpolant;
	rollXZeroCurve: Interpolant;
	rollCurve: Interpolant;

	constructor(
		times: ArrayLike<number>,
		flatQuaternions: ArrayLike<number>,
		options_?: {
			closed: boolean,
			tension: number,
			interpolation:
				'linear' |
				'locally-smooth' | // cubic hermite / catmull-rom family, fast
				'globally-smooth'  // minimizes acceleration, slow
			keyframeSmoothness?: number[] | Float32Array,
		},
		resultBuffer?: any
	) {
		let options = options_ ?? {
			closed: false,
			tension: 0,
			interpolation: 'locally-smooth',
		};
		super(times, flatQuaternions, 4, resultBuffer);

		// decompose quaternions into basis vectors
		let basisTimes = new Array<number>();
		let xBasisVectors = new Array<Vector3>();
		let zBasisVectors = new Array<Vector3>();

		let m = new Matrix4();
		for (let i = 0; i < times.length; i++) {
			let q = new Quaternion().fromArray(flatQuaternions, i * 4);
			this.quaternions[i] = q;
			m.makeRotationFromQuaternion(q);
			let basisX = new Vector3();
			let basisY = new Vector3();
			let basisZ = new Vector3();
			m.extractBasis(basisX, basisY, basisZ);

			let t = times[i];

			xBasisVectors.push(basisX);
			zBasisVectors.push(basisZ);
			basisTimes.push(t);
		}

		function createCurve(
			times: number[] | Float32Array,
			flatValues: number[] | Float32Array,
			valueSize: number,
			loop: boolean,
		) {
			if (options.interpolation === 'linear') {
				return new LinearInterpolant(times, flatValues, valueSize);
			} else if (options.interpolation === 'locally-smooth') {
				return new CubicHermiteInterpolant(times, flatValues, valueSize, { ...options, closed: loop } );
			} else if (options.interpolation === 'globally-smooth') {
				return new NaturalCubicInterpolant(times, flatValues, valueSize, { ...options, closed: loop } );
			} else {
				throw new Error('unknown interpolation type');
			}
		}

		// create curves
		this.zCurve = createCurve(basisTimes, flattenVector3(zBasisVectors), 3, options.closed);
			
		let rollXTimes = new Array<number>();
		let rollXZeroBasisVectors = new Array<Vector3>();
		let xBasisGlobal0 = xBasisVectors[0] ?? new Vector3(1, 0, 0);
		let x = xBasisGlobal0.clone();

		rollXZeroBasisVectors.push(x);
		rollXTimes.push(basisTimes[0] ?? 0);

		for (let i = 0; i < (basisTimes.length - 1); i++) {
			let t0 = basisTimes[i];
			let t1 = basisTimes[i + 1];
			// subsample the curve
			let subSamples = 30;
			let z = new Vector3().fromArray(this.zCurve.evaluate(t0)).normalize();
			for (let j = 1; j <= subSamples; j++) {
				let u = j / subSamples;
				let t = t0 + (t1 - t0) * u;
				let z1 = new Vector3().fromArray(this.zCurve.evaluate(t)).normalize();

				// what is the rotation required to transform z to z1?
				let q = new Quaternion().setFromUnitVectors(z, z1);

				// apply this transform to x our roll zero vector
				x.applyQuaternion(q);

				// re-align x to be perpendicular to z
				let y = new Vector3().crossVectors(z1, x).normalize();
				x = new Vector3().crossVectors(y, z1).normalize();

				rollXZeroBasisVectors.push(x);
				rollXTimes.push(t);

				z = z1;
			}
		}

		this.rollXZeroCurve = createCurve(rollXTimes, flattenVector3(rollXZeroBasisVectors), 3, false);

		let rollValues = new Array<number>();
		for (let i = 0; i < basisTimes.length; i++) {
			let t = basisTimes[i];
			let xBasis = xBasisVectors[i];
			let zBasis = zBasisVectors[i];

			let rollZeroVector = new Vector3().fromArray(this.rollXZeroCurve.evaluate(t)).normalize();
			// signed angle between xBasis and rollZeroVector
			let angle = angleBetweenUnitVectors(xBasis, rollZeroVector);
			let sign = Math.sign(new Vector3().crossVectors(xBasis, rollZeroVector).dot(zBasis));
			let roll = angle * sign;
			roll = getAngleContinuous(roll, rollValues.length > 0 ? rollValues[rollValues.length - 1] : roll);
			rollValues.push(roll);
		}

		this.rollCurve = createCurve(basisTimes, rollValues, 1, false);
	}

	_q = new Quaternion();
	_m = new Matrix4()	
	interpolate_(i1: number, t0: number, t: number, t1: number) {
		let rollZero = new Vector3().fromArray(this.rollXZeroCurve.evaluate(t)).normalize();
		let roll = this.rollCurve.evaluate(t);
		let zBasis = new Vector3().fromArray(this.zCurve.evaluate(t)).normalize();
		// check z basis is finite
		if (!isFinite(zBasis.x) || !isFinite(zBasis.y) || !isFinite(zBasis.z)) {
			zBasis.set(0, 0, 1);
		}
		let xBasis = rollZero.clone().applyAxisAngle(zBasis, -roll);
		let yBasis = new Vector3().crossVectors(zBasis, xBasis).normalize();
		xBasis.crossVectors(yBasis, zBasis);

		let m = this._m;
		m.makeBasis(xBasis, yBasis, zBasis);
		this._q.setFromRotationMatrix(m);

		// copy to result buffer
		this.resultBuffer[0] = this._q.x;
		this.resultBuffer[1] = this._q.y;
		this.resultBuffer[2] = this._q.z;
		this.resultBuffer[3] = this._q.w;

		return this.resultBuffer;
	}

}

function flattenVector3(a: Array<Vector3>) {
	// flatten xBasisVectors and zBasisVectors basis vectors
	let flat = new Float32Array(a.length * 3);
	for (let i = 0; i < a.length; i++) {
		flat[i * 3 + 0] = a[i].x;
		flat[i * 3 + 1] = a[i].y;
		flat[i * 3 + 2] = a[i].z;
	}
	return flat;
}

/** inner angle */
function angleBetweenUnitVectors(v1: Vector3, v2: Vector3) {
	let dot = v1.dot(v2);
	if (dot > -1 && dot < 1) {
		return Math.acos(v1.dot(v2));
	} else if (dot <= -1) {
		return Math.PI;
	} else {
		return 0;
	}
}

function fract(x: number) { 
	return x - Math.floor(x);
}

function getAngleContinuous(a: number, lastAngle: number) {
	const tau = 2 * Math.PI;

	let u = a / tau + 0.5;
	let uLast = fract(lastAngle / tau + 0.5);
	let du = u - uLast;

	let angle: number;
	if (Math.abs(du) < 0.5) {
		angle = lastAngle + du * tau;
	} else {
		// passed through 0
		let duSmall = 1 - Math.abs(du);
		angle = lastAngle + -Math.sign(du) * duSmall * tau; 
	}

	return angle;
}