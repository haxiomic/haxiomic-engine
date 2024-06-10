import { EventEmitter } from "../EventEmitter"

/**
 * InteractionManager implements handles common edge cases when using pointer events for realtime content
 *
 * - Pointer capture is implemented for mouse events, so that `move` and `up` events will still fire if the pointer leaves element while the button is still pressed
 * - Gesture events are cancelled by default
 * - Chrome bug fix: PointerUp fires when secondary buttons are released outside of the window
 * - Events are non-passive
 */
export default class InteractionManager {
    readonly el: HTMLElement

    readonly events = {
        click: new EventEmitter<MouseEvent>(),

        pointerDown: new EventEmitter<PointerEvent>(),
        pointerMove: new EventEmitter<PointerEvent>(),
        pointerUp: new EventEmitter<PointerEvent>(),
        pointerCancel: new EventEmitter<PointerEvent>(),
        
        globalPointerUp: new EventEmitter<PointerEvent>(),


        wheel: new EventEmitter<WheelEvent>(),

        contextMenu: new EventEmitter<MouseEvent>(),

        keyDown: new EventEmitter<KeyboardEvent>(),
        keyUp: new EventEmitter<KeyboardEvent>(),
        
    }

    private attached = false
    public pointerEventsSupported: boolean
    public activePointers: { [pointerId: string]: PointerEvent } = {}
    public autoCapturePointer: boolean;

    // we track active buttons so we can trigger pointerup events when the button is released
    // surprisingly, this is not handled by some browsers (Chrome) for buttons other than the left mouse button
    // WebKit get's this right
    private activeButtons: { [pointerId: string]: number } = {}

    constructor(el: HTMLElement, options_: {
        disableDefaultBehavior?: boolean,
        autoCapturePointer?: boolean,
    } = {}) {
        let options = {
            disableDefaultBehavior: true,
            autoCapturePointer: true,
            ...options_,
        }
        this.el = el
        this.pointerEventsSupported = window.PointerEvent !== undefined
        this.attachEventListeners()
        this.autoCapturePointer = options.autoCapturePointer

        // disable default touch actions, this helps disable view dragging on touch devices
        if (options.disableDefaultBehavior) {
            this.el.style.touchAction = 'none'
            this.el.style.userSelect = 'none'
            this.el.style.webkitUserSelect = 'none'
            this.el.setAttribute('touch-action', 'none')
            this.el.addEventListener('touchstart', this.cancelEvent)
            // this.events.onTouchStart.addListener(this.cancelEvent, 0)
        }
    }

    public attachEventListeners() {
        if (this.attached) return

        // prevent native touch-scroll
        this.el.addEventListener('gesturestart', this.cancelEvent, false)
        this.el.addEventListener('gesturechange', this.cancelEvent, false)

        this.el.addEventListener('click', this.handleClick)

        this.el.addEventListener('pointerdown', this.handlePointerDown, {
            passive: false,
        })
        this.el.addEventListener('pointermove', this.handlePointerMove, {
            passive: false,
        })
        this.el.addEventListener('pointerup', this.handlePointerUp, {
            passive: false,
        })
        this.el.addEventListener(
            'pointercancel',
            this.handlePointerCancel,
            { passive: false }
        )

        this.el.addEventListener('wheel', this.handleWheel, { passive: false })

        this.el.addEventListener('contextmenu', this.handleContextMenu, { passive: false });

        window.addEventListener('pointerup', this.handleGlobalPointerUp, {capture: true})
        window.addEventListener('pointercancel', this.handleGlobalPointerUp, {capture: true})
        window.addEventListener('pointermove', this.handleGlobalPointerMove, {capture: true})

        window.addEventListener('keydown', this.handleKeyDown, { passive: false })
        window.addEventListener('keyup', this.handleKeyUp, { passive: false })

        this.attached = true
    }

    public removeEventListeners() {
        this.el.removeEventListener('gesturestart', this.cancelEvent, false)
        this.el.removeEventListener('gesturechange', this.cancelEvent, false)

        this.el.removeEventListener('click', this.handleClick)

        this.el.removeEventListener('pointerdown', this.handlePointerDown)
        this.el.removeEventListener('pointermove', this.handlePointerMove)
        this.el.removeEventListener('pointerup', this.handlePointerUp)
        this.el.removeEventListener(
            'pointercancel',
            this.handlePointerCancel
        )

        this.el.removeEventListener('wheel', this.handleWheel)

        window.removeEventListener('pointerup', this.handleGlobalPointerUp, {capture: true})
        window.removeEventListener('pointercancel', this.handleGlobalPointerUp, {capture: true})
        window.removeEventListener('pointermove', this.handleGlobalPointerMove, {capture: true})

        window.removeEventListener('keydown', this.handleKeyDown)
        window.removeEventListener('keyup', this.handleKeyUp)

        this.el.removeEventListener('touchstart', this.cancelEvent)
        this.attached = false
    }

    public clearDefaultBehavior() {
        this.el.style.touchAction = ''
        this.el.style.userSelect = ''
        this.el.style.webkitUserSelect = ''
        this.el.removeAttribute('touch-action')
        this.el.removeEventListener('touchstart', this.cancelEvent)
    }

    private cancelEvent = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
    }

    private handleClick = (e: MouseEvent) => {
        this.events.click.dispatchWithExistingEvent(e)
    }

    // Pointer events translate to mouse events with the advantage of pointer capture support
    private handlePointerDown = (e: PointerEvent) => {
        this.activePointers[e.pointerId] = e
        this.activeButtons[e.pointerId] = e.buttons

        this.events.pointerDown.dispatchWithExistingEvent(e)
    }
    private handlePointerMove = (e: PointerEvent) => {
        this.activePointers[e.pointerId] = e

        this.events.pointerMove.dispatchWithExistingEvent(e)
        if (this.autoCapturePointer && e.buttons > 0 && !this.el.hasPointerCapture(e.pointerId)) {
            this.el.setPointerCapture(e.pointerId)
        }
    }
    private commonPointerUp = (e: PointerEvent) => {
        if (e.buttons === 0) {
            delete this.activePointers[e.pointerId]
            delete this.activeButtons[e.pointerId]
        } else {
            this.activeButtons[e.pointerId] = e.buttons
        }
    }
    private handlePointerUp = (e: PointerEvent) => {
        this.commonPointerUp(e)
        this.events.pointerUp.dispatchWithExistingEvent(e)
    }
    private handlePointerCancel = (e: PointerEvent) => {
        this.commonPointerUp(e)
        this.events.pointerCancel.dispatchWithExistingEvent(e)
    }

    private handleGlobalPointerUp = (e: PointerEvent) => {
        this.commonPointerUp(e)
        this.events.globalPointerUp.dispatchWithExistingEvent(e)
    }

    private handleGlobalPointerMove = (e: PointerEvent) => {
        // check for any released buttons
        let previousButtons = this.activeButtons[e.pointerId];
        let currentButtons = e.buttons;
        // which bits are set in previousButtons but not in currentButtons?
        let releasedButtons = previousButtons & ~currentButtons;
        if (releasedButtons > 0) {
            // for each released button, dispatch a pointerup event
            for (let i = 0; i < 32; i++) {
                if (releasedButtons & (1 << i)) {
                    let event = new PointerEvent('pointerup', e);
                    if (this.el.hasPointerCapture(e.pointerId) || event.target === this.el) {
                        this.events.pointerUp.dispatchWithExistingEvent(event);
                    } else {
                        this.events.globalPointerUp.dispatchWithExistingEvent(event);
                    }
                }
            }
        }
        this.activeButtons[e.pointerId] = currentButtons;
    }

    private handleWheel = (e: WheelEvent) => {
        this.events.wheel.dispatchWithExistingEvent(e)
    }

    private handleContextMenu = (e: MouseEvent) => {
        this.events.contextMenu.dispatchWithExistingEvent(e)
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        this.events.keyDown.dispatchWithExistingEvent(e)
    }
    private handleKeyUp = (e: KeyboardEvent) => {
        this.events.keyUp.dispatchWithExistingEvent(e)
    }

}

