/**
 * Functional programming utilities
 */

export function Switch<T extends string | number, Ret>(
	value: T,
	cases:
		{ [key in T]: Ret | ((value: T) => Ret) } |
		{ [key: string]: Ret | ((value: T) => Ret) } & { "default": Ret | ((value: T) => Ret) }
) {
	if (value in cases) {
		const caseValue = cases[value];
		if (caseValue instanceof Function) {
			return caseValue(value);
		} else {
			return caseValue;
		}
	} else if ("default" in cases) {
		const caseValue = cases["default"];
		// check if default is callable
		if (caseValue instanceof Function) {
			return caseValue(value);
		} else {
			return caseValue;
		}
	}
}