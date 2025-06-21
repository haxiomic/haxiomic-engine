import { Animator } from "physics-animator";
import { useInitializer } from "./useInitializer.js";

/**
 * Returns an instance of Animator running an interval loop
 * @param interval_ms interval between animation steps, pass explicit `null` to disable / stop. Defaults to 'animationFrame'
 * @returns { Animator } instance of Animator
 */
export function useAnimator(interval_ms: number | null | 'animationFrame' = 'animationFrame') {
	return useInitializer(() => {
		let animator = new Animator();
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