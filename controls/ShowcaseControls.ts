import { Spherical, Vector2, Vector3 } from "three";
import InteractionManager from "../interaction/InteractionManager.js";
import { Spring } from "physics-animator/animators";

type CameraType = {
    position: Vector3;
    lookAt: (v: Vector3) => void;
}

/**
 * Simple orbit controls for showcasing a centered object, with orbit bounds, smooth dragging and multi-touch pinch zoom.
 */
export class ShowcaseControls {

    protected _enabled: boolean = true;
    get enabled() {
        return this._enabled;
    }
    set enabled(value: boolean) {
        let changed = this._enabled !== value;
        if (!changed) return;

        this._enabled = value;

        if (value) {
            this.addListeners();
        } else {
            this.removeListeners();
        }
    }

    // object values may change but the object reference should not
    readonly settings: ShowcaseControlsSettings = {
        dragMultiplier: 2,
        dragDuration_s: 2,
        boundsDuration_s: 0.4,
        wheelMultiplier: 1.0,
        pinchMultiplier: 1.0,
        radiusBoundsEnabled: false,
        angleBoundsEnabled: false,
        thetaRange: [-Math.PI * 0.5 * 0.75, Math.PI * 0.5 * 0.75],
        phiRange: [0.25, Math.PI * 0.75],
        radiusRange: [0.75, 1.5],
        autoRotationSpeed: 0.0,
    };

    private physics: ShowcaseControlsPhysics;
    private input: ShowcaseControlsInput;

    constructor(
        { interactionManager, initialRadius, initialTheta, initialPhi, camera }: {
            interactionManager: InteractionManager,
            initialRadius: number,
            initialTheta?: number,
            initialPhi?: number,
            camera?: CameraType,
        },
        options?: Partial<ShowcaseControlsSettings>,
    ) {
        // apply settings overrides
        this.settings = {
            ...this.settings,
            ...options,
        }

        // Derive initial position from camera if provided, otherwise use explicit values
        const initSpherical = camera
            ? new Spherical().setFromVector3(camera.position)
            : new Spherical(
                initialRadius,
                initialPhi ?? Math.PI / 2,
                initialTheta ?? 0,
            );

        // Create physics with an interaction callback (wired after input is created)
        this.physics = new ShowcaseControlsPhysics(initSpherical, this.settings, () => this.input?.isCameraDragging() ?? false);
        this.input = new ShowcaseControlsInput(interactionManager, this.settings, this.physics.target, this.physics.animated);

        // expose methods
        this.addListeners = this.input.addListeners;
        this.removeListeners = this.input.removeListeners;
        this.isCameraDragging = this.input.isCameraDragging;
        this.isPinching = this.input.isPinching;
        this.setRadius = this.physics.setRadius;
        this.setTheta = this.physics.setTheta;
        this.setPhi = this.physics.setPhi;
        this.setPosition = this.physics.setPosition;

        // trigger initial listeners
        if (this.enabled) {
            this.addListeners();
        }
    }

    updateCamera(camera: CameraType, dt_s: number) {
        if (this.enabled) {
            this.physics.step(dt_s);
            camera.position.setFromSpherical(this.physics.animated.current);
            camera.lookAt(new Vector3());
        }
    }

    /** Current animated radius (distance from center). Setting applies instantly. */
    get radius() { return this.physics.animated.current.radius; }
    set radius(value: number) { this.physics.setRadius(value, "instant"); }

    /** Current animated theta (horizontal/longitudinal angle, -π to π). Setting applies instantly. */
    get theta() { return this.physics.animated.current.theta; }
    set theta(value: number) { this.physics.setTheta(value, "instant"); }

    /** Current animated phi (vertical/latitudinal angle, 0 to π). Setting applies instantly. */
    get phi() { return this.physics.animated.current.phi; }
    set phi(value: number) { this.physics.setPhi(value, "instant"); }

    // NOTE: keeping these as function-valued properties (assigned in ctor) preserves prior binding semantics.
    setRadius: (radius: number, animate: "animate" | "instant") => void;
    setTheta: (theta: number, animate: "animate" | "instant") => void;
    setPhi: (phi: number, animate: "animate" | "instant") => void;
    setPosition: (position: { radius?: number; theta?: number; phi?: number }, animate: "animate" | "instant") => void;
    isCameraDragging: () => boolean;
    isPinching: () => boolean;

    addListeners: () => void;
    removeListeners: () => void;

    dispose() {
        this.removeListeners();
    }
}


export type ShowcaseControlsSettings = {
    dragMultiplier: number;
    dragDuration_s: number;
    boundsDuration_s: number;
    wheelMultiplier: number;
    pinchMultiplier: number;
    radiusBoundsEnabled: boolean;
    angleBoundsEnabled: boolean;
    /** horizontal / longitudinal, -π to π */
    thetaRange: [number, number];
    /** vertical / latitudinal 0 to π */
    phiRange: [number, number];
    radiusRange: [number, number];
    autoRotationSpeed: number;
};

type SphericalState = {
    current: Spherical;
    velocity: Spherical;
};

/**
 * Pure camera physics: springs + boundary forces + integration.
 * No event handling, no pointer state.
 */
class ShowcaseControlsPhysics {
    readonly target: Spherical;
    readonly animated: SphericalState;

    constructor(
        initialPosition: Spherical,
        private readonly settings: ShowcaseControlsSettings,
        private readonly isInteracting: () => boolean,
    ) {
        // initial camera state
        this.target = initialPosition.clone();
        this.animated = {
            current: this.target.clone(),
            velocity: new Spherical(0, 0, 0),
        };
    }

    setRadius = (radius: number, animate: "animate" | "instant") => {
        this.target.radius = radius;

        if (animate === "instant") {
            this.animated.current.radius = radius;
            this.animated.velocity.radius = 0;
        }
    }

    setTheta = (theta: number, animate: "animate" | "instant") => {
        this.target.theta = theta;

        if (animate === "instant") {
            this.animated.current.theta = theta;
            this.animated.velocity.theta = 0;
        }
    }

    setPhi = (phi: number, animate: "animate" | "instant") => {
        this.target.phi = phi;

        if (animate === "instant") {
            this.animated.current.phi = phi;
            this.animated.velocity.phi = 0;
        }
    }

    setPosition = (position: { radius?: number; theta?: number; phi?: number }, animate: "animate" | "instant") => {
        if (position.radius !== undefined) this.setRadius(position.radius, animate);
        if (position.theta !== undefined) this.setTheta(position.theta, animate);
        if (position.phi !== undefined) this.setPhi(position.phi, animate);
    }

    step(dt_s: number) {
        // clamp dt_s
        dt_s = Math.min(Math.max(dt_s, 0), 0.1);

        let iterations = 5;
        dt_s /= iterations;

        for (let i = 0; i < iterations; i++) {
            // velocity verlet spring
            let acceleration = this.getTotalAcceleration(this.animated, this.target);

            let velocityHalfStep = new Spherical(
                this.animated.velocity.radius + acceleration.radius * dt_s * 0.5,
                this.animated.velocity.phi + acceleration.phi * dt_s * 0.5,
                this.animated.velocity.theta + acceleration.theta * dt_s * 0.5,
            );

            this.animated.current.set(
                this.animated.current.radius + velocityHalfStep.radius * dt_s,
                this.animated.current.phi + velocityHalfStep.phi * dt_s,
                this.animated.current.theta + velocityHalfStep.theta * dt_s,
            );

            let newAcceleration = this.getTotalAcceleration(this.animated, this.target);

            this.animated.velocity.radius = velocityHalfStep.radius + newAcceleration.radius * dt_s * 0.5;
            this.animated.velocity.phi = velocityHalfStep.phi + newAcceleration.phi * dt_s * 0.5;
            this.animated.velocity.theta = velocityHalfStep.theta + newAcceleration.theta * dt_s * 0.5;
        }
    }

    private getSpringAcceleration(
        x: { current: Spherical; velocity: Spherical },
        target: Spherical,
        spring: { strength: number; damping: number; exponent?: number },
    ) {
        // F = -k * x
        let xTheta = target.theta - x.current.theta;
        let xPhi = target.phi - x.current.phi;
        let xRadius = target.radius - x.current.radius;

        return {
            theta: spring.strength * Math.sign(xTheta) * Math.pow(Math.abs(xTheta), spring.exponent ?? 1),
            phi: spring.strength * Math.sign(xPhi) * Math.pow(Math.abs(xPhi), spring.exponent ?? 1),
            radius: spring.strength * Math.sign(xRadius) * Math.pow(Math.abs(xRadius), spring.exponent ?? 1),
        };
    }

    private getTotalAcceleration(x: { current: Spherical; velocity: Spherical }, target: Spherical) {
        let total = new Spherical(0, 0, 0);

        let cameraSpring = Spring.Exponential({
            duration_s: this.settings.dragDuration_s,
        });

        let boundarySpring = Spring.Exponential({
            duration_s: this.settings.boundsDuration_s * this.settings.dragDuration_s,
        });

        {
            let mainSpringForce = this.getSpringAcceleration(x, target, cameraSpring);

            if (this.isInteracting()) {
                total.theta += mainSpringForce.theta;
                total.phi += mainSpringForce.phi;
            }

            total.radius += mainSpringForce.radius;
        }

        const { angleBoundsEnabled, radiusBoundsEnabled, thetaRange, phiRange, radiusRange } = this.settings;

        // boundary forces
        if (angleBoundsEnabled) {
            if (x.current.theta < thetaRange[0]) {
                let boundaryForce = this.getSpringAcceleration(x, new Spherical(0, 0, thetaRange[0]), boundarySpring);
                total.theta += boundaryForce.theta - boundarySpring.damping * x.velocity.theta;
            }
            if (x.current.theta > thetaRange[1]) {
                let boundaryForce = this.getSpringAcceleration(x, new Spherical(0, 0, thetaRange[1]), boundarySpring);
                total.theta += boundaryForce.theta - boundarySpring.damping * x.velocity.theta;
            }
            if (x.current.phi < phiRange[0]) {
                let boundaryForce = this.getSpringAcceleration(x, new Spherical(0, phiRange[0], 0), boundarySpring);
                total.phi += boundaryForce.phi - boundarySpring.damping * x.velocity.phi;
            }
            if (x.current.phi > phiRange[1]) {
                let boundaryForce = this.getSpringAcceleration(x, new Spherical(0, phiRange[1], 0), boundarySpring);
                total.phi += boundaryForce.phi - boundarySpring.damping * x.velocity.phi;
            }
        }

        if (radiusBoundsEnabled) {
            if (x.current.radius < radiusRange[0]) {
                let boundaryForce = this.getSpringAcceleration(x, new Spherical(radiusRange[0], 0, 0), boundarySpring);
                total.radius += boundaryForce.radius - boundarySpring.damping * x.velocity.radius;
            }
            if (x.current.radius > radiusRange[1]) {
                let boundaryForce = this.getSpringAcceleration(x, new Spherical(radiusRange[1], 0, 0), boundarySpring);
                total.radius += boundaryForce.radius - boundarySpring.damping * x.velocity.radius;
            }
        }

        // auto-rotation
        if (!this.isInteracting() && this.settings.autoRotationSpeed !== 0.0) {
            total.theta += this.settings.autoRotationSpeed;
        }

        // damping
        if (this.isInteracting()) {
            total.theta += -cameraSpring.damping * x.velocity.theta;
            total.phi += -cameraSpring.damping * x.velocity.phi;
        } else {
            total.theta += -cameraSpring.damping * 0.25 * x.velocity.theta;
            total.phi += -cameraSpring.damping * 0.25 * x.velocity.phi;
        }

        total.radius += -cameraSpring.damping * x.velocity.radius;

        return total;
    }
}

/**
 * Input interpretation only: manages pointer state (drag/pinch) and writes to the physics target.
 * No spring math, no integration.
 */
class ShowcaseControlsInput {
    private draggingPointerId = NaN;

    private dragStartState = {
        canvasClip: new Vector2(),
        cameraSpherical: new Spherical(),
    };

    private pointers = new Map<number, { x: number; y: number }>();

    private pinchState = {
        active: false,
        initialDistance: 0,
        initialCenter: new Vector2(),
        initialRadius: 0,
        initialCameraSpherical: new Spherical(),
    };

    private eventListeners: Array<{ remove: () => void }> = [];

    constructor(
        private readonly interactionManager: InteractionManager,
        private readonly settings: ShowcaseControlsSettings,
        private readonly target: Spherical,
        private readonly animated: SphericalState,
    ) {
    }

    // listener wiring (same events, same order)
    removeListeners = () => {
        this.eventListeners.forEach((listener) => listener.remove());
        this.eventListeners = [];
    };

    addListeners = () => {
        // make sure we don't add listeners multiple times
        this.removeListeners();

        this.eventListeners.push(
            this.interactionManager.events.wheel.on(this.onWheel),
            this.interactionManager.events.pointerDown.on(this.onPointerDown),
            this.interactionManager.events.pointerMove.on(this.onPointerMove),
            this.interactionManager.events.globalPointerUp.on(this.onPointerUp),
            this.interactionManager.events.pointerCancel.on(this.onPointerUp),
        );
    };

    isPinching = () => this.pinchState.active;

    isCameraDragging = () => !isNaN(this.draggingPointerId) || this.isPinching();

    onPointerDown = (e: PointerEvent) => {
        e.preventDefault();

        this.addPointer(e.pointerId, e.clientX, e.clientY);

        if (e.isPrimary) {
            if (e.pointerType === "mouse") {
                this.startCameraDrag(e);
            }
        } else {
            // Handle secondary pointer for pinch
            if (this.pointers.size === 2 && !this.isPinching()) {
                this.startPinchZoom();
            }
        }
    };

    onPointerMove = (e: PointerEvent) => {
        this.updatePointer(e.pointerId, e.clientX, e.clientY);

        if (this.isPinching()) {
            this.updatePinchZoom();
        } else if (this.isCameraDragging() && e.pointerId === this.draggingPointerId) {
            this.updateCameraDrag(e);
        }
    };

    onPointerUp = (e: PointerEvent) => {
        if (this.pointers.has(e.pointerId)) {
            this.removePointer(e.pointerId);

            if (this.pointers.size < 2) {
                this.endPinchZoom();
            }

            // If this was the dragging pointer, clear it
            if (e.pointerId === this.draggingPointerId) {
                this.endCameraDrag();

                // If we still have one pointer, restart drag with that pointer
                if (this.pointers.size === 1) {
                    const remainingPointer = Array.from(this.pointers.keys())[0];
                    const pointerPos = this.pointers.get(remainingPointer);
                    if (pointerPos) {
                        this.startCameraDrag({
                            clientX: pointerPos.x,
                            clientY: pointerPos.y,
                            pointerId: remainingPointer,
                        } as PointerEvent);
                    }
                }
            }
        }
    };

    onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const { radiusRange, radiusBoundsEnabled } = this.settings;

        this.target.radius += e.deltaY * 0.001 * this.settings.wheelMultiplier;

        const targetRadius = radiusBoundsEnabled
            ? Math.max(radiusRange[0], Math.min(radiusRange[1], this.target.radius))
            : this.target.radius;

        this.target.radius = targetRadius;
    };

    private getCanvasClip = (e: PointerEvent | { x: number; y: number }) => {
        let clientX = "clientX" in e ? e.clientX : e.x;
        let clientY = "clientY" in e ? e.clientY : e.y;

        let el = this.interactionManager.el;

        let canvasWidth = el.clientWidth;
        let canvasHeight = el.clientHeight;

        let clip = new Vector2((clientX / canvasWidth) * 2.0 - 1.0, (clientY / canvasHeight) * 2.0 - 1.0);

        // we're going to make clip square and to max [-1, 1] range
        let aspect = canvasWidth / canvasHeight;

        if (aspect > 1.0) {
            // width > height
            clip.y /= aspect;
        } else {
            // height > width
            clip.x *= aspect;
        }

        return clip;
    };

    private startCameraDrag(e: PointerEvent) {
        // drag start
        this.target.copy(this.animated.current);

        this.dragStartState = {
            canvasClip: this.getCanvasClip(e),
            cameraSpherical: this.animated.current.clone(),
        };

        this.draggingPointerId = e.pointerId;
    }

    private updateCameraDrag(e: PointerEvent) {
        if (this.isCameraDragging()) {
            let clipDelta = new Vector2().subVectors(this.getCanvasClip(e), this.dragStartState.canvasClip);
            this.target.theta = this.dragStartState.cameraSpherical.theta - clipDelta.x * this.settings.dragMultiplier;
            this.target.phi = this.dragStartState.cameraSpherical.phi - clipDelta.y * 0.5 * this.settings.dragMultiplier;
        }
    }

    private endCameraDrag() {
        this.draggingPointerId = NaN;
    }

    private startPinchZoom() {
        this.pinchState.active = true;
        this.pinchState.initialDistance = this.calculatePinchDistance();
        this.pinchState.initialCenter = this.calculatePinchCenter();
        this.pinchState.initialRadius = this.animated.current.radius;
        this.pinchState.initialCameraSpherical = this.animated.current.clone();
        this.endCameraDrag(); // Stop any drag operation
    }

    private updatePinchZoom() {
        if (!this.isPinching()) return;

        const currentDistance = this.calculatePinchDistance();
        const currentCenter = this.calculatePinchCenter();
        const { radiusRange, radiusBoundsEnabled } = this.settings;

        if (this.pinchState.initialDistance > 0) {
            const scale = currentDistance / this.pinchState.initialDistance;
            let newRadius = (this.pinchState.initialRadius / scale) * this.settings.pinchMultiplier;

            if (radiusBoundsEnabled) {
                newRadius = Math.max(radiusRange[0], Math.min(radiusRange[1], newRadius));
            }

            this.target.radius = newRadius;
        }

        // pan the camera target based on the movement of the pinch center, the same way as dragging
        let clipDelta = new Vector2().subVectors(
            this.getCanvasClip(currentCenter),
            this.getCanvasClip(this.pinchState.initialCenter),
        );

        let el = this.interactionManager.el;
    
        // adjust for aspect ratio (NOTE: kept as-is, even though getCanvasClip already normalizes)
        let aspect = el.clientWidth / el.clientHeight;
        if (aspect > 1.0) {
            // width > height
            clipDelta.y /= aspect;
        } else {
            // height > width
            clipDelta.x *= aspect;
        }

        this.target.theta = this.pinchState.initialCameraSpherical.theta - clipDelta.x * this.settings.dragMultiplier;
        this.target.phi = this.pinchState.initialCameraSpherical.phi - clipDelta.y * 0.5 * this.settings.dragMultiplier;
    }

    private endPinchZoom() {
        this.pinchState.active = false;
    }

    private addPointer(pointerId: number, x: number, y: number) {
        this.pointers.set(pointerId, { x, y });
    }

    private removePointer(pointerId: number) {
        this.pointers.delete(pointerId);
    }

    private updatePointer(pointerId: number, x: number, y: number) {
        if (this.pointers.has(pointerId)) {
            this.pointers.set(pointerId, { x, y });
        }
    }

    private calculatePinchCenter() {
        let center = new Vector2(0, 0);

        this.pointers.forEach((pos) => {
            center.x += pos.x;
            center.y += pos.y;
        });

        center.x /= this.pointers.size;
        center.y /= this.pointers.size;

        return center;
    }

    private calculatePinchDistance() {
        let center = this.calculatePinchCenter();
        let totalDistance = 0;

        this.pointers.forEach((pos) => {
            let dx = pos.x - center.x;
            let dy = pos.y - center.y;
            totalDistance += Math.sqrt(dx * dx + dy * dy);
        });

        return totalDistance / this.pointers.size;
    }
}