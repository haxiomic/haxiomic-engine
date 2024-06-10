import { useRef, useState } from "react";

/**
 * Returns a an object with a .value property that triggers a re-render when changed
 * @param initialValue 
 * @returns { value: T }
 */
export function useReactiveProperty<T>(initialValue: T) {
	const [_, setValue] = useState(initialValue);
	const valueRef = useRef(initialValue);
	const objRef = useRef({
		get value() {
			return valueRef.current;
		},
		set value(v: T) {
			valueRef.current = v;
			setValue(v);
		}
	});
	return objRef.current;
}
