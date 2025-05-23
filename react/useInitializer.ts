import { useEffect, useRef } from 'react';

/**
 * useMemo & useState are not suitable for once-only initialization
 * reinitialized on dependency change
 * https://github.com/facebook/react/issues/27735#issuecomment-1885624506
 */
export function useInitializer<T>(
    initialize: () => T,
    dispose?: (v: T) => void,
    deps: unknown[] = []
): T {
    const depsRef = useRef<unknown[]>([]);
    const dependenciesChanged = !areDependenciesEqual(depsRef.current, deps);
    depsRef.current = deps;

    const ref = useRef<T | null>(null);
    if (ref.current === null || dependenciesChanged) {
        // dispose any previous instance
        if (ref.current !== null) {
            dispose?.(ref.current);
        }
        ref.current = initialize();
    }

    // dispose on unmount
    useEffect(() => {
        return () => {
            if (ref.current !== null) {
                dispose?.(ref.current);
                ref.current = null;
            }
        };
    }, []);

    return ref.current;
}

/**
 * Compares two dependency arrays using Object.is, just like React does internally
 */
function areDependenciesEqual(prevDeps: unknown[], nextDeps: unknown[]): boolean {
    // First, check if both are arrays and have the same length
    if (
        !Array.isArray(prevDeps) ||
        !Array.isArray(nextDeps) ||
        prevDeps.length !== nextDeps.length
    ) {
        return false;
    }

    // Check each dependency using Object.is
    for (let i = 0; i < prevDeps.length; i++) {
        if (!Object.is(prevDeps[i], nextDeps[i])) {
            return false; // Found a difference
        }
    }

    return true; // All dependencies are the same
}
