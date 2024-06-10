import { EventEmitter } from "../EventEmitter";
import { Spring } from "./Spring";

/**
 * Physically based animation of numeric properties of objects
 * 
 * Designed to avoid discontinuities for smooth animation in all conditions
 */
export class Animator {

	onBeforeStep = new EventEmitter<{dt_s: number}>();
	onAfterStep = new EventEmitter<{dt_s: number}>();

	springs = new Map<any, Map<string | number | symbol, {
		target: number,
		params: Spring.Parameters | null,
		velocity: number,
	}>>();

	constructor(onBeforeStep?: (dt_s: number) => void, onAfterStep?: (dt_s: number) => void) {
		if (onBeforeStep) {
			this.onBeforeStep.addListener(e => onBeforeStep(e.dt_s));
		}
		if (onAfterStep) {
			this.onAfterStep.addListener(e => onAfterStep(e.dt_s));
		}
	}

	springTo<Obj, Name extends keyof Obj>(object: Obj, field: Name, target: Obj[Name] & number, params: Spring.Parameters | null = Spring.Exponential(0.5)) {
		if (params != null) {
			let spring = this.getSpringOrCreate(object, field);
			// update the target and parameters
			spring.target = target;
			spring.params = params;
		} else {
			this.setTo(object, field, target);
		}
	}

	/**
	 * Remove animation from the object and set the field to the target value
	 */
	setTo<Obj, Name extends keyof Obj, T extends Obj[Name]>(object: Obj, field: Name, target: T) {
		this.remove(object, field);
		object[field] = target;
	}

	private _springState = { x: 0, targetX: 0, v: 0 };
	step(dt_s: number) {
		if (this.onBeforeStep.hasListeners()) {
			this.onBeforeStep.dispatch({dt_s});
		}
		let springState = this._springState

		// step all springs
		this.springs.forEach((objectSprings, object) => {
			objectSprings.forEach((spring, field) => {
				// step the spring
				springState.x = object[field];
				springState.targetX = spring.target;
				springState.v = spring.velocity;
				if (spring.params != null) {
					Spring.stepSpring(dt_s, springState, spring.params);
				} else {
					// instant transition: set to the target
					springState.x = springState.targetX;
					springState.v = 0;
				}
				// update the object
				object[field] = springState.x;
				spring.velocity = springState.v;

				// remove the spring if it's close enough to the target and velocity is close to 0
				if (Math.abs(springState.x - springState.targetX) < 0.0001 && Math.abs(springState.v) < 0.0001) {
					object[field] = spring.target;
					objectSprings.delete(field);
				}
			});

			// remove the object if it has no more springs
			if (objectSprings.size == 0) {
				this.springs.delete(object);
			}
		});

		if (this.onAfterStep.hasListeners()) {
			this.onAfterStep.dispatch({dt_s});
		}
	}

	private t_last = -1;
	tick() {
		let t_s = performance.now() / 1000;
		let dt_s = this.t_last >= 0 ? t_s - this.t_last : 1/60;
		this.t_last = t_s;
		this.step(dt_s);
		return dt_s;
	}

	startAnimationFrameLoop() {
		let frameLoopHandle = -1;
		let frameLoop = () => {
			this.tick();
			frameLoopHandle = window.requestAnimationFrame(frameLoop);
		};
		frameLoop();

		return {
			stop: () => {
				window.cancelAnimationFrame(frameLoopHandle);
			},
			start: () => {
				frameLoop();
			}
		}
	}

	startIntervalLoop(interval_ms: number = 1000 / 240) {
		let intervalHandle = -1;
		let intervalLoop = () => {
			this.tick();
			intervalHandle = window.setTimeout(intervalLoop, interval_ms);
		};
		intervalLoop();

		return {
			stop: () => {
				window.clearTimeout(intervalHandle);
			},
			start: () => {
				intervalLoop();
			}
		}
	}

	/**
	 * Remove animation for this object and field if it exists
	 * Does not change the value of the field
	 */
	remove<T>(object: T, field: keyof T) {
		let objectSprings = this.springs.get(object);
		if (objectSprings != null) {
			objectSprings.delete(field);
		}
		// if there are no more springs for this object, remove it from the map
		if (objectSprings != null && objectSprings.size == 0) {
			this.springs.delete(object);
		}
	}

	/**
	 * Remove all animations for this object
	 */
	removeObject(object: any) {
		this.springs.delete(object);
	}

	/**
	 * Remove all animations
	 */
	removeAll() {
		this.springs.clear();
	}

	getVelocity<Obj, Name extends keyof Obj>(object: Obj, field: Name) {
		let spring = this.getObjectSprings(object).get(field);
		return spring?.velocity ?? 0;
	}

	/**
	 * Creates a new map if one doesn't already exist for the given object
	 */
	private getObjectSprings(object: any) {
		let objectSprings = this.springs.get(object);
		if (objectSprings == null) {
			// create
			objectSprings = new Map();
			this.springs.set(object, objectSprings);
		}
		return objectSprings;
	}

	/**
	 * Creates a new spring if one doesn't already exist for the given object and field
	 */
	private getSpringOrCreate(object: any, field: string | number | symbol) {
		let objectSprings = this.getObjectSprings(object);
		let spring = objectSprings.get(field);
		if (spring == null) {
			// create
			spring = { target: 0, params: null, velocity: 0 };
			objectSprings.set(field, spring);
		}
		return spring;
	}

}