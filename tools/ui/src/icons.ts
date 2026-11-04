import { createElement } from 'react'

export {
  IconBranchOutlineRegular,
  IconCheckCircleOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconClockOutlineRegular,
  IconCloseOutlineRegular,
  IconDataOutlineRegular,
  IconLoadingOutlineRegular,
  IconPlusOutlineRegular,
  IconStopFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'

export function IconResetOutlineRegular() {
  return createElement(
    'svg',
    {
      width: '16',
      height: '16',
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.2',
      'aria-hidden': 'true',
    },
    createElement('path', { d: 'M3 4a5.5 5.5 0 1 1-1 6M3 1v3h3' })
  )
}

export const modelSettingsIconArtwork =
  '<circle cx="2.5" cy="8" r="1.75"/><path d="M4.25 8H5.5C8 8 7 3.5 10 3.5H11M5.5 8C8 8 7 12.5 10 12.5H11"/><rect x="11" y="1.75" width="3.5" height="3.5" rx=".6"/><rect x="11" y="10.75" width="3.5" height="3.5" rx=".6"/>'

export const worktreeSettingsIconArtwork =
  '<circle cx="4" cy="2.5" r="1.75"/><circle cx="4" cy="13.5" r="1.75"/><circle cx="12" cy="5.5" r="1.75"/><path d="M4 4.25V11.75M4 9H7C10 9 12 9 12 7.25"/>'
