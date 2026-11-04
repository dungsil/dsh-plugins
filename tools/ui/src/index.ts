export * from './settings.js'

// Keep upstream primitives behind this facade without changing their props or identity.
export {
  Button,
  CodeBlock,
  FileTypeIcon,
  Input,
  MarkdownText,
  Menu,
  MenuSurface,
  Modal,
  Pill,
  SegmentedControl,
  SegmentedTabs,
  StateDot,
  Switch,
  Tag,
  focusWithoutRing,
  useDismissOnOutsidePointer,
  writeClipboard,
  type MenuEntry,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
