import { useMemo } from 'react'
import { useSubscription } from 'use-subscription'

export type State = Record<string | number | symbol, any>
export type PartialState<T extends State> =
  | Partial<T>
  | ((state: T) => Partial<T>)
  | ((state: T) => void) // for immer https://github.com/react-spring/zustand/pull/99
export type StateSelector<T extends State, U> = (state: T) => U
export type EqualityChecker<T> = (state: T, newState: any) => boolean

export type StateListener<T> = (state: T | null, error?: Error) => void
export type Subscribe<T extends State> = <U>(
  listener: StateListener<U>,
  selector?: StateSelector<T, U>,
  equalityFn?: EqualityChecker<U>
) => () => void
export type SetState<T extends State> = (
  partial: PartialState<T>,
  replace?: boolean
) => void
export type GetState<T extends State> = () => T
export type Destroy = () => void
export interface StoreApi<T extends State> {
  setState: SetState<T>
  getState: GetState<T>
  subscribe: Subscribe<T>
  destroy: Destroy
}
export type StateCreator<T extends State> = (
  set: SetState<T>,
  get: GetState<T>,
  api: StoreApi<T>
) => T

export interface UseStore<T extends State> {
  (): T
  <U>(selector: StateSelector<T, U>, equalityFn?: EqualityChecker<U>): U
  /*
  setState: SetState<T>
  getState: GetState<T>
  subscribe: Subscribe<T>
  destroy: Destroy
  useStore: UseStore<T> // This allows namespace pattern
  */
}

export default function create<TState extends State>(
  createState: StateCreator<TState>
): [UseStore<TState>, StoreApi<TState>] {
  let state: TState
  let listeners: Set<() => void> = new Set()

  const setState: SetState<TState> = (partial, replace) => {
    const nextState = typeof partial === 'function' ? partial(state) : partial
    if (nextState !== state) {
      if (replace) {
        state = nextState as TState
      } else {
        state = Object.assign({}, state, nextState)
      }
      listeners.forEach(listener => listener())
    }
  }

  const getState: GetState<TState> = () => state

  const subscribe: Subscribe<TState> = <StateSlice>(
    listener: StateListener<StateSlice>,
    selector: StateSelector<TState, StateSlice> = getState,
    equalityFn: EqualityChecker<StateSlice> = Object.is
  ) => {
    let currentSlice: StateSlice = selector(state)
    function listenerToAdd() {
      // Selector or equality function could throw but we don't want to stop
      // the listener from being called.
      // https://github.com/react-spring/zustand/pull/37
      try {
        const newStateSlice = selector(state)
        if (!equalityFn(currentSlice, newStateSlice)) {
          listener((currentSlice = newStateSlice))
        }
      } catch (error) {
        listener(null, error)
      }
    }
    listeners.add(listenerToAdd)
    const unsubscribe = () => {
      listeners.delete(listenerToAdd)
    }
    return unsubscribe
  }

  const destroy: Destroy = () => listeners.clear()

  const useStore: UseStore<TState> = <StateSlice>(
    selector: StateSelector<TState, StateSlice> = getState,
    equalityFn: EqualityChecker<StateSlice> = Object.is
  ) => {
    const subscription = useMemo(() => {
      let currentSlice: StateSlice = selector(state)
      let errored = false
      return {
        getCurrentValue: () => {
          try {
            if (errored) {
              errored = false
              const newStateSlice = selector(state)
              if (equalityFn(currentSlice, newStateSlice)) {
                return currentSlice
              }
              return newStateSlice
            }
          } catch (e) {
            // ignore and useSubscription will schedule update
          }
          return currentSlice
        },
        subscribe: (callback: () => void) => {
          const listener = (nextSlice: StateSlice | null, error?: Error) => {
            if (error) {
              errored = true
            } else {
              currentSlice = nextSlice as StateSlice
            }
            callback()
          }
          const unsubscribe = subscribe(listener, selector, equalityFn)
          return unsubscribe
        },
      }
    }, [selector, equalityFn])
    return useSubscription(subscription)
  }

  const api = { setState, getState, subscribe, destroy }
  state = createState(setState, getState, api)

  return [useStore, api]
}

export { create }
