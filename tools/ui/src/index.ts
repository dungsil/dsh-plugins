export * from './settings.js'

// Keep upstream primitives behind this facade without changing their props or identity.
export {
  Input,
  Menu,
  MenuSurface,
  Pill,
  SegmentedControl,
  Switch,
  focusWithoutRing,
  useDismissOnOutsidePointer,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
