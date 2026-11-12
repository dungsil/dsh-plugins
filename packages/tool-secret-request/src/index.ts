import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { channel, endpointPrefix, maxSecretLength, type SecretRequest, type SecretStatus } from './protocol.js'

export const name = 'dungsil-request-secret'
export const inject = ['tools', 'credentials', 'connection', 'agents']

interface Pending {
  view: SecretRequest
  saving?: Promise<void>
  finish: (status: SecretStatus) => void
}

export function apply(ctx: Context) {
  const pending = new Map<string, Pending>()
  const lifetime = new AbortController()
  let lastClientSeen = 0

  ctx.effect(
    () => async () => {
      lifetime.abort()
      await Promise.all([...pending.values()].flatMap((request) => (request.saving ? [request.saving] : [])))
    },
    'request-secret: pending requests'
  )

  const handle = async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    const failure = (code: string) => ({
      ok: false as const,
      error: { code, message: 'Secret request could not be completed.', details: {} },
    })
    if (lifetime.signal.aborted || signal.aborted) return failure('cancelled')
    if (endpoint === 'pending') {
      lastClientSeen = Date.now()
      return { ok: true, value: [...pending.values()].map((request) => request.view) }
    }
    if (endpoint !== 'answer' || !payload || typeof payload !== 'object') return failure('invalid')
    const answer = payload as { id?: unknown; action?: unknown; value?: unknown }
    if (typeof answer.id !== 'string') return failure('invalid')
    const request = pending.get(answer.id)
    if (!request || request.saving) return failure('closed')
    if (answer.action === 'decline') {
      request.finish('declined')
      return { ok: true, value: null }
    }
    if (
      answer.action !== 'save' ||
      typeof answer.value !== 'string' ||
      !answer.value.length ||
      answer.value.length > maxSecretLength
    )
      return failure('invalid')

    // Lock before the first await: another tab cannot overwrite the same request.
    const value = answer.value
    let saved = false
    request.saving = Promise.resolve().then(async () => {
      try {
        await ctx.credentials.set(credentialRef(request.view.ref), value)
        saved = true
        request.finish('saved')
      } catch {
        // Credential providers may include the submitted value in an exception.
        // Neither the browser nor the tool result receives that exception.
      }
    })
    await request.saving
    request.saving = undefined
    return saved ? { ok: true, value: null } : failure('save_failed')
  }

  // Connection's exact Fetch routes enforce authenticated owner-only access
  // before dispatch. Keep its standard RPC envelope for the browser carrier.
  for (const endpoint of ['pending', 'answer']) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${endpointPrefix}${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let body
            try {
              body = clientRequestSchema.safeParse(await request.json())
            } catch {
              return new Response('Invalid request', { status: 400 })
            }
            if (!body.success || body.data.method !== `${endpointPrefix}${endpoint}`) {
              return new Response('Invalid request', { status: 400 })
            }
            const result = await handle(endpoint, body.data.payload, request.signal)
            return Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              {
                headers: { 'Cache-Control': 'no-store' },
              }
            )
          },
        }),
      `request-secret: ${endpoint} route`
    )
  }

  ctx.tools.register(
    defineTool({
      name: 'request_secret',
      description:
        'Ask the user to save a secret in DSH through a private password form. ' +
        'Pass only its environment-style reference name, a label and a reason, NEVER the secret value. ' +
        'Requires the plugin in an open DSH web UI. Returns only status and reference. ' +
        'The credential persists in the host-wide DSH credential store and replaces any stored value at that reference. ' +
        'It is NOT exported to shell environment variables or written to the project .env. ' +
        'Use it only for consumers of DSH credential references. Never ask for secrets in chat or read the credential file.',
      parameters: {
        ref: {
          type: 'string',
          required: true,
          description:
            'DSH credential reference, e.g. STRIPE_API_KEY. Letters, digits and underscores; cannot start with a digit.',
        },
        label: {
          type: 'string',
          required: true,
          description: 'Card title: the environment-style key name or a short description of the key.',
        },
        reason: {
          type: 'string',
          required: true,
          description:
            'One short sentence explaining why this key is needed by the DSH consumer. Omit input instructions and storage details.',
        },
        timeout_ms: { type: 'integer', description: 'Wait from 1000 to 600000 milliseconds; default 600000.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            ref: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        if (
          !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(args.ref) ||
          !args.label.trim() ||
          args.label.length > 200 ||
          !args.reason.trim() ||
          args.reason.length > 2000 ||
          (args.timeout_ms !== undefined &&
            (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 1000 || args.timeout_ms > 600_000))
        ) {
          throw new Error('Invalid secret request metadata.')
        }
        const ref = credentialRef(args.ref)
        const result = (status: SecretStatus) => ({ status, ref: args.ref })
        if (exec.signal?.aborted || lifetime.signal.aborted) return result('cancelled')
        // Delegated agents have no independent human interaction surface.
        if (
          !exec.agent ||
          ctx.agents.get(exec.agent.session.id) !== exec.agent ||
          exec.agent.session.header.origin === 'subagent' ||
          Date.now() - lastClientSeen > 15_000
        )
          return result('unavailable')
        if ([...pending.values()].some((request) => request.view.ref === ref)) {
          throw new Error('Another secret request is already using this reference.')
        }
        let configured: boolean
        try {
          const info = await ctx.credentials.describe(ref)
          if (!info.writable) return result('unavailable')
          configured = info.configured
        } catch {
          return result('unavailable')
        }
        const signal = AbortSignal.any([lifetime.signal, ...(exec.signal ? [exec.signal] : [])])
        if (signal.aborted) return result('cancelled')
        // Recheck after describe: simultaneous calls may have passed the first check.
        if ([...pending.values()].some((request) => request.view.ref === ref)) {
          throw new Error('Another secret request is already using this reference.')
        }
        return new Promise<{ status: SecretStatus; ref: string }>((resolve) => {
          const id = randomUUID()
          const finish = (status: SecretStatus) => {
            clearTimeout(timer)
            signal.removeEventListener('abort', cancel)
            pending.delete(id)
            resolve(result(status))
          }
          const request: Pending = {
            view: {
              id,
              ref: args.ref,
              label: args.label,
              reason: args.reason,
              sessionId: exec.agent!.session.id,
              callId: exec.callId,
              configured,
            },
            finish,
          }
          // A user-admitted write cannot be rolled back. Let it finish before settling cancellation.
          const stop = (status: SecretStatus) => {
            if (request.saving)
              void request.saving.then(() => {
                if (pending.has(id)) finish(status)
              })
            else finish(status)
          }
          const cancel = () => stop('cancelled')
          const timer = setTimeout(() => stop('timed_out'), args.timeout_ms ?? 600_000)
          timer.unref()
          signal.addEventListener('abort', cancel, { once: true })
          pending.set(id, request)
        })
      },
    })
  )
}
