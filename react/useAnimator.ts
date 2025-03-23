import { useEffect, useRef } from "react";
import { Animator } from "../animation/Animator.js";

/**
 * Returns an instance of Animator running an interval loop
 * @param interval_ms interval between animation steps, pass explicit `null` to disable / stop. Defaults to 'animationFrame'
 * @returns { Animator } instance of Animator
 */
export function useAnimator(interval_ms: number | null | 'animationFrame' = 'animationFrame') {
	const animatorRef = useRef<Animator | null>(null);
	function getAnimator() {
		return animatorRef.current = animatorRef.current ?? new Animator();
	}

	// run animation loop while component exists
	useEffect(() => {
		if (interval_ms === null) {
			return;
		}
		if (interval_ms === 'animationFrame') {
			return getAnimator().startAnimationFrameLoop().stop;
		}
		return getAnimator().startIntervalLoop(interval_ms).stop;
	}, [interval_ms]);

	return getAnimator();
}