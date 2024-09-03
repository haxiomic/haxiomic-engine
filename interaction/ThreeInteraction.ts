import { Camera, Intersection, Object3D, Ray, Raycaster, Scene, Vector2 } from "three"
import { EventEmitter } from "../EventEmitter";
import InteractionManager from "./InteractionManager";
import { Layer } from "../Layer";

export type PointerEventExtended = EventEmitter.Emitted<PointerEvent>;

export default class ThreeInteraction {

    readonly interactionManager: InteractionManager
    scene: Scene
    camera: Camera
    raycaster = new Raycaster()

    readonly capturedPointers: { [id: number]: Array<InteractiveObject> | undefined } = {}
    readonly hoveredObjects: { [id: number]: Array<InteractiveObject> | undefined } = {}

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

    protected onPointerDown = (e: PointerEventExtended) => {
        for (let intersect of this.intersectSceneWithPointer(e)) {
            let object = intersect.object as InteractiveObject;

            let callbackAllowedCapture: boolean | undefined = undefined
            if (object.userData.onPointerDown != null) {
                let ret = object.userData.onPointerDown(e, this.raycaster, intersect);
                if (ret != null) {
                    callbackAllowedCapture = ret;
                }
            }

            let capturePointer = (object.userData.capturePointer ?? true) && callbackAllowedCapture !== false
            if (capturePointer) {
                this.interactionManager.el.setPointerCapture(e.pointerId)

                let capturedPointers = this.capturedPointers[e.pointerId] ?? []
                capturedPointers.push(object)
                this.capturedPointers[e.pointerId] = capturedPointers
            }

            if (e.propagationStopped) {
                return;
            }
        }
    }
    protected onPointerMove = (e: PointerEventExtended) => {
        let cursor: string | undefined | null = null;

        let capturedObjects = this.capturedPointers[e.pointerId];
        if (capturedObjects != null) {
            // reverse iterate so that top-most object gets first chance to set cursor
            for (let i = capturedObjects.length - 1; i >= 0; i--) {
                let capturedObject = capturedObjects[i];
                if (capturedObject.userData.onPointerMove != null) {
                    capturedObject.userData.onPointerMove(e, true, this.raycaster, undefined)
                }

                cursor = capturedObject.userData.cursor
            }
        }

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
                if (object.userData.onPointerOut != null) {
                    let captured: boolean = capturedObjects?.indexOf(object) !== -1;
                    object.userData.onPointerOut(e, captured, this.raycaster)
                }
                hoveredObjects.splice(hoveredObjects.indexOf(object), 1)
            }
        }

        for (let intersect of intersections) {
            let object = intersect.object as InteractiveObject;

            let captured: boolean = capturedObjects?.indexOf(object) !== -1;

            // if captured, then we've already dispatched move for object and we can skip
            if (!captured && object.userData.onPointerMove != null) {
                object.userData.onPointerMove(e, false, this.raycaster, intersect)
            }

            // top-most object sets the cursor
            if (cursor == null && object.userData.cursor != null) {
                cursor = object.userData.cursor
            }

            if (hoveredObjects.indexOf(object) === -1) {
                hoveredObjects.push(object)
                if (object.userData.onPointerOver != null) {
                    object.userData.onPointerOver(e, captured, this.raycaster, intersect)
                }
            }

            if (e.propagationStopped) {
                return;
            }
        }

        this.setCursor(cursor ?? '')
    }
    protected onPointerUp = (e: PointerEventExtended) => {
        let capturedObjects = this.capturedPointers[e.pointerId]
        delete this.capturedPointers[e.pointerId]
        delete this.hoveredObjects[e.pointerId]
        this.interactionManager.el.releasePointerCapture(e.pointerId)

        if (capturedObjects != null) {
            for (let i = capturedObjects.length - 1; i >= 0; i--) {
                let capturedObject = capturedObjects[i];
                if (capturedObject.userData.onPointerUp != null) {
                    capturedObject.userData.onPointerUp(e, true, this.raycaster)
                }
            }
        }

        for (let intersect of this.intersectSceneWithPointer(e)) {
            let object = intersect.object as InteractiveObject;

            // already dispatched for object
            if (capturedObjects?.indexOf(object) !== -1) continue;

            if (object.userData.onPointerUp != null) {
                object.userData.onPointerUp(e, false, this.raycaster, intersect)
            }

            if (e.propagationStopped) {
                return;
            }
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
            if (intersection.object.userData.interactiveWhenInvisible !== true) {
                if (!this.isVisible(intersection.object)) continue;
            }

            includedObjects.push(intersection)
        }
        // allow objects to override sorting
        includedObjects.sort((a, b) => {
            let aSortPriority = a.object.userData.sortPriority ?? 0;
            let bSortPriority = b.object.userData.sortPriority ?? 0;
            if (aSortPriority !== bSortPriority) {
                return bSortPriority - aSortPriority;
            } else {
                return a.distance - b.distance;
            }
        });

        // now we've sorted, remove objects occluded by the first `occludePointerEvents` object
        for (let i = 0; i < includedObjects.length; i++) {
            let object = includedObjects[i].object;
            if (object.userData.occludePointerEvents === true) {
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

}

export type InteractionSettings = {
    cursor?: string,

    /** If pointer events should continue when outside the object if started within. Default `true` */
    capturePointer?: boolean,

    /** If true, prevents objects behind from receiving events. Default: `false` */
    occludePointerEvents?: boolean,

    /** Receive interactions when invisible. Default `false` */
    interactiveWhenInvisible?: boolean,

    /** Normally events are emitted in distance order, with nearest objects taking priority,
     * this field allows an object to override it's position in the event order. Default `0`.
     * This takes precedent over `occludePointerEvents` */
    sortPriority?: number,

    /**
     * return false to prevent capture
     */
    onPointerDown?: (event: PointerEventExtended, raycaster: Raycaster, intersection: Intersection) => void | boolean
    onPointerMove?: (event: PointerEventExtended, captured: boolean, raycaster: Raycaster, intersection?: Intersection) => void
    onPointerUp?: (event: PointerEventExtended, captured: boolean, raycaster: Raycaster, intersection?: Intersection) => void

    onPointerOver?: (event: PointerEventExtended, captured: boolean, raycaster: Raycaster, intersection: Intersection) => void
    onPointerOut?: (event: PointerEventExtended, captured: boolean, raycaster: Raycaster) => void
}

export type InteractiveObject = {
    userData: InteractionSettings
}

export function makeInteractive<T extends Object3D>(object: T, settings: InteractionSettings): T & InteractiveObject {
    object.layers.enable(Layer.Interactive);
    object.userData = settings
    return object
}