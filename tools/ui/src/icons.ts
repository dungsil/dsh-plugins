import { createElement } from 'react'
import languagesIconSvg from './icons/languages.svg'
import resetIconSvg from './icons/rotate-ccw.svg'
import starIconSvg from './icons/star.svg'

export { ProviderIcon } from './provider-icon.js'

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
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconQuestionOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconSearchOutlineRegular,
  IconSkillOutlineRegular,
  IconStopFillRegular,
  IconWarningTriangleOutlineRegular,
  IconWrapLinesOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'

function svgIcon(svg: string) {
  // Only trusted, build-time SVG assets are inserted as markup.
  return createElement('span', {
    style: { display: 'inline-flex' },
    'aria-hidden': 'true',
    // Formatting whitespace would otherwise become text inside the host element.
    dangerouslySetInnerHTML: { __html: svg.trim().replace(/>\s+</g, '><') },
  })
}

export function IconResetOutlineRegular() {
  return svgIcon(resetIconSvg)
}

export function IconLanguagesOutlineRegular() {
  return svgIcon(languagesIconSvg)
}

/** Outline star; consumers fill it with `fill: currentColor` for the selected state. */
export function IconStarOutlineRegular() {
  return svgIcon(starIconSvg)
}
