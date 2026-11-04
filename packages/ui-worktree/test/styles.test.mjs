import assert from 'node:assert/strict'
import test from 'node:test'
import { styles } from '../src/styles.ts'

const declarations = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escaped} \\{([^}]+)\\}`))
  assert.ok(match, `missing stylesheet rule: ${selector}`)
  return match[1]
}

await test('host Menu trigger follows composer permission sizing without a fixed-width selector', () => {
  const root = declarations('.dsh-worktree')
  assert.ok(root.includes('display: inline-flex'))
  assert.ok(root.includes('color: var(--dsw-alias-label-secondary)'))
  const trigger = declarations('.dsh-worktree-trigger')
  for (const declaration of [
    'display: inline-flex',
    'align-items: center',
    'gap: 4px',
    'height: 28px',
    'min-width: 0',
    'max-width: 220px',
    'padding: 0 4px 0 8px',
    'font-size: 13px',
    'font-weight: 500',
    'line-height: 20px',
    'border-radius: var(--dsw-radius-sm)',
  ]) {
    assert.ok(trigger.includes(declaration), declaration)
  }
  assert.doesNotMatch(
    trigger,
    /(?:^|;)\s*width:\s*(?!auto\s*;)[^;]+;/,
    'trigger must use intrinsic width, not reserve a fixed width'
  )
  assert.doesNotMatch(
    declarations('.dsh-worktree-picker'),
    /(?:^|;)\s*width:\s*(?!auto\s*;)[^;]+;/,
    'picker must not reserve a fixed width'
  )
  const name = declarations('.dsh-worktree-name')
  for (const declaration of ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']) {
    assert.ok(name.includes(declaration), declaration)
  }
  assert.match(styles, /\.dsh-worktree-trigger:disabled[^}]*var\(--dsw-alias-label-dimmed\)/)
  assert.match(styles, /\.dsh-worktree-trigger:focus-visible[^}]*var\(--dsw-focus-ring-color/)
  const controls = declarations('.dsh-worktree-controls')
  assert.ok(controls.includes('display: inline-flex'))
  assert.ok(controls.includes('flex-wrap: nowrap'), 'picker and error details must remain on the same row')
  assert.ok(declarations('.dsh-worktree-picker').includes('max-width: 100%'))
  assert.doesNotMatch(styles, /\.dsh-worktree-refresh|calc\(100% - 28px\)/)
  assert.doesNotMatch(styles, /\.dsh-worktree-select|\.dsh-worktree-branch|appearance:\s*none/)
})

await test('compact trigger hides only its branch name and animates the open chevron only with motion enabled', () => {
  assert.match(styles, /@container \(width <= 460px\) \{\s*\.dsh-worktree-name \{\s*display: none;\s*\}/)
  assert.doesNotMatch(styles, /font-size:\s*0(?:px)?\s*[;}]/)
  assert.match(
    styles,
    /\.dsh-worktree-trigger\[aria-expanded=(?:true|"true"|'true')\] \.dsh-worktree-chevron \{[^}]*transform: rotate\(180deg\)/
  )
  const motion = styles.match(
    /@media \(prefers-reduced-motion: no-preference\) \{\s*\.dsh-worktree-chevron \{([^}]+)\}/
  )
  assert.ok(motion, 'chevron transition must be guarded by prefers-reduced-motion: no-preference')
  assert.match(motion[1], /transition:\s*transform\s+(?:120ms|0?\.12s)(?:\s+[^;]+)?;/)
  assert.equal((styles.match(/\btransition:/g) ?? []).length, 1, 'no unguarded transitions')
  assert.doesNotMatch(styles, /\banimation:/)
})

await test('error details stay outside the toolbar flow with a compact keyboard-focusable trigger', () => {
  assert.doesNotMatch(styles, /\.dsh-worktree-error\s*\{/)
  const trigger = declarations('.dsh-worktree-error-trigger')
  for (const declaration of ['min-height: 28px', 'white-space: nowrap', 'text-decoration: underline']) {
    assert.ok(trigger.includes(declaration), declaration)
  }
  assert.match(styles, /\.dsh-worktree-error-trigger:focus-visible[^}]*var\(--dsw-focus-ring-color/)
  const dialog = declarations('.dsh-worktree-dialog.dsh-worktree-error-dialog')
  assert.ok(dialog.includes('inset: 0'))
  assert.ok(dialog.includes('margin: auto'))
  assert.ok(declarations('.dsh-worktree-error-dialog dl').includes('minmax(0, 1fr)'))
  assert.ok(declarations('.dsh-worktree-error-dialog dd').includes('overflow-wrap: anywhere'))
})

await test('hover and dialog surfaces retain host theme tokens without local menu styling', () => {
  assert.match(
    styles,
    /@media \(hover: hover\) \{\s*\.dsh-worktree-trigger:hover:not\(:disabled\)[^}]*background: var\(--dsw-alias-interactive-bg-hover\)/
  )
  const dialog = declarations('.dsh-worktree-dialog')
  for (const declaration of [
    'overscroll-behavior: contain',
    'background: var(--dsw-specific-menu)',
    'backdrop-filter: var(--dsw-menu-backdrop-filter)',
    'box-shadow: var(--dsw-elevation-prominent)',
  ]) {
    assert.ok(dialog.includes(declaration), declaration)
  }
  assert.match(styles, /\.dsh-worktree-dialog form > label/)
  assert.match(styles, /\.dsh-worktree-dialog input\[type=text\]/)
  assert.match(styles, /\.dsh-worktree-dialog footer/)
  assert.match(styles, /\.dsh-worktree-dialog \[role=alert\]/)
  assert.doesNotMatch(styles, /#[\da-f]{3,8}\b/i)
  assert.doesNotMatch(styles, /\.dsh-worktree-(?:menu|option|list)(?:\s|[.{:])/)
})
