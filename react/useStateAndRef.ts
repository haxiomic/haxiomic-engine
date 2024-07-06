import { Dispatch, SetStateAction, useRef, useState } from "react"

/**
 * Returns [state, setState, ref] where ref is a ref to the current state.
 * ref is updated immediately when setState is called.
 */
export function useStateAndRef<T>(initialValue: T) {
  const [state, setState] = useState(initialValue)
  const ref = useRef(state)
  const setStateAndRef: Dispatch<SetStateAction<T>> = (value: T | ((prev: T) => void)) => {
    if (typeof value === "function") {
      setState((prev) => {
        const next = (value as (prev: T) => T)(prev);
        ref.current = next
        return next
      })
    } else {
      ref.current = value
      setState(value)
    }
  }
  return [
    state,
    setStateAndRef,
    ref
  ] as const
}
