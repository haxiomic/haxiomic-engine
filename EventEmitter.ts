export namespace EventEmitter {
    // we patch events to support `propagationStopped`
    export type Emitted<T> = T extends Event ?
        T & {
            propagationStopped?: boolean
            _stopPropagation?: () => void
        } :
        T;

    export type Listener = ReturnType<EventEmitter['addListener']>
}


/**
 * Event emitter with a notion of explicit ordering via priority
 */
export class EventEmitter<Payload = undefined, E = EventEmitter.Emitted<Payload>> {
    private listeners = new Array<{
        priority: number
        listener: (event: E) => void
    }>()

    public addListener(listener: (event: E) => void, priority: number = 0) {
        let eventObj = {
            priority,
            listener,
            remove: () => this.removeListener(listener),
        }
        if (listener !== null) {
            this.listeners.push(eventObj)
        }
        return eventObj
    }
    /** Alias for addListener */
    public on(listener: (event: E) => void, priority?: number) {
        return this.addListener(listener, priority);
    }

    public removeListener(listener: (event: E) => void) {
        // remove listener from array
        let i = 0
        for (; i < this.listeners.length; i++) {
            if (this.listeners[i].listener === listener) {
                break
            }
        }
        this.listeners.splice(i, 1)
    }

    public once(listener: (event: E) => void, priority: number = 0) {
        const tempListener = (event: E) => {
            listener(event)
            this.removeListener(tempListener)
        }
        return this.addListener(tempListener, priority)
    }

    /**
     * Dispatch an event by providing a payload
     * The underlying event object will be created and populated with the payload
     * 
     * @param maxPriority If provided, only listeners with a priority equal or lower than this will be called
     */
    public dispatch(payload: Payload, maxPriority?: number) {
        if (this.listeners.length === 0) return
        return this.dispatchWithExistingEvent(payload, maxPriority)
    }

    /**
     * Dispatch an event with an existing event object
     * 
     * This is useful if you want to forward an event from another source like a DOM event
     */
    public dispatchWithExistingEvent(payload: Payload, maxPriority: number = Infinity) {
        if (this.listeners.length === 0) return

        let event = this.patchPayload(payload);

        // sort listeners by priority before dispatch (priority can change at runtime)
        this.sortPriorityDescending()
        // enumerate listeners, highest priority first
        for (let i = 0; i < this.listeners.length; i++) {
            let item = this.listeners[i]
            if (item.priority > maxPriority) continue; // skip

            this.listeners[i].listener(event as any)

            // stop propagation if event was prevented
            if (typeof event === 'object' && (event as any).propagationStopped) {
                return
            }
        }
    }

    public hasListeners() {
        return this.listeners.length > 0
    }

    public removeAllListeners() {
        this.listeners = []
    }

    private sortPriorityDescending() {
        function sort(a: { priority: number }, b: { priority: number }) {
            return b.priority - a.priority;
        }
        this.listeners.sort(sort);
    }

    private patchPayload(payload: Payload): E {
        // patch event object to support `propagationStopped`
        if (payload instanceof Event && (payload as any).propagationStopped === undefined) {
            (payload as any).propagationStopped = false;
            (payload as any)._stopPropagation = payload.stopPropagation;
            payload.stopPropagation = stopPropagationOverride;
        } 
        return payload as any;
    }
}

function stopPropagationOverride(this: Event) {
    (this as any).propagationStopped = true;
    (this as any)._stopPropagation();
}
