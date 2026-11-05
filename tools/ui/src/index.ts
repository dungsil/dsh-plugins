export * from './settings.js'

// Keep upstream primitives behind this facade without changing their props or identity.
export {
  Button,
  CodeBlock,
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
