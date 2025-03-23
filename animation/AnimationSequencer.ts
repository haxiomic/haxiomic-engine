import { EventEmitter } from "../EventEmitter.js";

export type Sequence = {
    stop: () => void,
    events: {
        onStep: EventEmitter<number>,
        onComplete: EventEmitter<void>,
        onFinally: EventEmitter<{ complete: boolean, stepIndex: number }>,
    },
    promise: Promise<void>,
};

export class AnimationSequencer {

    timeoutHandles: Array<any> = [];
    intervalHandles: Array<any> = [];
    sequences: Array<Sequence> = [];
    
    constructor() {}

    /**
     * Execute a serial sequence of steps, firing a callback at each step. We either wait for the onCompleteEvent to be fired, or we wait for maxWait milliseconds before moving on to the next step.
     * 
     * @returns Sequence - a function that can be called to stop the sequence
     */
    runSequence = (steps: Array<{
        callback: () => (Promise<void> | void),
        maxWait_ms?: number,
        onCompleteEvent?: EventEmitter<any>
    }>): Sequence => {
        let sequenceEvents = {
            onStep: new EventEmitter<number>(),
            onComplete: new EventEmitter<void>(),
            onFinally: new EventEmitter<{ complete: boolean, stepIndex: number }>(),
            onError: new EventEmitter<any>(),
        }

        let openListeners = new Set<{ remove: () => void }>();
        let timeoutHandles = new Array<any>();

        let stepIndex = 0;

        const executeStep = (index: number) => {
            try {
                // check if we've reached the end of the sequence
                if (index >= steps.length) {
                    sequenceEvents.onComplete.dispatch();
                    sequenceEvents.onFinally.dispatch({
                        complete: true,
                        stepIndex: steps.length - 1,
                    });
                    return;
                }

                let step = steps[index];
                if (!step) {
                    throw new Error(`Step at index ${index} is undefined`);
                }

                sequenceEvents.onStep.dispatch(index);

                let timeoutHandle: any = null;
                let completeListener: { remove: () => void } | null = null;

                if (step.onCompleteEvent) {
                    let listener = step.onCompleteEvent.once(() => {
                        openListeners.delete(listener);
                    });
                }

                if (step.maxWait_ms) {
                    timeoutHandle = this.setTimeout(() => next(), step.maxWait_ms);
                    timeoutHandles.push(timeoutHandle);
                }

                if (!step.onCompleteEvent && !step.maxWait_ms) {
                    next();
                }

                let hasFinished = false;
                function next() {
                    if (hasFinished) return;

                    clearTimeout(timeoutHandle);
                    completeListener?.remove();

                    stepIndex++;
                    hasFinished = true;
                    executeStep(stepIndex);
                }

                let result = step.callback();
                if ((result as any)['then']) {
                    (result as Promise<any>).then(() => {
                        // if no onCompleteEvent, then we can move on to the next step
                        if (!step.onCompleteEvent) {
                            next();
                        }
                    }).catch((error) => {
                        sequenceEvents.onError.dispatch(error);
                        stop();
                    });
                }
            } catch (error) {
                sequenceEvents.onError.dispatch(error);
                stop();
            }
        }
        
        let stopped = false;
        function stop() {
            if (stopped) return;
            for (let listener of openListeners) {
                listener.remove();
            }
            for (let handle of timeoutHandles) {
                clearTimeout(handle);
            }
            sequenceEvents.onFinally.dispatch({
                complete: false,
                stepIndex,
            });
            stopped = true;
        }

        // promise interface
        let promise = new Promise<void>((resolve, reject) => {
            sequenceEvents.onComplete.once(() => resolve());
            sequenceEvents.onFinally.once(() => resolve());
            sequenceEvents.onError.once((error) => reject(error));
        });

        let sequence = {
            stop,
            events: sequenceEvents,
            promise,
        }

        // track sequence
        this.sequences.push(sequence);
        sequenceEvents.onFinally.once(() => {
            let index = this.sequences.indexOf(sequence);
            this.sequences.splice(index, 1);
        });

        // start
        executeStep(stepIndex);

        return sequence;
    }

    registerSequence = (sequence: Sequence) => {
        this.sequences.push(sequence);
        sequence.events.onFinally.once(() => {
            let index = this.sequences.indexOf(sequence);
            this.sequences.splice(index, 1);
        });
    }

    setTimeout = (callback: Function, delay: number) => {
        let handle = window.setTimeout(callback, delay);
        this.timeoutHandles.push(handle);
        return handle;
    }

    setInterval = (callback: Function, delay: number) => {
        let handle = window.setInterval(callback, delay);
        this.intervalHandles.push(handle);
        return handle;
    }

    stopAllTimeouts = () => {
        this.timeoutHandles.forEach(handle => clearTimeout(handle));
        this.timeoutHandles = [];
    }

    stopAllIntervals = () => {
        this.intervalHandles.forEach(handle => clearInterval(handle));
        this.intervalHandles = [];
    }

    stopAllSequences = () => {
        this.sequences.forEach(sequence => sequence.stop());
        this.sequences = [];
    }

    stopAll = () => {
        this.stopAllTimeouts();
        this.stopAllIntervals();
        this.stopAllSequences();
    }

}