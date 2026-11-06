export * from './settings.js'
export { ButtonPicker } from './button-picker.js'
export { PluginPage } from './page.js'
export { pageStyles } from './page-styles.js'

// Keep upstream primitives behind this facade without changing their props or identity.
export {
  Button,
  CodeBlock,
  DisclosureRow,
  FileTypeIcon,
  IconPluginPinwheelOutlineRegular,
  Input,
  MarkdownText,
  Menu,
  MenuItemButton,
  MenuSurface,
  Modal,
  Pill,
  SegmentedControl,
  SegmentedTabs,
  StateDot,
  Switch,
  Tag,
  Tooltip,
  focusWithoutRing,
  useDismissOnOutsidePointer,
  writeClipboard,
  type MenuEntry,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
