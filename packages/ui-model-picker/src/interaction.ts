// Slider gesture state, backported from DUN Harness ui-reasoning-slider.
// A pointer or keyboard gesture only moves the draft; releasing it commits once.
export type Gesture = 'pointer' | 'keyboard' | null
export interface Interaction {
  selected: number
  draft: number
  gesture: Gesture
}
export type Action =
  | { type: 'sync'; selected: number }
  | { type: 'begin'; gesture: Exclude<Gesture, null> }
  | { type: 'change'; index: number }
  | { type: 'commit'; gesture: Gesture }
  | { type: 'cancel' }

export interface Transition {
  state: Interaction
  commit?: number
}

export function transition(state: Interaction, action: Action): Transition {
  switch (action.type) {
    case 'sync':
      return action.selected === state.selected
        ? { state }
        : { state: { draft: action.selected, gesture: null, selected: action.selected } }
    case 'begin':
      return { state: { ...state, gesture: action.gesture } }
    case 'change': {
      const next = { ...state, draft: action.index }
      // A change without a gesture (assistive technology) commits immediately.
      return state.gesture === null ? transition(next, { gesture: null, type: 'commit' }) : { state: next }
    }
    case 'commit':
      if (state.gesture !== action.gesture) return { state }
      return {
        state: { ...state, gesture: null },
        ...(state.draft === state.selected ? {} : { commit: state.draft }),
      }
    case 'cancel':
      return { state: { ...state, draft: state.selected, gesture: null } }
  }
}
