import { createElement } from 'react'
import resetIconSvg from './icons/rotate-ccw.svg'
import bellSvg from './icons/bell.svg'
import bellOffSvg from './icons/bell-off.svg'

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

export { bellSvg as bellIconSvg }

/** Size a trusted, build-time 24×24 SVG asset like the DSH primitives (16px by default). */
function svgIcon(svg: string) {
  const html = svg.replace('width="24" height="24"', 'width="100%" height="100%"')
  return function Icon({ size = 16 }: { size?: number }) {
    return createElement('span', {
      style: { display: 'inline-flex', flex: 'none', width: size, height: size },
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: html },
    })
  }
}

export const IconBellOutlineRegular = /* @__PURE__ */ svgIcon(bellSvg)
export const IconBellOffOutlineRegular = /* @__PURE__ */ svgIcon(bellOffSvg)

export function IconResetOutlineRegular() {
  // Only trusted, build-time SVG assets are inserted as markup.
  return createElement('span', {
    style: { display: 'inline-flex' },
    'aria-hidden': 'true',
    dangerouslySetInnerHTML: { __html: resetIconSvg },
  })
}
