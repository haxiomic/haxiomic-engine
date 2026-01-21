export enum WatchableFilter {
	Always = 0,
	OnUserChange = 1,
}

/**
 * Triggers callbacks when a value is changed
 */
export class Watchable<T> {

	private _value: T;

	private callbacks = new Array<{
		callback: (value: T, previousValue: T) => void;
		filter: WatchableFilter;
	}>();

	get value() {
		return this._value;
	}

	set value(v: T) {
		this.setValue(v);
	}

	constructor(v: T) {
		this._value = v;
	}

	watch(callback: (value: T, previousValue: T) => void, filter: WatchableFilter = WatchableFilter.Always, immediateCallback = true) {
		this.callbacks.push({ callback, filter });
		if (immediateCallback) callback(this._value, this._value);
		return { unwatch: () => this.unwatch(callback) };
	}

	unwatch(callback: (value: T, previousValue: T) => void) {
		let i = 0;
		for (; i < this.callbacks.length; i++) {
			if (this.callbacks[i].callback === callback) {
				break;
			}
		}
		this.callbacks.splice(i, 1);
	}

	setValue(v: T, filter?: WatchableFilter) {
		let previousValue = this._value;
		this._value = v;
		for (let i = 0; i < this.callbacks.length; i++) {
			// If a filter is specified, only call callbacks with that filter
			// If no filter is specified, call all callbacks
			// If a callback has the Always filter, it will always be called
			let skipCallback =
				filter != null &&
				this.callbacks[i].filter !== filter && 
				this.callbacks[i].filter !== WatchableFilter.Always;
			if (skipCallback) continue;

			this.callbacks[i].callback(v, previousValue);
		}
	}

	getValue() {
		return this._value;
	}

}