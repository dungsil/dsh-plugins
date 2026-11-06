import { createElement } from 'react'
import resetIconSvg from './icons/rotate-ccw.svg'

export { default as cliProxyIconSvg } from './icons/diamond-interlocking-loops.svg'
export { default as modelSettingsIconSvg } from './icons/circle-to-squares.svg'
export { default as worktreeSettingsIconSvg } from './icons/git-branch.svg'
export { default as pullRequestIconSvg } from './icons/git-pull-request.svg'
export { default as pullRequestDraftIconSvg } from './icons/git-pull-request-draft.svg'
export { default as pullRequestClosedIconSvg } from './icons/git-pull-request-closed.svg'
export { default as mergeIconSvg } from './icons/git-merge.svg'
export { default as circleXIconSvg } from './icons/circle-x.svg'
export { default as circleMinusIconSvg } from './icons/circle-minus.svg'

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
  IconCopyOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconGlobeOutlineRegular,
  IconGaugeOutlineRegular,
  IconLinkOutlineRegular,
  IconLoadingOutlineRegular,
  IconPlusOutlineRegular,
  IconQuestionOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconSearchOutlineRegular,
  IconSkillOutlineRegular,
  IconStopFillRegular,
  IconWrapLinesOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'

export function IconResetOutlineRegular() {
  // Only trusted, build-time SVG assets are inserted as markup.
  return createElement('span', {
    style: { display: 'inline-flex' },
    'aria-hidden': 'true',
    dangerouslySetInnerHTML: { __html: resetIconSvg },
  })
}
