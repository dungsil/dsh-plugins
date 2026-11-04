import './svg.d.ts'
import { createElement } from 'react'
import resetIconSvg from './icons/rotate-ccw.svg'

export { default as modelSettingsIconSvg } from './icons/circle-to-squares.svg'
export { default as worktreeSettingsIconSvg } from './icons/git-branch.svg'

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
  // Only trusted, build-time SVG assets are inserted as markup.
  return createElement('span', {
    style: { display: 'inline-flex' },
    'aria-hidden': 'true',
    dangerouslySetInnerHTML: { __html: resetIconSvg },
  })
}
