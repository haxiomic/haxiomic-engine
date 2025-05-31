import { BackSide, BufferGeometry, Camera, Color, ColorRepresentation, ConeGeometry, CylinderGeometry, Matrix4, Mesh, MeshBasicMaterial, Object3D, Plane, Quaternion, Ray, Raycaster, Scene, TorusGeometry, Vector3, Vector4, WebGLRenderer } from "three";
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EventEmitter } from "../EventEmitter.js";
import { Animator } from "../animation/Animator.js";
import { Spring } from "../animation/Spring.js";
import { makeInteractive } from "../interaction/ThreeInteraction.js";

const springStyle = Spring.Exponential(0.05)
export type TransformName = 'translateX' | 'translateY' | 'translateZ' | 'rotateX' | 'rotateY' | 'rotateZ' | 'scaleX' | 'scaleY' | 'scaleZ'

export enum TransformKind {
	Translate,
	Rotate,
	Scale,
}

export type Transform = {
	name: TransformName,
	kind: TransformKind,
	axisWorldSpace: Vector3,
	magnitude: number,
}

export class TransformGizmo<T extends Object3D> extends Mesh {

	events = {
		changeStart: new EventEmitter<{targetObject: T, transform: Transform}>(),
		change: new EventEmitter<{targetObject: T, transform: Transform}>(),
		changeEnd: new EventEmitter<{targetObject: T, transform: Transform}>(),
	}

	onChangeStart: (targetObject: T, transform: Transform) => void = () => {};
	onChange: (targetObject: T, transform: Transform) => void = () => {};
	onChangeEnd: (targetObject: T, transform: Transform) => void = () => {};

	xAxis: TransformGizmoArrow;
	yAxis: TransformGizmoArrow;
	zAxis: TransformGizmoArrow;
	yzArc: TransformGizmoArc;
	xzArc: TransformGizmoArc;
	xyArc: TransformGizmoArc;

	static defaultOptions: {
		pivotAroundGizmo: boolean,
		viewIndependentSize: number | undefined | false,
		rotation: boolean,
		rotationX: boolean,
		rotationY: boolean,
		rotationZ: boolean,
		translation: boolean,
		translationX: boolean,
		translationY: boolean,
		translationZ: boolean,
		xAxisColor: ColorRepresentation,
		yAxisColor: ColorRepresentation,
		zAxisColor: ColorRepresentation,
		depthTest: boolean,
		interactionPriority: number,
	} = {
		pivotAroundGizmo: true,
		viewIndependentSize: undefined,
		rotation: true,
		rotationX: true,
		rotationY: true,
		rotationZ: true,
		translation: true,
		translationX: true,
		translationY: true,
		translationZ: true,
		xAxisColor: 0xff2060,
		yAxisColor: 0x20df80,
		zAxisColor: 0x2080ff,
		depthTest: true,
		interactionPriority: 10,
	}

	constructor(targetObject: T, options_: Partial<typeof TransformGizmo.defaultOptions> = {}) {
		super();

		let options = {
			...TransformGizmo.defaultOptions,
			...options_,
		};

		this.xAxis = new TransformGizmoArrow(options.xAxisColor, new Vector3(1, 0, 0), 'translateX', options.interactionPriority);
		this.yAxis = new TransformGizmoArrow(options.yAxisColor, new Vector3(0, 1, 0), 'translateY', options.interactionPriority);
		this.zAxis = new TransformGizmoArrow(options.zAxisColor, new Vector3(0, 0, 1), 'translateZ', options.interactionPriority);
		this.yzArc = new TransformGizmoArc(options.xAxisColor, new Vector3(1, 0, 0), 'rotateX', options.interactionPriority);
		this.xzArc = new TransformGizmoArc(options.yAxisColor, new Vector3(0, 1, 0), 'rotateY', options.interactionPriority);
		this.xyArc = new TransformGizmoArc(options.zAxisColor, new Vector3(0, 0, 1), 'rotateZ', options.interactionPriority);

		this.xAxis.material.depthTest = options.depthTest;
		this.yAxis.material.depthTest = options.depthTest;
		this.zAxis.material.depthTest = options.depthTest;
		this.yzArc.material.depthTest = options.depthTest;
		this.xzArc.material.depthTest = options.depthTest;
		this.xyArc.material.depthTest = options.depthTest;

		const {xAxis, yAxis, zAxis} = this;
		const {xyArc, xzArc, yzArc} = this;

		xzArc.rotateZ(Math.PI);
		xyArc.rotateZ(-Math.PI * 0.5);

		if (options.translation) {
			if (options.translationX) {
				this.add(xAxis);
			}
			if (options.translationY) {
				this.add(yAxis);
			}
			if (options.translationZ) {
				this.add(zAxis);
			}
		}

		if (options.rotation) {
			if (options.rotationX) {
				this.add(yzArc);
			}
			if (options.rotationY) {
				this.add(xzArc);
			}
			if (options.rotationZ) {
				this.add(xyArc);
			}
		}

		let dragStartPosition = new Vector3();

		xAxis.onDragStart = yAxis.onDragStart = zAxis.onDragStart = (arrow) => {
			dragStartPosition.copy(targetObject.position);
			// hide other arrows
			xAxis.visible = arrow === xAxis;
			yAxis.visible = arrow === yAxis;
			zAxis.visible = arrow === zAxis;
			// hide arcs
			xyArc.visible = false;
			xzArc.visible = false;
			yzArc.visible = false;
			this.events.changeStart.dispatch({
				targetObject,
				transform: {
					name: arrow.transformName,
					kind: TransformKind.Translate,
					axisWorldSpace: arrow.worldSpaceAxisRay.direction,
					magnitude: 0,
				}
			});
		}
		xAxis.onDragUpdate = yAxis.onDragUpdate = zAxis.onDragUpdate = (arrow, deltaWorldSpace) => {
			// reset to drag start
			targetObject.position.copy(dragStartPosition);

			// apply world space translation into object space
			let toObjectSpace = targetObject.parent?.getWorldQuaternion(new Quaternion()).invert();
			let deltaObjectSpace: Vector3;
			if (toObjectSpace) {
				deltaObjectSpace = deltaWorldSpace.clone().applyQuaternion(toObjectSpace);
			} else {
				deltaObjectSpace = deltaWorldSpace;
			}

			targetObject.position.add(deltaObjectSpace);

			targetObject.updateMatrix();

			this.events.change.dispatch({
				targetObject,
				transform: {
					name: arrow.transformName,
					kind: TransformKind.Translate,
					axisWorldSpace: arrow.worldSpaceAxisRay.direction,
					magnitude: deltaWorldSpace.length(),
				}
			});
		}
		xAxis.onDragEnd = yAxis.onDragEnd = zAxis.onDragEnd = (arrow, deltaWorldSpace) => {
			xAxis.visible = true;
			yAxis.visible = true;
			zAxis.visible = true;
			xyArc.visible = true;
			xzArc.visible = true;
			yzArc.visible = true;
			this.events.changeEnd.dispatch({
				targetObject,
				transform: {
					name: arrow.transformName,
					kind: TransformKind.Translate,
					axisWorldSpace: arrow.worldSpaceAxisRay.direction,
					magnitude: deltaWorldSpace.length(),
				}
			});
		}

		let dragStartQuaternion = new Quaternion();

		xyArc.onDragStart = xzArc.onDragStart = yzArc.onDragStart = (arc) => {
			dragStartPosition.copy(targetObject.position);
			dragStartQuaternion.copy(targetObject.quaternion);
			// hide other arcs
			xyArc.visible = arc === xyArc;
			xzArc.visible = arc === xzArc;
			yzArc.visible = arc === yzArc;
			// hide arrows
			xAxis.visible = false;
			yAxis.visible = false;
			zAxis.visible = false;
			
			this.events.changeStart.dispatch({
				targetObject,
				transform: {
					name: arc.transformName,
					kind: TransformKind.Rotate,
					axisWorldSpace: arc.rotationPlaneWorldSpace.normal,
					magnitude: 0,
				}
			});
		}
		xyArc.onDragUpdate = xzArc.onDragUpdate = yzArc.onDragUpdate = (arc, deltaQuaternionWorldSpace) => {
			// reset to drag start
			targetObject.position.copy(dragStartPosition);
			targetObject.quaternion.copy(dragStartQuaternion);

			// pivot
			if (options.pivotAroundGizmo) {
				let objectWorldPosition = targetObject.getWorldPosition(new Vector3());
				let gizmoWorldPosition = this.getWorldPosition(new Vector3());
				let newObjectWorldPosition = objectWorldPosition.clone().sub(gizmoWorldPosition).applyQuaternion(deltaQuaternionWorldSpace).add(gizmoWorldPosition);

				if (targetObject.parent) {
					targetObject.position.copy(targetObject.parent.worldToLocal(newObjectWorldPosition));
				} else {
					targetObject.position.copy(newObjectWorldPosition);
				}
			}

			// rotate by world space delta
			if (targetObject.parent) {
				let objectWorldQuaternion = targetObject.getWorldQuaternion(new Quaternion());
				let newObjectWorldQuaternion = objectWorldQuaternion.clone().premultiply(deltaQuaternionWorldSpace);

				// convert to object space
				let toObjectSpace = targetObject.parent.getWorldQuaternion(new Quaternion()).invert();
				targetObject.quaternion.copy(newObjectWorldQuaternion).premultiply(toObjectSpace);
			} else {
				targetObject.quaternion.premultiply(deltaQuaternionWorldSpace);
			}

			targetObject.updateMatrix();

			this.events.change.dispatch({
				targetObject,
				transform: {
					name: arc.transformName,
					kind: TransformKind.Rotate,
					axisWorldSpace: arc.rotationPlaneWorldSpace.normal,
					magnitude: 2 * Math.acos(deltaQuaternionWorldSpace.w),
				}
			});
		}
		xyArc.onDragEnd = xzArc.onDragEnd = yzArc.onDragEnd = (arc, deltaQuaternionWorldSpace) => {
			xyArc.visible = true;
			xzArc.visible = true;
			yzArc.visible = true;
			xAxis.visible = true;
			yAxis.visible = true;
			zAxis.visible = true;
			this.events.changeEnd.dispatch({
				targetObject,
				transform: {
					name: arc.transformName,
					kind: TransformKind.Rotate,
					axisWorldSpace: arc.rotationPlaneWorldSpace.normal,
					magnitude: 2 * Math.acos(deltaQuaternionWorldSpace.w),
				}
			});
		}

		// forward events
		this.events.change.addListener(event => this.onChange(event.targetObject, event.transform));
		this.events.changeStart.addListener(event => this.onChangeStart(event.targetObject, event.transform));
		this.events.changeEnd.addListener(event => this.onChangeEnd(event.targetObject, event.transform));
		
		const viewIndependentSize = options.viewIndependentSize;
		if (viewIndependentSize != null && viewIndependentSize !== false) {
			// we want to normalize the scale of the gizmo
			// so that it always has the same size on screen
			// regardless of the distance to the camera
			// this is done by scaling the gizmo by the inverse of the camera distance
			// this is done in onBeforeRender, however onBeforeRender is not called because this is not a mesh or renderable object
			// we can get around this by adding a renderable dummy point to the scene
			this.frustumCulled = false;
			this.renderOrder = -Infinity;
			let _cameraWorldPosition = new Vector3();
			let _objectWorldPosition = new Vector3();
			this.onBeforeRender = (renderer, scene, camera) => {
				_cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
				_objectWorldPosition.setFromMatrixPosition(this.matrixWorld);
				let distance = _cameraWorldPosition.distanceTo(_objectWorldPosition);
				this.scale.setScalar(0.4 * viewIndependentSize * distance);
				// update world matrix of children
				this.updateWorldMatrix(false, true);
			}
		}
	}

}

class TransformGizmoComponent extends Mesh<BufferGeometry, MeshBasicMaterial> {

	animator = new Animator();

	baseColor = new Color();
	hoverColor: Color;

	private _selected = false;
	get selected() {
		return this._selected;
	}
	set selected(v: boolean) {
		if (v && !this._selected) {
			this.events.onSelectStart.dispatch(undefined);
		} else if (!v && this._selected) {
			this.events.onSelectEnd.dispatch(undefined);
		}
		this._selected = v;
	}

	private _hovered = false;
	get hovered() {
		return this._hovered;
	}
	set hovered(v: boolean) {
		if (v && !this._hovered) {
			this.events.onHoverStart.dispatch(undefined);
		} else if (!v && this._hovered) {
			this.events.onHoverEnd.dispatch(undefined);
		}
		this._hovered = v;
	}

	outline: Mesh<BufferGeometry, MeshBasicMaterial>;

	events = {
		onHoverStart: new EventEmitter(),
		onHoverEnd: new EventEmitter(),
		onSelectStart: new EventEmitter(),
		onSelectEnd: new EventEmitter(),
	}

	constructor(
		color: ColorRepresentation,
		geometry: BufferGeometry,
		outlineGeometry: BufferGeometry,
		interactionPriority: number,
	) {
		super(geometry, new MeshBasicMaterial({ color }));

		this.outline = new Mesh(outlineGeometry, new MeshBasicMaterial({
			color: new Color(color).offsetHSL(0.0, 0.0, 0.0),
			transparent: true,
			opacity: 0.0,
			depthTest: true,
			depthWrite: false,
			side: BackSide,
		}));
		this.add(this.outline);

		this.baseColor.set(color);
		this.hoverColor = new Color(color).offsetHSL(0, 0.1, 0.35)
			.multiplyScalar(4.); // beyond 1 for bloom effect

		let thisInteractive = makeInteractive(this, {
			sortPriority: interactionPriority,
			cursor: 'pointer',
			occludePointerEvents: true,
			defaultCapturePointer: true,
		});

		thisInteractive.interaction.events.pointerOver.addListener(() => {
			this.hovered = true;
		});
		thisInteractive.interaction.events.pointerOut.addListener(() => {
			this.hovered = false;
		});
		thisInteractive.interaction.events.pointerDown.addListener(({ event, raycaster, capturePointer }) => {
			if (event.buttons !== 1) return false;
			event.preventDefault();
			event.stopPropagation();
			this.selected = true;

			this.handleDragStart(raycaster);

			capturePointer();
		});
		thisInteractive.interaction.events.pointerMove.addListener(({ event, raycaster, captured }) => {
			if (captured && this.selected) {
				event.preventDefault()
				event.stopPropagation()

				this.handleDragUpdate(raycaster);
			}
		});
		thisInteractive.interaction.events.pointerUp.addListener(({ event, raycaster, captured }) => {
			if (captured && this.selected) {
				event.preventDefault()
				event.stopPropagation()
				this.selected = false;

				this.handleDragEnd(raycaster);
			}
		});
	}

	selectionLerp = 0;
	onBeforeRender = (renderer: WebGLRenderer, scene: Scene, camera: Camera) => {
		let u = this.hovered || this.selected ? 1 : 0;
		this.animator.springTo(this, 'selectionLerp', u, springStyle);

		this.animator.tick();
		this.material.color.lerpColors(this.baseColor, this.hoverColor, this.selectionLerp);
		this.outline.material.opacity = this.selectionLerp;
	};

	handleDragStart(raycaster: Raycaster) { }
	handleDragUpdate(raycaster: Raycaster) { }
	handleDragEnd(raycaster: Raycaster) { }

}

export class TransformGizmoArrow extends TransformGizmoComponent {

	transformName: TransformName;

	onDragStart: (arrow: TransformGizmoArrow) => void = () => {}
	onDragUpdate: (arrow: TransformGizmoArrow, deltaWorldSpace: Vector3) => void = () => {}
	onDragEnd: (arrow: TransformGizmoArrow, deltaWorldSpace: Vector3) => void = () => {}

	transformKind = TransformKind.Translate;

	constructor(color: ColorRepresentation, direction: Vector3 = new Vector3(1, 0, 0), transformName: TransformName, interactionPriority: number) {
		let thickness = 0.035;
		let headThickness = thickness + 0.035;
		let length = 1;
		let arrowGeometry = cached('arrowGeometry', () => 
			createArrowGeometry(thickness, headThickness, length)
		);
		let arrowOutlineGeometry = cached('arrowOutlineGeometry', () => 
			createArrowGeometry(thickness + 0.01, headThickness + 0.01, length + 0.1)
		);

		super(color, arrowGeometry, arrowOutlineGeometry, interactionPriority);

		this.transformName = transformName;

		// rotate to point in correct direction
		this.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), direction);
	}

	pDragStart = NaN;
	worldSpaceAxisRay = new Ray();

	handleDragStart(raycaster: Raycaster): void {
		this.updateWorldMatrix(true, false);
		this.worldSpaceAxisRay.origin.setFromMatrixPosition(this.matrixWorld);
		this.worldSpaceAxisRay.direction.setFromMatrixColumn(this.matrixWorld, 0);

		this.pDragStart = nearestPointOnAxis(raycaster.ray, this.worldSpaceAxisRay);

		this.onDragStart(this)
	}

	handleDragUpdate(raycaster: Raycaster): void {
		this.onDragUpdate(this, this.getDragDelta(raycaster));
	}

	handleDragEnd(raycaster: Raycaster): void {
		this.onDragEnd(this, this.getDragDelta(raycaster));
	}

	protected getDragDelta(raycaster: Raycaster): Vector3 {
		let p = nearestPointOnAxis(raycaster.ray, this.worldSpaceAxisRay);
		let dp = p - this.pDragStart;
		return this.worldSpaceAxisRay.direction.clone().multiplyScalar(dp);
	}

}

class TransformGizmoArc extends TransformGizmoComponent {

	transformName: TransformName;

	onDragStart: (arc: this) => void = () => {};
	onDragUpdate: (arc: this, deltaWorldSpace: Quaternion) => void = () => {};
	onDragEnd: (arc: this, deltaWorldSpace: Quaternion) => void = () => {};

	axis: Vector3;

	constructor(color: ColorRepresentation, axis: Vector3 = new Vector3(1, 0, 0), transformName: TransformName, interactionPriority: number) {
		let tubeRadius = 0.09;
		let arcRadius = 1.;
		let spacing_radians = 1.2;

		let arcTorusGeometry = cached('arcGeometry', () => {
			let geometry = new TorusGeometry(arcRadius, tubeRadius, 32, 32, Math.PI * .5 - spacing_radians);
			geometry.rotateZ(spacing_radians * 0.5);
			geometry.rotateZ(Math.PI * 0.5);
			geometry.scale(1, 1, 0.05) // flatten in z
			return geometry;
		});

		let arcTorusOutlineGeometry = cached('arcOutlineGeometry', () => {
			let geometry = new TorusGeometry(arcRadius, (0.035 + 0.01) * 0.2, 32, 128, Math.PI * 2);
			return geometry;
		});

		super(color, arcTorusGeometry, arcTorusOutlineGeometry, interactionPriority);

		this.transformName = transformName;

		this.axis = axis;

		// rotate to point in correct direction
		this.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), axis);
	}

	rotationPlaneWorldSpace = new Plane();
	pDragStart = new Vector3(); // relative to object
	worldPosition = new Vector3()
	inverseWorldMatrixStart = new Matrix4();
	handleDragStart(raycaster: Raycaster): void {
		this.updateWorldMatrix(true, false);
		this.inverseWorldMatrixStart.copy(this.matrixWorld).invert();
		// get world position
		this.worldPosition.setFromMatrixPosition(this.matrixWorld);
		
		this.rotationPlaneWorldSpace.set(new Vector3(0, 0, 1), 0).applyMatrix4(this.matrixWorld);
		
		// cast ray into plane
		raycaster.ray.intersectPlane(this.rotationPlaneWorldSpace, this.pDragStart);
		this.pDragStart.sub(this.worldPosition);
		// normalize
		this.pDragStart.normalize();

		this.onDragStart(this);
	}

	handleDragUpdate(raycaster: Raycaster): void {
		this.onDragUpdate(this, this.getDragDelta(raycaster));
	}

	handleDragEnd(raycaster: Raycaster): void {
		this.onDragEnd(this, this.getDragDelta(raycaster));
	}

	pDrag = new Vector3();
	protected getDragDelta(raycaster: Raycaster): Quaternion {
		// cast ray into plane
		raycaster.ray.intersectPlane(this.rotationPlaneWorldSpace, this.pDrag);
		this.pDrag.sub(this.worldPosition);
		// normalize
		this.pDrag.normalize();
		// get rotation from pDragStart to pDrag
		return new Quaternion().setFromUnitVectors(this.pDragStart, this.pDrag);
	}


}

let nearestPointOnAxis_Nv = new Vector3();
let nearestPointOnAxis_Na = new Vector3();
let nearestPointOnAxis_Db = new Vector3();
let nearestPointOnAxis_db = new Vector3();
const nearestPointOnAxis = (ray: Ray, axisRay: Ray) => {
	// find nearest point on axis
	// https://stackoverflow.com/questions/58151978/threejs-how-to-calculate-the-closest-point-on-a-three-ray-to-another-three-ray
	let Nv = nearestPointOnAxis_Nv.copy(ray.direction).cross(axisRay.direction);
	let Na = nearestPointOnAxis_Na.copy(ray.direction).cross(Nv).normalize();
	let Db = nearestPointOnAxis_Db.copy(axisRay.direction).normalize();
	let db = nearestPointOnAxis_db.copy(ray.origin).sub(axisRay.origin).dot(Na) / Db.dot(Na);
	return db;
}

let _cache: { [key: string]: any } = {};
function cached<T>(key: string, fn: () => T): T {
	if (_cache[key] === undefined) {
		_cache[key] = fn();
	}
	return _cache[key];
}

function createArrowGeometry(thickness: number, headThickness: number, length: number) {
	let arrowHeadHeight = length * 0.15;
	const cylinder = new CylinderGeometry(thickness, thickness, length, 32);
	// translate so origin is at bottom
	cylinder.translate(0, 0.5, 0);
	let arrowHead = new ConeGeometry(headThickness, arrowHeadHeight, 32);
	arrowHead.translate(0, 1 + arrowHeadHeight * 0.5, 0);
	let merged = mergeGeometries([cylinder, arrowHead]);
	// currently pointing in +y direction
	// rotate to point in +x direction
	merged.rotateZ(-Math.PI / 2);
	return merged;
}