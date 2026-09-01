import { EventSignal } from "@haxiomic/event-signal"

/**
 * Which keyboard events reach `events.keyDown` / `events.keyUp`.
 *
 * - `document` (default): the surface keeps the keyboard while the user works
 *   elsewhere in the page — clicking a toolbar button or empty space does not
 *   take it away. Another interaction surface claims it, and text entry
 *   suspends it.
 * - `element`: strict DOM focus. The element only receives keys while it, or
 *   something inside it, holds focus.
 * - `shared`: as `document`, except that pointing at anything which is not a
 *   surface releases the claim, so every surface responds again. For pages
 *   where the keyboard drives all viewports at once until one is singled out.
 *
 * `events.globalKeyDown` / `globalKeyUp` are unaffected and always see every key.
 */
export type KeyboardScope = 'document' | 'element' | 'shared'

const SURFACE_ATTR = 'data-interaction-surface'

/**
 * The surface that currently owns the keyboard. Pointer-down inside a surface
 * claims it; pointer-down anywhere that is not a surface (toolbars, chrome,
 * body) deliberately leaves ownership alone.
 */
let activeSurface: HTMLElement | null = null

/**
 * Whether a surface has been singled out — by pointing at it or by focusing
 * it — rather than the user being elsewhere on the page. `shared` scope uses
 * this to release the claim; `document` scope deliberately ignores it.
 */
let surfaceSingledOut = false

/** Resolve through open shadow roots — `document.activeElement` stops at the host. */
function deepActiveElement(): Element | null {
    let el: Element | null = document.activeElement
    while (el != null && el.shadowRoot != null && el.shadowRoot.activeElement != null) {
        el = el.shadowRoot.activeElement
    }
    return el
}

/**
 * Keys a focused control may use for itself: activation, focus navigation, and
 * caret or value movement. Measured against every native control — none of them
 * consume a plain letter or digit, and every key any of them did consume is in
 * this set. So anything outside it is an application shortcut and falls through
 * to the page, while these stay with whatever holds focus.
 */
const CONTROL_KEYS = new Set([
    ' ', 'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
])

/**
 * Is the user typing into this element? `:read-write` is the spec's own test
 * and matches text inputs, textareas and contenteditable — nothing else.
 */
function isTextEntry(el: Element): boolean {
    if (typeof el.matches !== 'function') return false
    try {
        return el.matches(':read-write')
    } catch {
        return false
    }
}

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
        click: new EventSignal<MouseEvent>(),

        pointerDown: new EventSignal<PointerEvent>(),
        pointerMove: new EventSignal<PointerEvent>(),
        pointerUp: new EventSignal<PointerEvent>(),
        pointerCancel: new EventSignal<PointerEvent>(),
        
        globalPointerUp: new EventSignal<PointerEvent>(),


        wheel: new EventSignal<WheelEvent>(),

        contextMenu: new EventSignal<MouseEvent>(),

        keyDown: new EventSignal<KeyboardEvent>(),
        keyUp: new EventSignal<KeyboardEvent>(),

        globalKeyDown: new EventSignal<KeyboardEvent>(),
        globalKeyUp: new EventSignal<KeyboardEvent>(),
        
    }

    private attached = false
    public pointerEventsSupported: boolean
    public activePointers: { [pointerId: string]: PointerEvent } = {}
    public autoCapturePointer: boolean;

    // we track active buttons so we can trigger pointerup events when the button is released
    // surprisingly, this is not handled by some browsers (Chrome) for buttons other than the left mouse button
    // WebKit get's this right
    private activeButtons: { [pointerId: string]: number } = {}

    readonly keyboardScope: KeyboardScope

    constructor(el: HTMLElement, options_: {
        disableDefaultBehavior?: boolean,
        autoCapturePointer?: boolean,
        keyboardScope?: KeyboardScope,
    } = {}) {
        let options = {
            disableDefaultBehavior: true,
            autoCapturePointer: true,
            keyboardScope: 'document' as KeyboardScope,
            ...options_,
        }
        this.el = el
        this.keyboardScope = options.keyboardScope
        // Keyboard events only reach an element that can hold focus, and a
        // surface that responds to keys has to be reachable by keyboard alone.
        // Set `tabindex` on the element yourself to override — `-1` keeps a
        // decorative viewport out of the tab order while still click-focusable.
        if (!this.el.hasAttribute('tabindex')) this.el.tabIndex = 0
        this.el.setAttribute(SURFACE_ATTR, '')
        // A lone surface owns the keyboard without needing a click first.
        if (activeSurface == null) activeSurface = this.el
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

        // Ownership tracking runs in capture so it settles before any app
        // handler can move focus.
        window.addEventListener('pointerdown', this.handleSurfaceClaim, { capture: true })
        window.addEventListener('focusin', this.handleSurfaceFocus)
        window.addEventListener('keydown', this.handleWindowKeyDown, { passive: false })
        window.addEventListener('keyup', this.handleWindowKeyUp, { passive: false })
        if (this.keyboardScope === 'element') {
            this.el.addEventListener('keydown', this.handleElementKeyDown, { passive: false })
            this.el.addEventListener('keyup', this.handleElementKeyUp, { passive: false })
        }

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

        window.removeEventListener('pointerdown', this.handleSurfaceClaim, { capture: true })
        window.removeEventListener('focusin', this.handleSurfaceFocus)
        window.removeEventListener('keydown', this.handleWindowKeyDown)
        window.removeEventListener('keyup', this.handleWindowKeyUp)
        this.el.removeEventListener('keydown', this.handleElementKeyDown)
        this.el.removeEventListener('keyup', this.handleElementKeyUp)
        this.el.removeAttribute(SURFACE_ATTR)
        if (activeSurface === this.el) activeSurface = null

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

    private handleSurfaceClaim = (e: PointerEvent) => {
        const target = e.target as Element | null
        const surface = target != null && typeof target.closest === 'function'
            ? target.closest(`[${SURFACE_ATTR}]`) as HTMLElement | null
            : null
        // Only a surface takes ownership. Clicks on chrome leave it where it is;
        // `shared` scope reads surfaceSingledOut to react to them instead.
        surfaceSingledOut = surface != null
        if (surface != null) activeSurface = surface
    }

    /**
     * Focus claims the surface too. Without this, tabbing to a viewport moves
     * DOM focus while the keyboard claim stays where it was last pointed, and
     * keys arrive at a different viewport than the focused one.
     */
    private handleSurfaceFocus = (e: FocusEvent) => {
        const target = e.target as Element | null
        const surface = target != null && typeof target.closest === 'function'
            ? target.closest(`[${SURFACE_ATTR}]`) as HTMLElement | null
            : null
        if (surface == null) return
        activeSurface = surface
        surfaceSingledOut = true
    }

    private handleWindowKeyDown = (e: KeyboardEvent) => {
        this.events.globalKeyDown.dispatchWithExistingEvent(e)
        if (this.keyboardScope === 'element') return
        if (!this.ownsKeyboard(e)) return
        this.events.keyDown.dispatchWithExistingEvent(e)
    }
    private handleWindowKeyUp = (e: KeyboardEvent) => {
        this.events.globalKeyUp.dispatchWithExistingEvent(e)
        if (this.keyboardScope === 'element') return
        // Ownership applies, the text-entry suspension does not: a key pressed
        // before focus moved into an input must still deliver its release, or
        // consumers tracking held keys are stuck with a key held forever.
        if (!this.hasClaim()) return
        this.events.keyUp.dispatchWithExistingEvent(e)
    }

    private handleElementKeyDown = (e: KeyboardEvent) => {
        if (!this.focusYieldsKey(e)) return
        this.events.keyDown.dispatchWithExistingEvent(e)
    }
    private handleElementKeyUp = (e: KeyboardEvent) => {
        this.events.keyUp.dispatchWithExistingEvent(e)
    }

    /**
     * Holds the claim when it was the surface last pointed at or focused — or,
     * under `shared`, when no surface has been singled out at all.
     */
    private hasClaim(): boolean {
        if (activeSurface === this.el) return true
        return this.keyboardScope === 'shared' && !surfaceSingledOut
    }

    /**
     * A key event targets whatever holds focus, so the focused element gets
     * first refusal: everything while the user is typing into it, and the keys
     * controls use otherwise. What is left over is an application shortcut.
     */
    private focusYieldsKey(e: KeyboardEvent): boolean {
        const focused = deepActiveElement()
        if (focused == null || focused === document.body || focused === this.el) return true
        if (isTextEntry(focused)) return false
        return !CONTROL_KEYS.has(e.key)
    }

    /** The surface receives a key when it holds the claim and focus yields it. */
    private ownsKeyboard(e: KeyboardEvent): boolean {
        return this.hasClaim() && this.focusYieldsKey(e)
    }

}

