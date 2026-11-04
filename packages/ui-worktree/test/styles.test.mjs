import assert from 'node:assert/strict'
import test from 'node:test'
import { styles } from '../src/styles.ts'

await test('native worktree selector follows the composer permission selector sizing and theme', () => {
  const root = styles.match(/\.dsh-worktree \{([^}]+)\}/)[1]
  for (const declaration of [
    'font-size: 13px',
    'font-weight: 500',
    'line-height: 20px',
    'color: var(--dsw-alias-label-secondary)',
  ]) {
    assert.ok(root.includes(declaration), declaration)
  }
  const select = styles.match(/\.dsh-worktree-select \{([^}]+)\}/)[1]
  for (const declaration of [
    'height: 28px',
    'min-width: 0',
    'padding: 0 24px 0 26px',
    'border-radius: var(--dsw-radius-sm)',
    'appearance: none',
    'text-overflow: ellipsis',
  ]) {
    assert.ok(select.includes(declaration), declaration)
  }
  assert.match(styles, /\.dsh-worktree-picker \{[^}]*width: 220px/)
  assert.match(styles, /\.dsh-worktree-select:disabled[^}]*var\(--dsw-alias-label-dimmed\)/)
  assert.match(styles, /\.dsh-worktree-select:focus-visible[^}]*var\(--dsw-focus-ring-color/)
})

await test('native worktree states preserve compact layout, native options, and themed surfaces', () => {
  assert.match(styles, /@container \(width <= 460px\) \{\s*\.dsh-worktree-picker \{ width: 44px; \}/)
  assert.match(styles, /\.dsh-worktree-select \{ font-size: 0; \}/)
  assert.match(styles, /\.dsh-worktree-select option \{[^}]*font-size: 13px/)
  assert.match(
    styles,
    /@media \(hover: hover\) \{\s*\.dsh-worktree-select:hover:not\(:disabled\)[^}]*background: var\(--dsw-alias-interactive-bg-hover\)/
  )
  assert.match(styles, /overscroll-behavior: contain/)
  assert.match(styles, /background: var\(--dsw-specific-menu\)/)
  assert.match(styles, /box-shadow: var\(--dsw-elevation-prominent\)/)
  assert.doesNotMatch(styles, /#[\da-f]{3,8}\b/i)
  assert.doesNotMatch(styles, /dsh-worktree-trigger|aria-expanded|transition:|animation:/)
})
