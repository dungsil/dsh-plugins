import { useEffect, useId, useRef, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { SettingsPicker, SettingsRow } from '@dungsil/dsh-ui'

type Checkout = 'current' | 'worktree'
type Text = {
  checkout: string
  checkoutHint: string
  checkoutCurrent: string
  checkoutWorktree: string
  checkoutError: string
}
const read = 'dungsil-worktree-preference/read'
const save = 'dungsil-worktree-preference/save'
export function DefaultCheckoutRow({ connection, text }: { connection: ConnectionHandle; text: Text }) {
  const id = useId()
  const [value, setValue] = useState<Checkout>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    lifetime.current = abort
    void connection.rpc
      .call('/api', read, {}, abort.signal)
      .then((result) => {
        if (abort.signal.aborted || !result.ok) return
        const next = (result.value as { defaultCheckout?: unknown } | null)?.defaultCheckout
        if (next === 'current' || next === 'worktree') setValue(next)
      })
      .catch(() => {})
    return () => abort.abort()
  }, [connection])
  if (!value) return null
  const choose = async (next: string) => {
    if (busy || (next !== 'current' && next !== 'worktree') || next === value) return
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted) return
    setBusy(true)
    setError(false)
    try {
      const result = await connection.rpc.call('/api', save, { defaultCheckout: next }, signal)
      if (signal.aborted) return
      if (!result.ok || (result.value as { defaultCheckout?: unknown } | null)?.defaultCheckout !== next)
        throw new Error('unconfirmed')
      setValue(next)
    } catch {
      if (!signal.aborted) setError(true)
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <>
      <SettingsRow
        label={
          <>
            <span id={id}>{text.checkout}</span>
            <p>{text.checkoutHint}</p>
          </>
        }
      >
        <SettingsPicker
          aria-labelledby={id}
          value={value === 'current' ? text.checkoutCurrent : text.checkoutWorktree}
          selectedId={value}
          items={[
            { id: 'current', label: text.checkoutCurrent },
            { id: 'worktree', label: text.checkoutWorktree },
          ]}
          disabled={busy}
          onSelect={(next) => void choose(next)}
        />
      </SettingsRow>
      {error && <p role="alert">{text.checkoutError}</p>}
    </>
  )
}
