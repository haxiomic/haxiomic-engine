import { DependencyList, useEffect } from "react";

export function useKeyboardEvent(callback: (e: KeyboardEvent) => void, dependencies: DependencyList = []) {
	useEffect(() => {
		window.addEventListener('keydown', callback);
		return () => {
			window.removeEventListener('keydown', callback);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [callback, ...dependencies]);
}