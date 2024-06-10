import { useRef, useState } from "react"

/**
 * Returns [state, setState, ref] where ref is a ref to the current state.
 */
export function useStateAndRef<T>(initialValue: T) {
  const [state, setState] = useState(initialValue)
  const ref = useRef(state)
  ref.current = state
  return [state, setState, ref] as const
}