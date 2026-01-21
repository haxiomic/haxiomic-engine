import { Camera, Intersection, Object3D, Object3DEventMap, Ray, Raycaster, Scene, Vector2 } from "three"
import { EventSignal } from "@haxiomic/event-signal";
import InteractionManager from "./InteractionManager.js";
import { Layer } from "../rendering/Layer.js";

export type PointerEventExtended = EventSignal.Emitted<PointerEvent>;

export class ThreeInteraction {

    readonly interactionManager: InteractionManager
    scene: Scene
    camera: Camera
    raycaster = new Raycaster()

    readonly capturedPointers: { [id: number]: Array<InteractiveObject3D> | undefined } = {}
    readonly hoveredObjects: { [id: number]: Array<InteractiveObject3D> | undefined } = {}

    private listeners: Array<{remove: () => void}>

    constructor(interactionManager: InteractionManager, scene: Scene, camera: Camera, priority = 1) {
        this.interactionManager = interactionManager
        this.scene = scene
        this.camera = camera
        this.raycaster.layers.set(Layer.Interactive)

        this.listeners = [
            interactionManager.events.pointerDown.addListener(this.onPointerDown, priority),
            interactionManager.events.pointerMove.addListener(this.onPointerMove, priority),
            interactionManager.events.pointerUp.addListener(this.onPointerUp, priority),
            interactionManager.events.pointerCancel.addListener(this.onPointerUp, priority),
        ]
    }

    dispose() {
        for (let listener of this.listeners) {
            listener.remove()
        }
    }

    protected onPointerDown = (event: PointerEventExtended) => {
        for (let intersection of this.intersectSceneWithPointer(event) as Array<Intersection<InteractiveObject3D>>) {
            let object = intersection.object;

            let capturedPointer: boolean = (object.interaction.defaultCapturePointer ?? true)
            const preventCaptureCallback = () => {
                capturedPointer = false
            }
            const capturePointerCallback = () => {
                capturedPointer = true
            }

            object.interaction.events.pointerDown.dispatch({
                event,
                target: object,
                raycaster: this.raycaster,
                intersection,
                preventCapture: preventCaptureCallback,
                capturePointer: capturePointerCallback,
            });

            if (capturedPointer) {
                this.interactionManager.el.setPointerCapture(event.pointerId)

                let capturedPointers = this.capturedPointers[event.pointerId] ?? []
                capturedPointers.push(object)
                this.capturedPointers[event.pointerId] = capturedPointers
            }

            if (event.propagationStopped) {
                return;
            }
        }
    }
    protected onPointerMove = (e: PointerEventExtended) => {
        let cursor: string | undefined | null = null;

        let capturedObjects = this.capturedPointers[e.pointerId] ?? [];

        let intersections = this.intersectSceneWithPointer(e);

        let hoveredObjects = this.hoveredObjects[e.pointerId] ?? []
        this.hoveredObjects[e.pointerId] = hoveredObjects

        // for all hoveredObjects objects that are not in the intersection list, dispatch onPointerOut and remove entry
        for (let object of hoveredObjects) {
            let included = false
            for (let intersect of intersections) {
                if (intersect.object === object) {
                    included = true
                    break
                }
            }
            if (!included) {
                object.interaction.events.pointerOut.dispatch({
                    event: e,
                    target: object,
                    captured: capturedObjects.indexOf(object) !== -1,
                    raycaster: this.raycaster,
                });
                hoveredObjects.splice(hoveredObjects.indexOf(object), 1)
            }
        }

        // copy capturedObjects
        let capturedObjectsStillNeedingDispatch = [...capturedObjects];

        for (let intersection of intersections as Array<Intersection<InteractiveObject3D>>) {
            let object = intersection.object;

            let captured: boolean = capturedObjects.indexOf(object) !== -1;

            // if captured, then we've already dispatched move for object and we can skip
            object.interaction.events.pointerMove.dispatch({
                event: e,
                target: object,
                captured,
                raycaster: this.raycaster,
                intersection,
            });

            // remove from capturedObjectsStillNeedingDispatch if it was dispatched
            if (captured) {
                let index = capturedObjectsStillNeedingDispatch.indexOf(object);
                if (index !== -1) {
                    capturedObjectsStillNeedingDispatch.splice(index, 1);
                }
            }

            // top-most object sets the cursor
            if (cursor == null && object.interaction.cursor != null) {
                cursor = object.interaction.cursor
            }

            // dispatch pointerOver for object if not already hovered
            if (hoveredObjects.indexOf(object) === -1) {
                hoveredObjects.push(object)
                object.interaction.events.pointerOver.dispatch({
                    event: e,
                    target: object,
                    captured,
                    raycaster: this.raycaster,
                    intersection: intersection,
                });
            }

            if (e.propagationStopped) {
                break;
            }
        }

        // for all captured objects that have not already dispatched pointerMove, dispatch pointerMove
        // reverse iterate so that top-most object gets first chance to set cursor
        for (let i = capturedObjectsStillNeedingDispatch.length - 1; i >= 0; i--) {
            let capturedObject = capturedObjectsStillNeedingDispatch[i];
            capturedObject.interaction.events.pointerMove.dispatch({
                event: e,
                target: capturedObject,
                captured: true,
                raycaster: this.raycaster,
                intersection: undefined, // no intersection for captured objects
            });

            if (cursor == null) {
                cursor = capturedObject.interaction.cursor
            }
        }

        this.setCursor(cursor ?? '')
    }
    protected onPointerUp = (e: PointerEventExtended) => {
        let capturedObjects = this.capturedPointers[e.pointerId] ?? [];
        delete this.capturedPointers[e.pointerId]
        delete this.hoveredObjects[e.pointerId]
        this.interactionManager.el.releasePointerCapture(e.pointerId)

        const capturedObjectsStillNeedingDispatch = [...capturedObjects];

        for (let intersect of this.intersectSceneWithPointer(e) as Array<Intersection<InteractiveObject3D>>) {
            let object = intersect.object;

            // already dispatched for object
            let captured = capturedObjects.indexOf(object) !== -1;

            object.interaction.events.pointerUp.dispatch({
                event: e,
                target: object,
                captured,
                raycaster: this.raycaster,
                intersection: intersect,
            });

            // remove from capturedObjectsStillNeedingDispatch if it was dispatched
            if (captured) {
                let index = capturedObjectsStillNeedingDispatch.indexOf(object);
                if (index !== -1) {
                    capturedObjectsStillNeedingDispatch.splice(index, 1);
                }
            }

            if (e.propagationStopped) {
                break;
            }
        }

        for (let i = capturedObjectsStillNeedingDispatch.length - 1; i >= 0; i--) {
            let capturedObject = capturedObjectsStillNeedingDispatch[i];
            capturedObject.interaction.events.pointerUp.dispatch({
                event: e,
                target: capturedObject,
                captured: true,
                raycaster: this.raycaster,
                intersection: undefined, // no intersection for captured objects
            });
        }
    }

    prepareRaycastWithPointer(e: {clientX: number, clientY: number}) {
        let cs = this.clientToClipSpace(e);
        this.raycaster.setFromCamera(new Vector2(cs.x, cs.y), this.camera)
        return this.raycaster;
    }

    intersectSceneClipSpace(pointerClipSpace: { x: number; y: number }) {
        this.raycaster.setFromCamera(new Vector2(pointerClipSpace.x, pointerClipSpace.y), this.camera)
        let intersections = this.raycaster.intersectObjects(this.scene.children, true)
        let includedObjects: Array<Intersection<Object3D>> = []
        for (let intersection of intersections) {
            // skip object if not visible
            if ((intersection.object as InteractiveObject3D).interaction?.interactiveWhenInvisible !== true) {
                if (!this.isVisible(intersection.object)) continue;
            }

            includedObjects.push(intersection)
        }
        // allow objects to override sorting
        includedObjects.sort((a, b) => {
            let aSortPriority = (a.object as InteractiveObject3D).interaction?.sortPriority ?? 0;
            let bSortPriority = (b.object as InteractiveObject3D).interaction?.sortPriority ?? 0;
            if (aSortPriority !== bSortPriority) {
                return bSortPriority - aSortPriority;
            } else {
                return a.distance - b.distance;
            }
        });

        // now we've sorted, remove objects occluded by the first `occludePointerEvents` object
        for (let i = 0; i < includedObjects.length; i++) {
            let object = includedObjects[i].object as InteractiveObject3D;
            if (object.interaction?.occludePointerEvents === true) {
                // remove all objects after this one
                includedObjects.splice(i + 1)
                break;
            }
        }
        
        return includedObjects;
    }

    intersectSceneWithPointer(e: {clientX: number, clientY: number}) {
        return this.intersectSceneClipSpace(this.clientToClipSpace(e))
    }

    clientToClipSpace(e: {clientX: number, clientY: number}) {
        let rect = this.interactionManager.el.getBoundingClientRect()
        return {
            x: (e.clientX - rect.left) / rect.width * 2 - 1,
            y: -(e.clientY - rect.top) / rect.height * 2 + 1,
        }
    }
    
    private setCursor(cursor: string) {
        this.interactionManager.el.style.cursor = cursor
    }

    private isVisible(target: Object3D) {
        let visible = true
        let object: Object3D | null = target;
        while (object != null) {
            if (object.visible === false) {
                visible = false
                break
            }
            object = object.parent
        }
        return visible
    }

    makeInteractive<T extends Object3D>(object: T, settings: Omit<InteractionFields, 'events'>): InteractiveObject3D<T> {
        return makeInteractive(object, settings);
    }

}

export type InteractionFields = {
    cursor?: string,

    /** If pointer events should continue when outside the object if started within. Default `true` */
    defaultCapturePointer?: boolean,

    /** If true, prevents objects behind from receiving events. Default: `false` */
    occludePointerEvents?: boolean,

    /** Receive interactions when invisible. Default `false` */
    interactiveWhenInvisible?: boolean,

    /** Normally events are emitted in distance order, with nearest objects taking priority,
     * this field allows an object to override it's position in the event order. Default `0`.
     * This takes precedent over `occludePointerEvents` */
    sortPriority?: number,

    events: {
        pointerDown: EventSignal<{
            event: PointerEventExtended,
            target: InteractiveObject3D,
            raycaster: Raycaster,
            intersection: Intersection<InteractiveObject3D>
            /** If called, capture will be prevented */
            preventCapture(): void
            /** If called, pointer will be captured */
            capturePointer(): void
        }>,
        pointerMove: EventSignal<{
            event: PointerEventExtended,
            target: InteractiveObject3D,
            captured: boolean,
            raycaster: Raycaster,
            intersection?: Intersection<InteractiveObject3D>
        }>,
        pointerUp: EventSignal<{
            event: PointerEventExtended,
            target: InteractiveObject3D,
            captured: boolean,
            raycaster: Raycaster,
            intersection?: Intersection<InteractiveObject3D>
        }>,
        pointerOver: EventSignal<{
            event: PointerEventExtended,
            target: InteractiveObject3D,
            captured: boolean,
            raycaster: Raycaster,
            intersection: Intersection<InteractiveObject3D>
        }>,
        pointerOut: EventSignal<{
            event: PointerEventExtended,
            target: InteractiveObject3D,
            captured: boolean,
            raycaster: Raycaster
        }>,
    }
    
}

export type InteractiveObject3D<T extends Object3D = Object3D> = T & {
    interaction: InteractionFields
}

export function makeInteractive<T extends Object3D>(object: T, settings: Omit<InteractionFields, 'events'>): InteractiveObject3D<T> {
    let interactiveObject = object as InteractiveObject3D<T>;
    interactiveObject.layers.enable(Layer.Interactive);
    interactiveObject.interaction = {
        ...settings,
        events: {
            pointerDown: new EventSignal(),
            pointerMove: new EventSignal(),
            pointerUp: new EventSignal(),
            pointerOver: new EventSignal(),
            pointerOut: new EventSignal(),
        }
    }
    return interactiveObject;
}