import { Animator } from "./animation/Animator";
import { Spring } from "./animation/Spring";

export type PerformanceMonitorOptions = {
    smoothingHalfLife_s?: number;
    fpsLowLimit?: number;
    fpsHighLimit?: number;
    callbackWaitTime_s?: number;
    onLowFPS?: (repeatCount: number) => void;
    onHighFPS?: (repeatCount: number) => void;
};

const defaultPerformanceMonitorOptions = {
    smoothingHalfLife_s: 3,
    fpsLowLimit: 20,
    fpsHighLimit: 90,
    callbackWaitTime_s: 4,
    onLowFPS: () => {},
    onHighFPS: () => {},
};

export class PerformanceMonitor {

    animator = new Animator();
    smoothedFPS: number = 240; // start high to give warmup time

    // FPS considered too low
    fpsLowLimit: number;
    fpsHighLimit: number;

    // leave this many seconds before calling the callback again to give time for changes to take effect
    callbackWaitTime_s: number;

    protected smoothingParameters: Spring.Parameters;
    protected lastCallbackTime_ms: number = NaN;
    protected lowFPSRepeatCount: number = 0;
    protected highFPSRepeatCount: number = 0;

    constructor(inputOptions: PerformanceMonitorOptions = defaultPerformanceMonitorOptions) {
        const options = { ...defaultPerformanceMonitorOptions, ...inputOptions };
        this.fpsLowLimit = options.fpsLowLimit;
        this.fpsHighLimit = options.fpsHighLimit;
        this.callbackWaitTime_s = options.callbackWaitTime_s;
        this.smoothingParameters = Spring.Exponential(options.smoothingHalfLife_s);

        // we don't want to call the callback immediately so we use this callbackWaitTime_s as warmup time
        this.lastCallbackTime_ms = performance.now();

        this.animator.onAfterStep.addListener(() => {
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
    }

    _lastTickTime_ms: number = NaN;
    tick(fps?: number) {
        if (fps !== undefined) {
            this.animator.springTo(this, 'smoothedFPS', fps, this.smoothingParameters);
        } else {
            const t_ms = performance.now();
            if (!isNaN(this._lastTickTime_ms)) {
                const dt_ms = t_ms - this._lastTickTime_ms;
                const fps = 1000 / dt_ms;
                this.animator.springTo(this, 'smoothedFPS', fps, this.smoothingParameters);
            }
            this._lastTickTime_ms = t_ms;
        }

        this.animator.tick();
    }

}