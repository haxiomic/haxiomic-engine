import { Uniform } from "three";

/**
 * A uniform who's value is the current time in seconds.
 */
export class UniformTime extends Uniform {

	constructor(public modulo: number | null = null, public offset: number = 0) {
		super(0);
		// make 'value' a getter
		Object.defineProperty(this, 'value', {
			get: this.getTime_s,
		});
	}

	getRawTime_s = () => {
		return (window.performance.now() / 1000) + this.offset;
	}

	getTime_s = () => {
		let t_s = this.getRawTime_s();
		if (this.modulo != null) {
			t_s = t_s % this.modulo;
		}
		return t_s;
	}
	
}