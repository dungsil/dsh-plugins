export * from './settings.js'

// Keep upstream primitives behind this facade without changing their props or identity.
export {
  Button,
  FileTypeIcon,
  IconPluginPinwheelOutlineRegular,
  Input,
  Menu,
  MenuSurface,
  Pill,
  SegmentedControl,
  SegmentedTabs,
  StateDot,
  Switch,
  focusWithoutRing,
  useDismissOnOutsidePointer,
  writeClipboard,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
