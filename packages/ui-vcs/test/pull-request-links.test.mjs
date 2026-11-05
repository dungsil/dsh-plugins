import assert from 'node:assert/strict'
import test from 'node:test'
import { bindPullRequestLinks, pullRequestUrl } from '../src/pull-request-links.ts'

await test('PR and MR links normalize to the exact request across supported URL shapes', () => {
  for (const [input, expected] of [
    ['https://github.com/team/repo/pull/42', 'https://github.com/team/repo/pull/42'],
    ['https://github.com/team/repo/pull/42/files?diff=split#discussion_r1', 'https://github.com/team/repo/pull/42'],
    ['https://github.example/team/repo/pull/7/commits', 'https://github.example/team/repo/pull/7'],
    [
      'https://gitlab.com/group/subgroup/repo/-/merge_requests/8/diffs',
      'https://gitlab.com/group/subgroup/repo/-/merge_requests/8',
    ],
    ['http://forge.local:3000/prefix/team/repo/pulls/9/?tab=files', 'http://forge.local:3000/prefix/team/repo/pulls/9'],
    ['https://codeberg.org/team/repo/pulls/10', 'https://codeberg.org/team/repo/pulls/10'],
  ])
    assert.equal(pullRequestUrl(input), expected, input)
})

await test('ordinary pages, local paths, credentials and invalid request numbers are not PR links', () => {
  for (const input of [
    'https://github.com/team/repo/issues/42',
    'https://github.com/team/repo/pulls',
    'https://github.com/team/repo/pull/new',
    'https://github.com/team/repo/pull/0',
    'https://github.com/team/repo/pull/9007199254740992',
    'https://github.com/team/repo/pull/42/unknown',
    'https://gitlab.com/group/repo/merge_requests/8',
    'https://github.com/repo/pull/42',
    'https://user:secret@github.com/team/repo/pull/42',
    'https://@github.com/team/repo/pull/42',
    'https://github.com/team/repo/other/../pull/42',
    'https://github.com/team/repo/pull/42\\files',
    'javascript:alert(1)',
    '/team/repo/pull/42',
    'file:///team/repo/pull/42',
    'not a URL',
  ])
    assert.equal(pullRequestUrl(input), undefined, input)
})

await test('delegated link activation handles ordinary and keyboard clicks, preserving native alternatives', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  class Element {
    constructor(href) {
      this.href = href
    }
    closest(selector) {
      return selector === 'a[href]' ? this.anchor : undefined
    }
    getAttribute() {
      return this.href
    }
    hasAttribute() {
      return this.download ?? false
    }
  }
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: Element })
  try {
    let listener,
      removed,
      opens = 0
    const root = {
      contains: (anchor) => anchor.inside !== false,
      addEventListener: (name, callback, capture) => {
        assert.equal(name, 'click')
        assert.equal(capture, true)
        listener = callback
      },
      removeEventListener: (...args) => {
        removed = args
      },
    }
    const dispose = bindPullRequestLinks(root, (url) => {
      assert.equal(url, 'https://github.com/team/repo/pull/42')
      opens++
      return true
    })
    const target = new Element()
    const anchor = new Element('https://github.com/team/repo/pull/42#discussion')
    target.anchor = anchor
    const activate = (extra = {}) => {
      const event = {
        target,
        button: 0,
        ...extra,
        preventDefault() {
          this.defaultPrevented = true
        },
        stopPropagation() {
          this.stopped = true
        },
      }
      listener(event)
      return event
    }
    for (const extra of [{}, { detail: 0 }]) {
      const event = activate(extra)
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.stopped, true)
    }
    assert.equal(opens, 2)
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { defaultPrevented: true },
    ]) {
      assert.equal(activate(extra).stopped, undefined)
    }
    for (const mutate of [
      () => {
        anchor.href = 'https://github.com/team/repo/issues/42'
      },
      () => {
        anchor.href = 'https://github.com/team/repo/pull/42'
        anchor.download = true
      },
      () => {
        anchor.download = false
        anchor.inside = false
      },
    ]) {
      mutate()
      assert.equal(activate().stopped, undefined)
    }
    assert.equal(opens, 2)
    dispose()
    assert.deepEqual(removed, ['click', listener, true])
    anchor.inside = true
    for (const open of [
      () => false,
      () => {
        throw new Error('Sidebar unavailable')
      },
    ]) {
      bindPullRequestLinks(root, open)
      assert.equal(activate().stopped, undefined)
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Element', previous)
    else delete globalThis.Element
  }
})
