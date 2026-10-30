import type { Context } from '@deepseek-ai/cordis'

const GUARD_MS = 10
const SETTLE_MS = 30
const SIGNAL_MS = 150
const GIVE_UP_MS = 400
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

interface Gesture {
  root: HTMLElement
  at: number
  ctrlKey: boolean
  metaKey: boolean
}

function composerOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const root = target.closest('[data-composer-input]')
  return root instanceof HTMLElement ? root : null
}

function isEnter(event: KeyboardEvent) {
  return event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13
}

function modifiersAllowed(event: KeyboardEvent) {
  return !event.shiftKey && !event.altKey && !event.getModifierState('AltGraph')
}

/**
 * Finish an IME commit with an ordinary Enter after the host's 10 ms guard.
 * Enter that both accepts a candidate and ends composition also sends: the DOM
 * cannot distinguish it from Enter-to-send. Shift/Alt+Enter remain untouched.
 */
export function installIMEEnter(ctx: Context) {
  ctx.effect(() => {
    let composingRoot: HTMLElement | null = null
    let ended: { root: HTMLElement; at: number; sent: boolean } | null = null
    let pending: (Gesture & { endedAt: number | null }) | null = null
    let enterDown: { root: HTMLElement; at: number } | null = null
    let enterUp: Gesture | null = null
    let timer: number | undefined
    let dispatching = false

    const cancel = () => {
      window.clearTimeout(timer)
      pending = null
      enterUp = null
    }

    const flush = () => {
      const gesture = pending
      pending = null
      if (!gesture || gesture.endedAt === null || composingRoot || ended?.sent) return
      const { root } = gesture
      if (!root.isConnected || !root.isContentEditable) return
      if (document.activeElement !== root && !root.contains(document.activeElement)) return
      if (Date.now() - gesture.endedAt <= GUARD_MS) {
        pending = gesture
        timer = window.setTimeout(flush, GUARD_MS + 5)
        return
      }
      if (ended) ended.sent = true
      enterUp = null
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        ctrlKey: gesture.ctrlKey,
        metaKey: gesture.metaKey,
        bubbles: true,
        cancelable: true,
        composed: true,
        isComposing: false,
      })
      dispatching = true
      try {
        root.dispatchEvent(event)
      } finally {
        dispatching = false
      }
    }

    const arm = (gesture: Gesture, endedAt: number | null) => {
      cancel()
      pending = { ...gesture, endedAt }
      timer = window.setTimeout(flush, endedAt === null ? GIVE_UP_MS : SETTLE_MS)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (dispatching) return
      if (!isEnter(event)) {
        // Continued typing/candidate navigation cancels the send, including keyup fallback.
        if (composingRoot || !MODIFIER_KEYS.has(event.key)) {
          cancel()
          ended = null
        }
        return
      }
      const root = composerOf(event.target)
      if (!root?.isContentEditable) return
      const now = Date.now()
      enterDown = { root, at: now }
      enterUp = null
      if (!modifiersAllowed(event) || event.repeat) {
        cancel()
        return
      }
      const active = composingRoot === root
      const recentEnd = ended?.root === root && now - ended.at < GUARD_MS
      const closing = active || event.isComposing || event.keyCode === 229 || recentEnd
      if (!closing) {
        cancel()
        return
      }
      // Never prevent the original event: the IME must commit the final syllable first.
      // A late isComposing/229 keydown is still swallowed by the host after its guard.
      const endedAt = !active && ended?.root === root && now - ended.at <= SIGNAL_MS ? ended.at : null
      arm({ root, at: now, ctrlKey: event.ctrlKey, metaKey: event.metaKey }, endedAt)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (dispatching || !isEnter(event) || !modifiersAllowed(event)) return
      const root = composerOf(event.target)
      if (!root?.isContentEditable) return
      const now = Date.now()
      if (enterDown?.root === root && now - enterDown.at <= 2000) return
      // Some IMEs expose only Process/229 on keydown; keyup identifies Enter.
      enterUp = { root, at: now, ctrlKey: event.ctrlKey, metaKey: event.metaKey }
      if (pending || composingRoot) return
      if (ended?.root !== root || ended.sent || now - ended.at > SIGNAL_MS) return
      arm(enterUp, ended.at)
    }

    const onCompositionStart = (event: CompositionEvent) => {
      const root = composerOf(event.target)
      if (!root) return
      cancel()
      composingRoot = root
      ended = null
      enterDown = null
    }

    const onCompositionEnd = (event: CompositionEvent) => {
      const root = composerOf(event.target)
      if (!root) return
      // Even a temporarily non-editable composer must clear its composing state.
      if (composingRoot === root) composingRoot = null
      const now = Date.now()
      ended = { root, at: now, sent: false }
      const gesture = pending ?? enterUp
      if (!gesture || gesture.root !== root) return
      if (now - gesture.at > SIGNAL_MS) {
        cancel()
        return
      }
      arm(gesture, now)
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('compositionstart', onCompositionStart, true)
    document.addEventListener('compositionend', onCompositionEnd, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('compositionstart', onCompositionStart, true)
      document.removeEventListener('compositionend', onCompositionEnd, true)
      cancel()
    }
  }, 'locale-ko: IME Enter send')
}
