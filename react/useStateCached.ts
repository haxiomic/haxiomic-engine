import { useEffect, useRef, useState } from "react";

/**
 * Caches state via local storage, initial value is retrieved from local storage if available
 */
export function useStateCached<T>(
	defaultState: T | (() => T),
	localStorageKey: string,
	serialize: (value: T) => string = JSON.stringify,
	deserialize: (value: string) => T = JSON.parse
) {
	const [value, setValue] = useState<T>(defaultState);
	const initializedRef = useRef(false);

	// cache in local storage
	useEffect(() => {
		if (initializedRef.current) {
			localStorage.setItem(localStorageKey, serialize(value));
		}
	}, [value]);

	// load from local storage (ordering below cache useEffect is important)
	useEffect(() => {
		if (initializedRef.current) return;
		let cachedProjects: string | null = null;
		cachedProjects = localStorage.getItem(localStorageKey);
		if (cachedProjects) {
			setValue(deserialize(cachedProjects));
		}
		initializedRef.current = true;
	}, []);

	return [value, setValue] as const;
}