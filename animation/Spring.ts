/**
 * Spring
 * 
 * @author George Corney (haxiomic)
 */

export namespace Spring {

    /**
     * Critically damped spring, similar to exponential falloff
     * Starting with 0 velocity, this parameter describes how long it would take to reach half-way to the target
     * 
     * `damping = 3.356694 / approxHalfLife_s`
     * 
     * `strength = damping * damping / 4`
     */
    export function Exponential(approxHalfLife_s: number): Parameters {
        let damping = 3.356694 / approxHalfLife_s;
        let strength = damping * damping / 4;
        return { damping, strength: strength };
    }

    export function Underdamped(halfLife_s: number, springStrength: number): Parameters {
        let damping = 2 * Math.log(2) / halfLife_s;
        // 4k - b^2 > 0
        let bSq = damping * damping;
        let strength = bSq + springStrength; 
        return { damping, strength };
    }


    export type Parameters = {
        strength: number,
        damping: number,
    }

    /**
     * Analytic spring integration
     * @param dt_s 
     * @param state 
     * @param parameters 
     */
    export function stepSpring(
        dt_s: number,
        state: {
            x: number,
            targetX: number,
            v: number,
        },
        parameters: Parameters
    ) {
        // analytic integration (unconditionally stable)
        // visualization: https://www.desmos.com/calculator/c2iug0kerh
        // references:
        // https://mathworld.wolfram.com/OverdampedSimpleHarmonicMotion.html
        // https://mathworld.wolfram.com/CriticallyDampedSimpleHarmonicMotion.html
        // https://mathworld.wolfram.com/UnderdampedSimpleHarmonicMotion.html

        let k = parameters.strength;
        let b = parameters.damping;
        let t = dt_s;
        let v0 = state.v;
        let dx0 = state.x - state.targetX;

        // nothing will change; exit early
        if (dx0 === 0 && v0 === 0) return;
        if (dt_s === 0) return;

        let critical = k * 4 - b * b;

        if (critical > 0) {
            // under damped
            let q = 0.5 * Math.sqrt(critical); // γ

            let A = dx0;
            let B = ((b * dx0) * 0.5 + v0) / q;

            let m = Math.exp(-b * 0.5 * t);
            let c = Math.cos(q * t);
            let s = Math.sin(q * t);

            let dx1 = m * (A*c + B*s);
            let v1 = m * (
                ( B*q - 0.5*A*b) * c +
                (-A*q - 0.5*b*B) * s
            );

            state.v = v1;
            state.x = dx1 + state.targetX;
        } else if (critical < 0) {
            // over damped
            let u = 0.5 * Math.sqrt(-critical);
            let p = -0.5 * b + u;
            let n = -0.5 * b - u;
            let B = -(n*dx0 - v0)/(2*u);
            let A = dx0 - B;

            let ep = Math.exp(p * t);
            let en = Math.exp(n * t);

            let dx1 = A * en + B * ep;
            let v1 = A * n * en + B * p * ep;

            state.v = v1;
            state.x = dx1 + state.targetX;
        } else {
            // critically damped
            let w = Math.sqrt(k); // ω

            let A = dx0;
            let B = v0 + w * dx0;
            let e = Math.exp(-w * t);

            let dx1 = (A + B * t) * e;
            let v1 = (B - w * (A + B * t)) * e;

            state.v = v1;
            state.x = dx1 + state.targetX;
        }

        return 0.5 * k * state.x * state.x;
    }

}