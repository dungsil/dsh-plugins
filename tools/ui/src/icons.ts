/// <reference path="./svg.d.ts" />
import { createElement } from 'react'
import resetIconSvg from './icons/reset.svg'

export { default as modelSettingsIconSvg } from './icons/model-settings.svg'
export { default as worktreeSettingsIconSvg } from './icons/worktree-settings.svg'

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
