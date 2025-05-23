import { Animator } from "../animation/Animator.js";
import { ThreeAnimator } from "../animation/ThreeAnimator.ts";
import { useInitializer } from "./useInitializer.ts";

/**
 * Returns an instance of Animator running an interval loop
 * @param interval_ms interval between animation steps, pass explicit `null` to disable / stop. Defaults to 'animationFrame'
 * @returns { Animator } instance of Animator
 */
export function useThreeAnimator(interval_ms: number | null | 'animationFrame' = 'animationFrame') {
    return useInitializer(() => {
        let animator = new ThreeAnimator();
        if (interval_ms !== null) {
            if (interval_ms === 'animationFrame') {
                animator.startAnimationFrameLoop();
            } else {
                animator.startIntervalLoop(interval_ms);
            }
        }

        return animator;
    }, (animator) => {
        animator.stop();
        animator.removeAll();
    });
}