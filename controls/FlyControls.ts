import { Camera, Matrix4, Quaternion, Vector2, Vector3 } from "three";
import InteractionManager from "../interaction/InteractionManager";

export class FlyControls {

	enabled: boolean = true;
	speed = 30;
	angularSpeed = 15;
	damping = 10;
	dragSpeed = 0.5;

	protected keyState = new Map<string, boolean>();
	protected metaState = {
		alt: false,
		ctrl: false,
		shift: false,
	}

	protected listeners = new Array<{
		remove: () => void;
	}>();

	protected velocity = new Vector3();
	protected angularVelocity = new Vector3();
	protected options = {
		speedX: 1,
		speedY: 1,
		speedZ: 1,
	}

	constructor(
		public camera: Camera,
		public readonly interactionManager: InteractionManager,
		options: {
			speedX?: number,
			speedY?: number,
			speedZ?: number,
		} = {}
	) {
		this.options = {
			...this.options,
			...options
		}
		this.attachListeners();
	}

	protected dragging = false;
	protected dragStartPointerXY = new Vector2();
	protected dragStartQuaternion = new Quaternion();
	protected dragPointerDelta = new Vector2();

	attachListeners() {
		this.listeners = [
			this.interactionManager.events.keyDown.addListener((e) => {
				this.keyState.set(e.code, true);
				this.metaState.alt = e.altKey;
				this.metaState.ctrl = e.ctrlKey;
				this.metaState.shift = e.shiftKey;
			}),
			this.interactionManager.events.keyUp.addListener((e) => {
				console.log('up', e.key, e.code, `e.altKey: ${e.altKey}`);
				this.keyState.set(e.code, false);
				this.metaState.alt = e.altKey;
				this.metaState.ctrl = e.ctrlKey;
				this.metaState.shift = e.shiftKey;
			}),
			this.interactionManager.events.pointerDown.addListener((e) => {
				if (!e.isPrimary) return;
				this.dragStartPointerXY.set(e.x, e.y);
				this.dragStartQuaternion.copy(this.camera.quaternion);
				this.dragPointerDelta.set(0, 0);
				this.dragging = true;
			}),
			this.interactionManager.events.pointerMove.addListener((e) => {
				this.dragPointerDelta.set(
					e.x - this.dragStartPointerXY.x,
					e.y - this.dragStartPointerXY.y
				)
			}),
			this.interactionManager.events.globalPointerUp.addListener((e) => {
				if (!e.isPrimary) return;
				this.dragging = false;
				this.dragPointerDelta.set(0, 0);
			}),
			this.interactionManager.events.wheel.addListener((e) => {
				let delta = e.deltaY;
				if (e.deltaMode === 1) {
					delta *= 15;
				}
				this.velocity.z = delta * this.options.speedZ;
				e.preventDefault();
			}),
		];
	}

	detachListeners() {
		this.listeners.forEach(l => l.remove());
		this.listeners.length = 0;
		// clear key state
		this.keyState.clear();
	}

	private _m: Matrix4 = new Matrix4();
	private _v3: Vector3 = new Vector3();
	private _camUp_world = new Vector3();
	update(dt_s: number) {
		if (!this.enabled) return;

		// if alt down, slow down
		let speedMultiplier = 1;
		if (this.metaState.alt) {
			speedMultiplier = 0.25;
		}
		if (this.metaState.shift) {
			speedMultiplier = 4;
		}
		let speed = this.speed * speedMultiplier;

		let angularSpeedMultiplier = 1;
		if (this.metaState.alt) {
			angularSpeedMultiplier = 0.25;
		}
		let angularSpeed = this.angularSpeed * angularSpeedMultiplier;

		// wsad acceleration
		if (this.keyState.get('KeyW') || this.keyState.get('ArrowUp')) {
			this.velocity.z -= dt_s * speed * this.options.speedZ;
		}
		if (this.keyState.get('KeyS') || this.keyState.get('ArrowDown')) {
			this.velocity.z += dt_s * speed * this.options.speedZ;
		}
		if (this.keyState.get('KeyA') || this.keyState.get('ArrowLeft')) {
			this.velocity.x -= dt_s * speed * this.options.speedX;
		}
		if (this.keyState.get('KeyD') || this.keyState.get('ArrowRight')) {
			this.velocity.x += dt_s * speed * this.options.speedX;
		}

		/*
		// yaw (q/e)
		if (this.keyState.get('KeyQ')) {
			this.angularVelocity.y += dt_s * angularSpeed;
		}
		if (this.keyState.get('KeyE')) {
			this.angularVelocity.y -= dt_s * angularSpeed;
		}
		// pitch (r/f)
		if (this.keyState.get('KeyR')) {
			this.angularVelocity.x += dt_s * angularSpeed;
		}
		if (this.keyState.get('KeyF')) {
			this.angularVelocity.x -= dt_s * angularSpeed;
		}
		*/

		// roll (z/x)
		if (this.keyState.get('KeyZ')) {
			this.angularVelocity.z += dt_s * angularSpeed * this.options.speedZ;
		}
		if (this.keyState.get('KeyX')) {
			this.angularVelocity.z -= dt_s * angularSpeed * this.options.speedZ;
		}

		// dragging
		if (this.dragging) {
			let dragSpeedMultiplier = this.metaState.alt ? 0.25 : 1;
			let dragSpeed = this.dragSpeed * dragSpeedMultiplier;

			let initialQuaternion = this.dragStartQuaternion;
			let delta = this.dragPointerDelta;
			
			// find the camera up vector in world space
			// we use this so we can adjust rotation when upside down
			this._m.makeRotationFromQuaternion(initialQuaternion);
			this._m.extractBasis(this._v3, this._camUp_world, this._v3);
			
			let rotationAroundY = new Quaternion().setFromAxisAngle(
				this.camera.up,
				Math.sign(this._camUp_world.y) * -delta.x * dragSpeed * this.options.speedY * Math.PI / 180
			);

			this.camera.quaternion.copy(initialQuaternion.clone().premultiply(rotationAroundY));
			this.camera.rotateX(-delta.y * dragSpeed * this.options.speedX * Math.PI / 180);
		}

		// euler step
		this.camera.translateX(this.velocity.x * dt_s);
		this.camera.translateY(this.velocity.y * dt_s);
		this.camera.translateZ(this.velocity.z * dt_s);
		this.camera.rotateX(this.angularVelocity.x * dt_s);
		this.camera.rotateY(this.angularVelocity.y * dt_s);
		this.camera.rotateZ(this.angularVelocity.z * dt_s);

		// damping
		let previousVelocity = this.velocity.clone();
		let previousAngularVelocity = this.angularVelocity.clone();

		this.velocity.add(this.velocity.clone().multiplyScalar(-this.damping * dt_s));
		this.angularVelocity.add(this.angularVelocity.clone().multiplyScalar(-this.damping * dt_s));

		// clamp velocity to ensure magnitude doesn't increase which can happen if dt is large
		if (this.velocity.length() > previousVelocity.length()) {
			this.velocity.set(0, 0, 0);
		}
		if (this.angularVelocity.length() > previousAngularVelocity.length()) {
			this.angularVelocity.set(0, 0, 0);
		}
	}

}