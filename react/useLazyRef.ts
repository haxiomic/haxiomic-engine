import { useRef } from "react";

export function useLazyRef<T>(create: () => T) {
	const ref = useRef<T | null>(null);
	return {
		get current() {
			return ref.current = ref.current ?? create();
		}
	};
}