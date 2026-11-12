export * from './settings.js'
export { ButtonPicker } from './button-picker.js'
export { PluginPage } from './page.js'
export { pageStyles } from './page-styles.js'
export { AnnotatedDiffBlock, annotatedDiffStyles } from './annotated-diff.js'

// Keep upstream primitives behind this facade without changing their props or identity.
export {
  Button,
  CodeBlock,
  DiffBlock,
  type DiffBlockLabels,
  type DiffBlockProps,
  type DiffHunk,
  DisclosureRow,
  FileTypeIcon,
  IconPluginPinwheelOutlineRegular,
  Input,
  MarkdownDelegateProvider,
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
  useMarkdownDelegate,
  writeClipboard,
  type MenuEntry,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
