import { useCallback, useRef } from 'react'

let counter = 0
const nextKey = () => `k${++counter}`

/** Random id for new rules. `crypto.randomUUID` only exists in secure contexts, so fall back. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Stable React keys for list items that have no id of their own (conditions, variants).
 * Keys follow items by position: call `remove(index)` alongside removing the item and
 * `add()` alongside appending one. If the list length changes any other way the keys
 * are padded or truncated.
 */
export function useStableKeys(length: number) {
  const ref = useRef<string[]>([])
  const keys = ref.current
  while (keys.length < length) keys.push(nextKey())
  if (keys.length > length) keys.length = length

  const remove = useCallback((index: number) => {
    ref.current.splice(index, 1)
  }, [])
  const add = useCallback(() => {
    ref.current.push(nextKey())
  }, [])

  return { keys, remove, add }
}
