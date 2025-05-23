import { Euler, Matrix4, Quaternion, Vector2, Vector3, Vector4 } from "three";
import { Animator, Tween, TweenStepFn } from "./Animator.js";
import { Spring } from "./Spring.js";

export enum QuaternionSpringMode {
	DirectionRollCartesian,
	YawPitchRoll,
}

type SupportedTypes = Vector4 | Vector3 | Vector2 | Quaternion | Euler | number;

type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never
}[keyof T]

/**
 * Extends Animator to add support for animating vectors and quaternions
 */
export class ThreeAnimator {

	animator: Animator;

	get onAfterStep() {
		return this.animator.onAfterStep;
	}
	get onBeforeStep() {
		return this.animator.onBeforeStep;
	}

	quaternionSprings = new Map<Quaternion, {
		q: Quaternion,
		target: Quaternion,
		direction: Vector3,
		directionVelocity: Vector3,
		rollVelocity: number,
		params: Spring.Parameters | null,
		mode: QuaternionSpringMode,
	}>();

	constructor(animator: Animator = new Animator()) {
		this.animator = animator;
		this.animator.onBeforeStep.on(e => this.stepQuaternionSprings(e.dt_s));
	}

	setTo<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] & SupportedTypes
	>(
		object: Obj,
		field: Name,
		target: T
	) {
		if (target instanceof Vector4) {
			let v = object[field] as Vector4;
			this.animator.setTo(v, 'x', target.x);
			this.animator.setTo(v, 'y', target.y);
			this.animator.setTo(v, 'z', target.z);
			this.animator.setTo(v, 'w', target.w);
		} else if (target instanceof Vector3) {
			let v = object[field] as Vector3;
			this.animator.setTo(v, 'x', target.x);
			this.animator.setTo(v, 'y', target.y);
			this.animator.setTo(v, 'z', target.z);
		} else if (target instanceof Vector2) {
			let v = object[field] as Vector2;
			this.animator.setTo(v, 'x', target.x);
			this.animator.setTo(v, 'y', target.y);
		} else if (target instanceof Quaternion) {
			let q = object[field] as Quaternion;
			this.animator.setTo(q, 'x', target.x);
			this.animator.setTo(q, 'y', target.y);
			this.animator.setTo(q, 'z', target.z);
			this.animator.setTo(q, 'w', target.w);
		} else if (target instanceof Euler) {
			let e = object[field] as Euler;
			this.animator.setTo(e, 'x', target.x);
			this.animator.setTo(e, 'y', target.y);
			this.animator.setTo(e, 'z', target.z);
			e.order = target.order;
		} else { // number
			this.animator.setTo(object, field, target as any);
		}
	}

	springTo<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] & SupportedTypes
	>(
		object: Obj,
		field: Name,
		target: T,
		params: Spring.Parameters | null = Spring.Exponential(0.5),
		mode?: QuaternionSpringMode
	) {
		if (target instanceof Vector4) {
			let v = object[field] as Vector4;
			this.animator.springTo(v, 'x', target.x, params);
			this.animator.springTo(v, 'y', target.y, params);
			this.animator.springTo(v, 'z', target.z, params);
			this.animator.springTo(v, 'w', target.w, params);
		} else if (target instanceof Vector3) {
			let v = object[field] as Vector3;
			this.animator.springTo(v, 'x', target.x, params);
			this.animator.springTo(v, 'y', target.y, params);
			this.animator.springTo(v, 'z', target.z, params);
		} else if (target instanceof Vector2) {
			let v = object[field] as Vector2;
			this.animator.springTo(v, 'x', target.x, params);
			this.animator.springTo(v, 'y', target.y, params);
		} else if (target instanceof Quaternion) {
			let q = object[field] as Quaternion;
			let spring = this.getQuaternionSpring(q);

			// update
			spring.target.copy(target).normalize();
			spring.params = params;
			spring.mode = mode ?? QuaternionSpringMode.DirectionRollCartesian;
			
		} else if (target instanceof Euler) {
			let e = object[field] as Euler;
			this.animator.springTo(e, 'x', target.x, params);
			this.animator.springTo(e, 'y', target.y, params);
			this.animator.springTo(e, 'z', target.z, params);
			e.order = target.order;

		} else { // number
			this.animator.springTo(object, field, target as any, params);
		}
	}

	customTweenTo<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] & SupportedTypes
	>(
		object: Obj,
		field: Name,
		target: T,
		duration_s: number,
		step: TweenStepFn
	) {
		if (target instanceof Vector4) {
			let v = object[field] as Vector4;
			this.animator.customTweenTo(v, 'x', target.x, duration_s, step);
			this.animator.customTweenTo(v, 'y', target.y, duration_s, step);
			this.animator.customTweenTo(v, 'z', target.z, duration_s, step);
			this.animator.customTweenTo(v, 'w', target.w, duration_s, step);
		} else if (target instanceof Vector3) {
			let v = object[field] as Vector3;
			this.animator.customTweenTo(v, 'x', target.x, duration_s, step);
			this.animator.customTweenTo(v, 'y', target.y, duration_s, step);
			this.animator.customTweenTo(v, 'z', target.z, duration_s, step);
		} else if (target instanceof Vector2) {
			let v = object[field] as Vector2;
			this.animator.customTweenTo(v, 'x', target.x, duration_s, step);
			this.animator.customTweenTo(v, 'y', target.y, duration_s, step);
		} else if (target instanceof Quaternion) {
			throw new Error('Quaternion customTweenTo not yet supported, try springTo or use Euler');
		} else if (target instanceof Euler) {
			let e = object[field] as Euler;
			this.animator.customTweenTo(e, 'x', target.x, duration_s, step);
			this.animator.customTweenTo(e, 'y', target.y, duration_s, step);
			this.animator.customTweenTo(e, 'z', target.z, duration_s, step);
			e.order = target.order;
		} else { // number
			this.animator.customTweenTo(object, field, target as any, duration_s, step);
		}
	}

	linearTo<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] & SupportedTypes
	>(
		object: Obj,
		field: Name,
		target: T,
		duration_s: number
	) {
		this.customTweenTo(object, field, target, duration_s, Tween.linearStep);
	}

	easeInOutTo<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] & SupportedTypes
	>(
		object: Obj,
		field: Name,
		target: T,
		duration_s: number
	) {
		this.customTweenTo(object, field, target, duration_s, Tween.easeInOutStep);
	}

	easeInTo<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] & SupportedTypes
	>(
		object: Obj,
		field: Name,
		target: T,
		duration_s: number
	) {
		this.customTweenTo(object, field, target, duration_s, Tween.easeInStep);
	}

	easeOutTo<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] & SupportedTypes
	>(
		object: Obj,
		field: Name,
		target: T,
		duration_s: number
	) {
		this.customTweenTo(object, field, target, duration_s, Tween.easeOutStep);
	}

	step(dt_s: number) {
		this.animator.step(dt_s);
	}

	tick() {
		this.animator.tick();
	}

	remove<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
	>(
		object: Obj,
		field: Name
	) {
		let v = object[field];
		if (v instanceof Vector4) {
			this.animator.remove(v, 'x');
			this.animator.remove(v, 'y');
			this.animator.remove(v, 'z');
			this.animator.remove(v, 'w');
		} else if (v instanceof Vector3) {
			this.animator.remove(v, 'x');
			this.animator.remove(v, 'y');
			this.animator.remove(v, 'z');
		} else if (v instanceof Vector2) {
			this.animator.remove(v, 'x');
			this.animator.remove(v, 'y');
		} else if (v instanceof Quaternion) {
			this.quaternionSprings.delete(v);
		} else if (v instanceof Euler) {
			this.animator.remove(v, 'x');
			this.animator.remove(v, 'y');
			this.animator.remove(v, 'z');
		} else { // number
			this.animator.remove(object, field);
		}
	}

	removeAll() {
		this.animator.removeAll();
		this.quaternionSprings.clear();
	}

	getVelocity<
		Obj,
		Name extends KeysOfType<Obj, SupportedTypes>,
		T extends Obj[Name] &
			(Vector4 | Vector3 | Vector2 | { directionVelocity: Vector3, rollVelocity: number } | Euler | number) // supported types
	>(
		object: Obj,
		field: Name,
		into?: T,
	): T {
		let target = object[field];
		if (target instanceof Vector4) {
			let i = (into as Vector4) ?? new Vector4();
			i.x = this.animator.getVelocity(target, 'x');
			i.y = this.animator.getVelocity(target, 'y');
			i.z = this.animator.getVelocity(target, 'z');
			i.w = this.animator.getVelocity(target, 'w');
			return i as T;
		} else if (target instanceof Vector3) {
			let i = (into as Vector3) ?? new Vector3();
			i.x = this.animator.getVelocity(target, 'x');
			i.y = this.animator.getVelocity(target, 'y');
			i.z = this.animator.getVelocity(target, 'z');
			return i as T;
		} else if (target instanceof Vector2) {
			let i = (into as Vector2) ?? new Vector2();
			i.x = this.animator.getVelocity(target, 'x');
			i.y = this.animator.getVelocity(target, 'y');
			return i as T;
		} else if (target instanceof Quaternion) {
			let spring = this.quaternionSprings.get(target);
			return {
				directionVelocity: spring?.directionVelocity ?? new Vector3(),
				rollVelocity: spring?.rollVelocity ?? 0
			} as T;
		} else if (target instanceof Euler) {
			let i = (into as Euler) ?? new Euler();
			i.x = this.animator.getVelocity(target, 'x');
			i.y = this.animator.getVelocity(target, 'y');
			i.z = this.animator.getVelocity(target, 'z');
			i.order = target.order;
			return i as T;
		} else { // number
			return this.animator.getVelocity(object, field) as T;
		}
	}

	startAnimationFrameLoop() {
		return this.animator.startAnimationFrameLoop();
	}

	startIntervalLoop(interval_ms?: number) {
		return this.animator.startIntervalLoop(interval_ms);
	}

	stop() {
		this.animator.stop();
	}

	private stepQuaternionSprings(dt_s: number) {
		// step quaternion springs
		this.quaternionSprings.forEach((spring, q) => {
			if (spring.params) {
				if (spring.mode === QuaternionSpringMode.DirectionRollCartesian) {
					stepSpringQuaternion(dt_s, spring, spring.params);
				} else {
					stepSpringQuaternionSpherical(dt_s, spring, spring.params);
				}
			} else {
				// copy target
				q.copy(spring.target);
				// zero velocity
				spring.directionVelocity.set(0, 0, 0);
				spring.rollVelocity = 0;
			}

			// if quaternions match and velocity close to zero, remove spring
			if (Math.abs(q.dot(spring.target)) > 0.999 && spring.directionVelocity.lengthSq() < 0.0001 && Math.abs(spring.rollVelocity) < 0.0001) {
				this.quaternionSprings.delete(q);
			}
		});
	}

	private getQuaternionSpring(q: Quaternion) {
		let spring = this.quaternionSprings.get(q);
		if (!spring) {
			_m.makeRotationFromQuaternion(q);
			let direction = new Vector3();
			_m.extractBasis(new Vector3(), new Vector3(), direction);
			spring = {
				q: q,
				target: new Quaternion(),
				direction: direction,
				directionVelocity: new Vector3(),
				rollVelocity: 0,
				params: null,
				mode: QuaternionSpringMode.DirectionRollCartesian,
			};
			this.quaternionSprings.set(q, spring);
		}
		return spring;
	}

}

/**
 * Analytic quaternion spring
 * 
 * Todo:
 * - for cameras we want to prefer rotations in xz plane rather than z
 * - animate direction in spherical space rather than cartesian
 */
// working variables to avoid allocations
const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _qMatrix = new Matrix4();
const _springState = {x: 0, v: 0, targetX: 0}
function stepSpringQuaternion(
	dt_s: number,
	state: {
		q: Quaternion,
		target: Quaternion,
		direction: Vector3,
		directionVelocity: Vector3,
		rollVelocity: number,
	},
	parameters: Spring.Parameters
) {

	// step direction spring in cartesian space
	// we should do this in spherical in the future
	let targetDirection = new Vector3();
	let targetYBasis = new Vector3();
	_m.makeRotationFromQuaternion(state.target);
	_m.extractBasis(_x, targetYBasis, targetDirection);

	let directionBefore = state.direction.clone();
	
	// step spring direction
	_springState.x = state.direction.x;
	_springState.v = state.directionVelocity.x;
	_springState.targetX = targetDirection.x;
	Spring.stepSpring(dt_s, _springState, parameters);
	state.direction.x = _springState.x;
	state.directionVelocity.x = _springState.v;

	_springState.x = state.direction.y;
	_springState.v = state.directionVelocity.y;
	_springState.targetX = targetDirection.y;
	Spring.stepSpring(dt_s, _springState, parameters);
	state.direction.y = _springState.x;
	state.directionVelocity.y = _springState.v;

	_springState.x = state.direction.z;
	_springState.v = state.directionVelocity.z;
	_springState.targetX = targetDirection.z;
	Spring.stepSpring(dt_s, _springState, parameters);
	state.direction.z = _springState.x;
	state.directionVelocity.z = _springState.v;

	// update quaternion
	let directionDeltaQuaternion = new Quaternion().setFromUnitVectors(_x.copy(directionBefore).normalize(), _y.copy(state.direction).normalize());
	state.q.premultiply(directionDeltaQuaternion)
	// this forces synchronization of direction and quaternion
	alignQuaternion(state.q, state.direction, _qMatrix);

	// determine roll required to align yBasis with targetYBasis
	let directionToTargetQuaternion = new Quaternion().setFromUnitVectors(state.direction.clone().normalize(), targetDirection);
	_m.makeRotationFromQuaternion(state.q);
	_m.extractBasis(_x, _y, _z);
	let newYBasis = _y.applyQuaternion(directionToTargetQuaternion).clone();
	let rollQuaternion = new Quaternion().setFromUnitVectors(newYBasis, targetYBasis);
	// to axis angle (clamp w)
	let rollAngle = Math.acos(Math.min(1, Math.max(-1, rollQuaternion.w))) * 2;
	let rollSign = _x.crossVectors(newYBasis, targetYBasis).dot(targetDirection) < 0 ? -1 : 1;
	rollAngle = -rollSign * rollAngle;

	// step roll spring
	_springState.x = rollAngle;
	_springState.v = state.rollVelocity;
	_springState.targetX = 0;
	Spring.stepSpring(dt_s, _springState, parameters);
	state.rollVelocity = _springState.v;
	let rollAfter = _springState.x;
	let rollDelta = rollAfter - rollAngle;

	// apply roll correction
	let rollDeltaQuaternion = new Quaternion().setFromAxisAngle(state.direction.clone().normalize(), rollDelta /*-rollAngle * 0.1*/);
	state.q.premultiply(rollDeltaQuaternion);
	state.q.normalize();
}

function stepSpringQuaternionSpherical(
	dt_s: number,
	state: {
		q: Quaternion,
		target: Quaternion,
		direction: Vector3,
		directionVelocity: Vector3,
		rollVelocity: number,
	},
	parameters: Spring.Parameters
) {
	let azimuthVelocity = state.directionVelocity.x;
	let elevationVelocity = state.directionVelocity.y;

	// get quaternion in spherical coordinates
	let elAzRoll = quaternionToPitchYawRoll(state.q);

	// get target quaternion in spherical coordinates
	let targetElAzRoll = quaternionToPitchYawRoll(state.target);

	// step springs
	_springState.x = elAzRoll.x;
	_springState.v = elevationVelocity;
	_springState.targetX = getAngleContinuous(targetElAzRoll.x, elAzRoll.x);
	Spring.stepSpring(dt_s, _springState, parameters);
	elevationVelocity = _springState.v;
	let elevationAfter = _springState.x;

	_springState.x = elAzRoll.y;
	_springState.v = azimuthVelocity;
	_springState.targetX = getAngleContinuous(targetElAzRoll.y, elAzRoll.y);
	Spring.stepSpring(dt_s, _springState, parameters);
	azimuthVelocity = _springState.v;
	let azimuthAfter = _springState.x;

	// update directionVelocity
	state.directionVelocity.x = azimuthVelocity;
	state.directionVelocity.y = elevationVelocity;

	// compose quaternion from spherical coordinates
	// direction from azimuth and elevation
	let direction = new Vector3(
		Math.cos(azimuthAfter) * Math.cos(elevationAfter),
		Math.sin(elevationAfter),
		Math.sin(azimuthAfter) * Math.cos(elevationAfter)
	).normalize();

	// roll alignment spring
	_springState.x = elAzRoll.z;
	_springState.v = state.rollVelocity;
	_springState.targetX = getAngleContinuous(targetElAzRoll.z, elAzRoll.z);
	Spring.stepSpring(dt_s, _springState, parameters);
	state.rollVelocity = _springState.v;
	let rollAfter = _springState.x;

	// compose quaternion from direction and roll
	alignQuaternion(state.q, direction, _qMatrix);
	setRoll(state.q, rollAfter);
}

function quaternionToPitchYawRoll(q: Quaternion, out: Vector3 = new Vector3()) {
	// // get quaternion in spherical coordinates
	_m.makeRotationFromQuaternion(q);
	_m.extractBasis(_x, _y, _z);
	// // azimuth and elevation are found from z direction
	let azimuth = Math.atan2(_z.z, _z.x);
	let elevation = Math.atan2(_z.y, Math.sqrt(_z.x * _z.x + _z.z * _z.z));

	let roll = getRoll(q);

	out.set(elevation, azimuth, roll);
	return out;
}

function setRoll(q: Quaternion, roll: number) {
	let currentRoll_rad = getRoll(q);
	let deltaRoll = roll - currentRoll_rad;
	let objectForward = new Vector3(0, 0, -1).applyQuaternion(q);
	let rotation = new Quaternion().setFromAxisAngle(objectForward, deltaRoll);
	q.premultiply(rotation);
}


/**
 * Aligns quaternion 
 */
const _zBasis = new Vector3();
function alignQuaternion(q: Quaternion, direction: Vector3, outMatrix: Matrix4 = new Matrix4()) {
	outMatrix.makeRotationFromQuaternion(q);
	outMatrix.extractBasis(_x, _y, _z);

	// must ensure _x and _y are orthogonal to zBasis
	_zBasis.copy(direction).normalize();
	
	_x.crossVectors(_y, _zBasis).normalize();
	_y.crossVectors(_zBasis, _x).normalize();

	outMatrix.makeBasis(_x, _y, _zBasis);
	
	q.setFromRotationMatrix(outMatrix);

	return outMatrix;
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

function fract(x: number) { 
	return x - Math.floor(x);
}

function getRoll(quaternion: Quaternion) {
	return getQuaternionPlaneAngle(quaternion, new Vector3(0, 1, 0), new Vector3(0, 0, -1));
}

function getQuaternionPlaneAngle(quaternion: Quaternion, basisDirection: Vector3, basisPlane: Vector3) {
	let objectDirection = basisDirection.clone().applyQuaternion(quaternion);
	let objectPlane = basisPlane.clone().applyQuaternion(quaternion);
	let objectDirectionProjected = objectDirection.projectOnPlane(objectPlane);
	let worldZeroProjected = basisDirection.clone().projectOnPlane(objectPlane);
	let angle = worldZeroProjected.angleTo(objectDirectionProjected);
	// sign of angle
	let sign = Math.sign(worldZeroProjected.cross(objectDirectionProjected).dot(objectPlane));
	angle *= sign;
	return angle;
}