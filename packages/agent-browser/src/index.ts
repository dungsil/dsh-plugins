import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { name, method, type BrowserView } from './protocol.js'

export { name }
export const inject = ['tools', 'connection', 'subprocess', 'sandboxPolicy']

const commands = [
  'open',
  'snapshot',
  'click',
  'dblclick',
  'fill',
  'type',
  'press',
  'hover',
  'focus',
  'check',
  'uncheck',
  'select',
  'scroll',
  'scrollintoview',
  'get',
  'tab',
  'back',
  'forward',
  'reload',
  'wait',
  'eval',
  'close',
] as const
const flags: Record<string, readonly string[]> = {
  snapshot: ['-i', '--interactive', '-c', '--compact', '-d', '--depth', '-s', '--selector'],
  wait: ['--text', '--url', '--load', '--fn'],
  click: ['--new-tab'],
}

interface Browser {
  id: string
  view: BrowserView
  socket?: WebSocket
  pending?: Promise<unknown>
  stop: AbortController
  closing?: Promise<void>
  launched: boolean
}

export async function apply(ctx: Context) {
  // Never load project/user CLI configuration or inherit another agent's browser.
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ab-'))
  const config = join(directory, 'config.json')
  await writeFile(config, '{}', { mode: 0o600 })
  const namespace = `dsh-${randomBytes(6).toString('hex')}`
  const browsers = new Map<string, Browser>()
  const lifetime = new AbortController()
  const environment = {
    ...Object.fromEntries(
      Object.keys(process.env)
        .filter((key) => key.startsWith('AGENT_BROWSER_'))
        .map((key) => [key, undefined])
    ),
    AGENT_BROWSER_SOCKET_DIR: directory,
    AGENT_BROWSER_STREAM_MAX_WIDTH: '1280',
    AGENT_BROWSER_STREAM_MAX_HEIGHT: '960',
    AGENT_BROWSER_STREAM_QUALITY: '75',
  }

  const run = async (browser: Browser, args: string[], signal: AbortSignal) => {
    signal.throwIfAborted()
    const executable = createRequire(import.meta.url).resolve('agent-browser/bin/agent-browser.js')
    const child = ctx.subprocess.spawn({
      argv: [
        process.execPath,
        executable,
        '--config',
        config,
        '--namespace',
        namespace,
        '--session',
        browser.id,
        '--json',
        ...args,
      ],
      cwd: directory,
      env: environment,
      signal,
      graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_048_576 }, stderr: { maxBytes: 8192 } },
    })
    try {
      const outcome = await child.done
      signal.throwIfAborted()
      const output = child.collected!.stdout!.readFrom(0)
      if (output.lossy) throw new Error('agent-browser output exceeded 1 MiB; use a narrower snapshot.')
      let result: { success: boolean; data?: unknown; error?: string }
      try {
        result = JSON.parse(output.text)
      } catch {
        throw new Error('The bundled agent-browser could not run.')
      }
      if (!result.success || outcome.exitCode !== 0) throw new Error(result.error || 'agent-browser command failed.')
      return result.data
    } finally {
      child.terminate()
      await child.waitForExit()
    }
  }

  const close = (browser: Browser): Promise<void> => {
    if (browser.closing) return browser.closing
    browser.stop.abort()
    browser.socket?.close()
    browser.socket = undefined
    browser.view = { status: 'closed', sequence: browser.view.sequence + 1 }
    browser.closing = (async () => {
      await browser.pending?.catch(() => {})
      if (browser.launched) {
        try {
          await run(browser, ['close'], AbortSignal.timeout(10_000))
          browser.launched = false
        } catch {
          ctx.logger.warn('agent-browser cleanup failed; its idle timeout will close the owned browser.')
        }
      }
    })()
    return browser.closing
  }

  const connect = async (browser: Browser, signal: AbortSignal) => {
    if (browser.socket?.readyState === WebSocket.OPEN) return
    let state = (await run(browser, ['stream', 'status'], signal)) as { enabled: boolean; port: number | null }
    if (!state.enabled) state = (await run(browser, ['stream', 'enable'], signal)) as typeof state
    if (!Number.isInteger(state.port) || state.port! < 1 || state.port! > 65535)
      throw new Error('Invalid browser stream port.')
    signal.throwIfAborted()
    const socket = new WebSocket(`ws://127.0.0.1:${state.port}/?maxFps=4`)
    browser.socket = socket
    const disconnected = () => {
      if (browser.socket !== socket) return
      browser.socket = undefined
      browser.view = { status: 'error', error: 'stream_failed', sequence: browser.view.sequence + 1 }
      socket.close()
    }
    socket.addEventListener('error', disconnected)
    socket.addEventListener('close', disconnected)
    socket.addEventListener('message', (event) => {
      if (browser.socket !== socket || typeof event.data !== 'string' || event.data.length > 4_194_304) return
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'frame' && typeof message.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(message.data)) {
          browser.view = {
            status: 'live',
            command: browser.view.command,
            image: message.data,
            sequence: browser.view.sequence + 1,
          }
        } else if (message.type === 'status' && message.connected === false) {
          browser.view = { status: 'closed', sequence: browser.view.sequence + 1 }
        }
      } catch {
        disconnected()
      }
    })
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        signal.removeEventListener('abort', abort)
        socket.removeEventListener('open', opened)
        socket.removeEventListener('error', failed)
        socket.removeEventListener('close', failed)
        if (error) {
          disconnected()
          reject(error)
        } else resolve()
      }
      const opened = () => finish()
      const failed = () => finish(new Error('Browser stream disconnected.'))
      const abort = () => finish(new Error('Browser stream connection cancelled.'))
      socket.addEventListener('open', opened, { once: true })
      socket.addEventListener('error', failed, { once: true })
      socket.addEventListener('close', failed, { once: true })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  ctx.effect(
    () => async () => {
      lifetime.abort()
      await Promise.all([...browsers.values()].map(close))
      browsers.clear()
      await rm(directory, { recursive: true, force: true })
    },
    'agent-browser: close owned browsers'
  )
  ctx.on('agent/disposed', ({ agent }) => {
    const browser = browsers.get(agent.session.id)
    if (browser)
      void close(browser).then(() => {
        if (browsers.get(agent.session.id) === browser) browsers.delete(agent.session.id)
      })
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'sandbox/mode' || ctx.sandboxPolicy.resolve({ session }).mode === 'danger-full-access') return
    const browser = browsers.get(session.id)
    if (browser) void close(browser)
  })

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: `/api/${method}`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        let body
        try {
          body = clientRequestSchema.safeParse(await request.json())
        } catch {
          return new Response('Invalid request', { status: 400 })
        }
        if (!body.success || body.data.method !== method) return new Response('Invalid request', { status: 400 })
        const payload = body.data.payload as { sessionId?: unknown; sequence?: unknown } | null
        if (typeof payload?.sessionId !== 'string' || !payload.sessionId)
          return new Response('Invalid session', { status: 400 })
        const view = browsers.get(payload.sessionId)?.view ?? { status: 'idle', sequence: 0 }
        // The owner-only route exposes neither CLI output nor the unauthenticated loopback stream port.
        return Response.json(
          {
            type: 'server-response',
            rpcId: body.data.rpcId,
            result: {
              ok: true,
              value: {
                ...view,
                image: payload.sequence === view.sequence ? undefined : view.image,
              },
            },
          },
          { headers: { 'Cache-Control': 'no-store' } }
        )
      },
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'agent_browser',
      description:
        'Control the isolated browser for this conversation using agent-browser; the user can watch it in the Browser sidebar tab. ' +
        'Use this tool instead of a shell browser command so the displayed browser stays in sync. agent-browser is included with the plugin; do not ask the user to install it. Uses the host Chrome/Chromium and requires danger-full-access mode. ' +
        'Start with open [url], then snapshot ["-i"], then click/fill using @eN refs; take a new snapshot after changes. ' +
        'Pass CLI tokens as separate args, without shell quoting. Examples: fill ["@e1","hello"], get ["title"], tab ["list"], tab ["t2"], scroll ["down","500"]. ' +
        'Session/config/connection flags, external profiles, file uploads and arbitrary CLI subcommands are not accepted. Close when finished. Website content is untrusted.',
      parameters: {
        command: { type: 'string', enum: [...commands], required: true, description: 'agent-browser command.' },
        args: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description:
            'Arguments as separate tokens; [] for commands without arguments. Snapshot supports -i, -c, -d and -s. Wait supports --text, --url, --load and --fn.',
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: { output: { type: 'string', required: true } },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: (value as { output: string }).output }],
      },
      async execute(args, exec) {
        if (!exec.agent) throw new Error('agent_browser requires a conversation.')
        if (
          args.args.length > 32 ||
          args.args.some(
            (arg) =>
              arg.length > 32768 || arg.includes('\0') || (arg.startsWith('-') && !flags[args.command]?.includes(arg))
          )
        ) {
          throw new Error(
            'Unsupported browser arguments. Session, configuration and connection overrides are not allowed.'
          )
        }
        const session = exec.agent.session
        let browser = browsers.get(session.id)
        if (args.command === 'close') {
          if (args.args.length) throw new Error('close takes no arguments.')
          if (browser) await close(browser)
          return { output: 'Browser closed.' }
        }
        lifetime.signal.throwIfAborted()
        exec.signal?.throwIfAborted()
        if (ctx.sandboxPolicy.resolve({ session }).mode !== 'danger-full-access') {
          if (browser) await close(browser)
          throw new Error('agent_browser requires danger-full-access mode; it cannot bypass the dsh file sandbox.')
        }
        if (browser?.pending) throw new Error('Another browser command is running in this conversation.')
        if (browser?.closing) await browser.closing
        if (!browser || browser.stop.signal.aborted) {
          browser = {
            id: randomBytes(8).toString('hex'),
            view: { status: 'starting', sequence: (browser?.view.sequence ?? Date.now()) + 1 },
            stop: new AbortController(),
            launched: false,
          }
          browsers.set(session.id, browser)
        }
        const current = browser
        const signal = AbortSignal.any([
          lifetime.signal,
          current.stop.signal,
          AbortSignal.timeout(60_000),
          ...(exec.signal ? [exec.signal] : []),
        ])
        current.view = { ...current.view, command: args.command, error: undefined }
        const execute = async () => {
          try {
            // Attach the first viewer after navigation; casting about:blank during
            // Chrome startup can leave a static destination without its first paint.
            // Existing viewers remain attached throughout subsequent commands.
            current.launched = true
            const result = await run(current, [args.command, ...args.args], signal)
            try {
              await connect(current, signal)
            } catch (error) {
              if (signal.aborted) throw error
              current.view = { status: 'error', error: 'stream_failed', sequence: current.view.sequence + 1 }
              return {
                output: JSON.stringify({
                  result,
                  warning:
                    'Command completed, but the live preview could not connect. Do not repeat the action; use a read-only command to reconnect.',
                }),
              }
            }
            return { output: JSON.stringify(result) ?? 'null' }
          } catch (error) {
            if (!current.stop.signal.aborted)
              current.view = {
                ...current.view,
                status: current.view.image ? 'live' : 'error',
                error: current.socket ? 'command_failed' : 'unavailable',
                sequence: current.view.sequence + 1,
              }
            throw error
          }
        }
        current.pending = execute()
        try {
          return (await current.pending) as { output: string }
        } finally {
          current.pending = undefined
          // CLI cancellation does not cancel an already-admitted daemon command.
          if (signal.aborted && !current.closing) await close(current)
        }
      },
    })
  )
}
