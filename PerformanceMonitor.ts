import { Animator } from "physics-animator";
import { Spring } from "physics-animator/animators";
import { EventEmitter } from "./EventEmitter.js";

export type PerformanceMonitorOptions = {
    smoothingHalfLife_s?: number;
    fpsLowLimit?: number;
    fpsHighLimit?: number;
    callbackWaitTime_s?: number;
    onLowFPS?: (repeatCount: number) => void;
    onHighFPS?: (repeatCount: number) => void;
    /** by default we use animationFrame to determine fps. Set this to `false` and call tick() manually for a different approach */
    manualTick?: boolean; // if true, you need to call tick() manually
};

const defaultPerformanceMonitorOptions = {
    smoothingHalfLife_s: 3,
    fpsLowLimit: 20,
    fpsHighLimit: 90,
    callbackWaitTime_s: 4,
    onLowFPS: () => {},
    onHighFPS: () => {},
    manualTick: false, // default to automatic ticking
};

export class PerformanceMonitor {

    animator = new Animator();
    smoothedFPS: number = 240; // start high to give warmup time

    // FPS considered too low
    fpsLowLimit: number;
    fpsHighLimit: number;

    // leave this many seconds before calling the callback again to give time for changes to take effect
    callbackWaitTime_s: number;

    events = {
        dispose: new EventEmitter<void>(),
    }

    protected smoothingParameters: Spring.PhysicsParameters;
    protected lastCallbackTime_ms: number = NaN;
    protected lowFPSRepeatCount: number = 0;
    protected highFPSRepeatCount: number = 0;
    protected manualTick: boolean;

    constructor(inputOptions: PerformanceMonitorOptions = defaultPerformanceMonitorOptions) {
        const options = { ...defaultPerformanceMonitorOptions, ...inputOptions };
        this.fpsLowLimit = options.fpsLowLimit;
        this.fpsHighLimit = options.fpsHighLimit;
        this.callbackWaitTime_s = options.callbackWaitTime_s;
        this.smoothingParameters = Spring.Exponential({ halfLife_s: options.smoothingHalfLife_s });

        // we don't want to call the callback immediately so we use this callbackWaitTime_s as warmup time
        this.lastCallbackTime_ms = performance.now();

        this.animator.onAfterStep(() => {
            let t_ms = performance.now();

            // NaN or number
            let timeSinceLastCallback_s = (t_ms - this.lastCallbackTime_ms) / 1000;

            let performCallbackCheck = isNaN(this.lastCallbackTime_ms) || timeSinceLastCallback_s > this.callbackWaitTime_s;
            if (performCallbackCheck) {
                if (this.smoothedFPS < this.fpsLowLimit) {
                    options.onLowFPS(this.lowFPSRepeatCount);
                    this.lowFPSRepeatCount++;
                    this.highFPSRepeatCount = 0;
                    this.lastCallbackTime_ms = t_ms;
                } else if (this.smoothedFPS > this.fpsHighLimit) {
                    options.onHighFPS(this.highFPSRepeatCount);
                    this.highFPSRepeatCount++;
                    this.lowFPSRepeatCount = 0;
                    this.lastCallbackTime_ms = t_ms;
                }
            }
        });

        // requestAnimationFrame will not fire when the window is not focused, so we reset the last tick time
        const onFocus = () => {
            this._lastTickTime_ms = NaN;
            this.lastCallbackTime_ms = performance.now();
        }
        window.addEventListener('focus', onFocus);

        this.manualTick = options.manualTick;

        if (!this.manualTick) {
            this.animator.startAnimationFrameLoop();
            this.animator.onBeforeStep(() => this.tick())
        }

        // clean up
        this.events.dispose.once(() => {
            this.animator.stop();
            this.animator.removeAll();
            window.removeEventListener('focus', onFocus);
        });
    }

    dispose() {
        this.events.dispose.dispatch();
    }

    private _lastTickTime_ms: number = NaN;
    tick(fps?: number) {
        if (fps !== undefined) {
            this.animator.springTo(this, { smoothedFPS: fps } as Partial<this>, this.smoothingParameters);
        } else {
            const t_ms = performance.now();
            if (!isNaN(this._lastTickTime_ms)) {
                const dt_ms = t_ms - this._lastTickTime_ms;
                const fps = 1000 / dt_ms;
                this.animator.springTo(this, { smoothedFPS: fps } as Partial<this>, this.smoothingParameters);
            }
            this._lastTickTime_ms = t_ms;
        }

        // if we're externally ticking, we need to call the animator's tick method
        if (this.manualTick) {
            this.animator.tick();
        }
    }

}