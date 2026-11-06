import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  BrowserControllerState,
  BrowserInjected,
  BrowserMountRequest,
  BrowserTarget,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SlotComponent, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { installStyles } from '@dungsil/dsh-ui/client'
import en from '../locale/en.json' with { type: 'json' }
import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { name, method, controlMethod, type BrowserView } from './protocol.js'

export { name }
export const inject = ['slots', 'locale', 'connection', 'sidebarRight']

const browserSlot = 'sidebar.right.pane.tab'
const browserId = '@deepseek-ai/dsh-client-ui-sidebar-browser'
type Actions = Parameters<BrowserInjected['rebind']>[0]
const dictionaries: Record<string, typeof en> = { en, ko, zh, ja, es, fr, de, ru, pt }

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const text = (): Omit<typeof en, 'meta'> => {
    const language = ctx.locale.getSnapshot().active.toLowerCase().split(/[-_]/)[0]!
    return Object.hasOwn(dictionaries, language) ? dictionaries[language]! : en
  }
  const controllers = new Map<string, BrowserInjected>()

  const createControllers = (sessionId: string, initialActions: Actions): BrowserInjected => {
    let actions = initialActions
    let selected: string | undefined
    const tabs = new Map<string, ReturnType<typeof createTab>>()
    const call = async (tabId: string, action: string, value?: unknown) => {
      const result = await connection.rpc.call('/api', controlMethod, { sessionId, tabId, action, value })
      if (!result.ok) throw new Error(result.error.code)
    }
    const activate = async (tabId: string) => {
      if (
        ctx.sidebarRight.mounted.getSnapshot() !== sessionId ||
        ctx.sidebarRight.active()?.id !== tabId ||
        selected === tabId
      )
        return
      await call(tabId, 'activate')
      selected = tabId
    }

    function createTab(request: BrowserMountRequest) {
      const { tabId } = request
      const listeners = new Set<() => void>()
      let state: BrowserControllerState = {
        frame: {
          target: undefined,
          address: 'empty',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          error: undefined,
          sandboxEnabled: undefined,
        },
        restoreTarget: request.initial?.entries[request.initial.index],
        addressFailure: undefined,
        addressRevision: 0,
      }
      let view: BrowserView = { status: 'idle', sequence: -1 }
      let timer: ReturnType<typeof setTimeout> | undefined
      let mounted = false
      let disposed = false
      let issue: string | undefined
      let queue = Promise.resolve()
      const screen = document.createElement('div')
      screen.className = 'dsh-agent-browser-page'
      const image = document.createElement('img')
      image.draggable = false
      image.alt = text().screen
      image.hidden = true
      const keyboard = document.createElement('textarea')
      keyboard.className = 'dsh-agent-browser-keyboard'
      keyboard.setAttribute('aria-label', text().screen)
      keyboard.autocomplete = 'off'
      keyboard.spellcheck = false
      screen.append(image, keyboard)

      const publish = (next: BrowserControllerState) => {
        state = next
        for (const listener of listeners) listener()
      }
      const failure = (error: unknown) => {
        const code = error instanceof Error ? error.message : 'connection_error'
        issue = code
        const copy = text()
        const description = copy[code as keyof typeof copy] ?? copy.command_failed
        publish({ ...state, frame: { ...state.frame, loading: false, error: { code: 1, description } } })
      }
      const command = (action: string, value?: unknown) => {
        queue = queue
          .then(async () => {
            if (disposed) return
            await call(tabId, action, value)
            issue = undefined
          })
          .catch(failure)
        return queue
      }
      const targetOf = (value: string, title?: string): BrowserTarget | undefined => {
        try {
          const url = new URL(value)
          if (!['http:', 'https:'].includes(url.protocol)) return
          return { kind: url.protocol === 'https:' ? 'https' : 'http', url: url.href, title: title || url.hostname }
        } catch {
          return
        }
      }
      const loadUrl = (value: string) => {
        let url: URL
        try {
          url = new URL(value.includes('://') ? value : `https://${value}`)
        } catch {
          publish({ ...state, addressFailure: value.trim() ? 'invalid' : 'empty' })
          return
        }
        const reason = !['http:', 'https:'].includes(url.protocol)
          ? 'protocol'
          : url.username || url.password
            ? 'credentials'
            : url.origin === request.applicationOrigin
              ? 'application-origin'
              : undefined
        if (reason) {
          publish({ ...state, addressFailure: reason })
          return
        }
        const target = targetOf(url.href)!
        publish({
          ...state,
          restoreTarget: undefined,
          addressFailure: undefined,
          addressRevision: state.addressRevision + 1,
          frame: { ...state.frame, target, address: 'requested', loading: true, error: undefined },
        })
        void command('open', target.url)
      }
      const modifiers = (event: MouseEvent | KeyboardEvent) =>
        (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
      const mouse = (event: MouseEvent, eventType: string) => {
        if (image.hidden || !view.width || !view.height) return
        const rect = image.getBoundingClientRect()
        void command('input', {
          type: 'input_mouse',
          eventType,
          x: ((event.clientX - rect.left) * view.width) / rect.width,
          y: ((event.clientY - rect.top) * view.height) / rect.height,
          button: ['left', 'middle', 'right'][event.button] ?? 'none',
          clickCount: event.detail || 1,
          modifiers: modifiers(event),
          ...(event instanceof WheelEvent ? { deltaX: event.deltaX, deltaY: event.deltaY } : {}),
        })
      }
      let movedAt = 0
      screen.addEventListener('pointermove', (event) => {
        if (Date.now() - movedAt < 50) return
        movedAt = Date.now()
        mouse(event, 'mouseMoved')
      })
      screen.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        keyboard.focus({ preventScroll: true })
        screen.setPointerCapture(event.pointerId)
        mouse(event, 'mousePressed')
      })
      screen.addEventListener('pointerup', (event) => {
        mouse(event, 'mouseReleased')
        screen.releasePointerCapture(event.pointerId)
      })
      screen.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault()
          mouse(event, 'mouseWheel')
        },
        { passive: false }
      )
      screen.addEventListener('contextmenu', (event) => event.preventDefault())
      keyboard.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (
          event.isComposing ||
          (event.key.length === 1 && !event.ctrlKey && !event.metaKey) ||
          ((event.ctrlKey || event.metaKey) && event.key === 'v')
        )
          return
        event.preventDefault()
        void command('input', {
          type: 'input_keyboard',
          eventType: 'keyDown',
          key: event.key,
          code: event.code,
          modifiers: modifiers(event),
          windowsVirtualKeyCode: event.keyCode,
        })
      })
      keyboard.addEventListener('keyup', (event) => {
        event.stopPropagation()
        if (!event.isComposing)
          void command('input', {
            type: 'input_keyboard',
            eventType: 'keyUp',
            key: event.key,
            code: event.code,
            modifiers: modifiers(event),
            windowsVirtualKeyCode: event.keyCode,
          })
      })
      const insert = (value: string) => {
        if (value) void command('input', { type: 'input_keyboard', eventType: 'keyDown', key: '', text: value })
        keyboard.value = ''
      }
      keyboard.addEventListener('input', (event) => {
        if (!(event as InputEvent).isComposing) insert(keyboard.value)
      })
      keyboard.addEventListener('compositionend', () => insert(keyboard.value))

      const refresh = async () => {
        try {
          await activate(tabId)
          const result = await connection.rpc.call('/api', method, { sessionId, tabId, sequence: view.sequence })
          if (!mounted || disposed) return
          if (!result.ok) throw new Error('connection_error')
          const next = result.value as BrowserView
          image.alt = text().screen
          keyboard.setAttribute('aria-label', text().screen)
          view = { ...next, image: next.image ?? (next.status === 'live' ? view.image : undefined) }
          if (next.image) image.src = `data:image/jpeg;base64,${next.image}`
          image.hidden = !view.image || view.status !== 'live'
          const target = view.url ? targetOf(view.url, view.title) : state.frame.target
          const changed = target?.url !== state.frame.target?.url || target?.title !== state.frame.target?.title
          publish({
            ...state,
            restoreTarget: view.status === 'idle' ? state.restoreTarget : view.status === 'closed' ? target : undefined,
            addressRevision: state.addressRevision + (changed ? 1 : 0),
            frame: {
              ...state.frame,
              target,
              address: target ? 'observed' : 'empty',
              loading: view.status === 'starting',
              canGoBack: !!view.canGoBack,
              canGoForward: !!view.canGoForward,
              error:
                view.error || issue
                  ? {
                      code: 1,
                      description:
                        text()[(view.error ?? issue) as keyof ReturnType<typeof text>] ?? text().command_failed,
                    }
                  : undefined,
            },
          })
          if (target && changed)
            actions.replace(tabId, {
              entries: [target],
              index: 0,
              request: { revision: state.addressRevision, target },
              navigation: { status: 'known', revision: state.addressRevision },
              failure: undefined,
            })
          if (view.status === 'live') {
            const width = Math.max(100, Math.min(3840, Math.round(screen.clientWidth)))
            const height = Math.max(100, Math.min(2160, Math.round(screen.clientHeight)))
            if (view.width !== width || view.height !== height) {
              queue = queue.then(async () => {
                if (!mounted || disposed) return
                try {
                  await call(tabId, 'resize', { width, height })
                } catch {
                  /* retry after the active command */
                }
              })
              await queue
            }
          }
        } catch (error) {
          if (mounted && !disposed) failure(error)
        }
        if (mounted && !disposed) timer = setTimeout(refresh, document.hidden ? 2000 : 250)
      }
      const restore = () => {
        if (state.restoreTarget) loadUrl(state.restoreTarget.url)
      }
      const dispose = async () => {
        if (disposed) return
        disposed = true
        mounted = false
        clearTimeout(timer)
        screen.remove()
        listeners.clear()
        await queue
        await call(tabId, 'close').catch(() => {})
        tabs.delete(tabId)
      }
      return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        loadUrl,
        restore,
        dispose,
        goBack: () => {
          void command('back')
        },
        goForward: () => {
          void command('forward')
        },
        reload: () => {
          if (state.restoreTarget) restore()
          else void command('reload')
        },
        mount: (viewportId: string) => {
          document.getElementById(viewportId)?.append(screen)
          mounted = true
          clearTimeout(timer)
          void refresh()
          return () => {
            mounted = false
            clearTimeout(timer)
            screen.remove()
          }
        },
      }
    }
    const unsubscribe = ctx.sidebarRight.openTabs.subscribe(() => {
      const open = ctx.sidebarRight.openTabs.getSnapshot()
      for (const [tabId, tab] of tabs) {
        if (!open.some((item) => item.sessionId === sessionId && item.tabId === tabId)) {
          actions.forget(tabId)
          void tab.dispose()
        }
      }
    })
    return {
      keyedHooks: { browserState: (tabId) => tabs.get(tabId) },
      mount(request) {
        let tab = tabs.get(request.tabId)
        const created = !tab
        if (!tab) {
          tab = createTab(request)
          tabs.set(request.tabId, tab)
        }
        const hide = tab.mount(request.viewportId)
        if (created && request.initialUrl) tab.loadUrl(request.initialUrl)
        return hide
      },
      rebind: (next) => {
        actions = next
      },
      dispose: async () => {
        unsubscribe()
        await Promise.all([...tabs.values()].map((tab) => tab.dispose()))
      },
      loadUrl: (id, value) => tabs.get(id)?.loadUrl(value),
      restore: (id) => tabs.get(id)?.restore(),
      goBack: (id) => tabs.get(id)?.goBack(),
      goForward: (id) => tabs.get(id)?.goForward(),
      reload: (id) => tabs.get(id)?.reload(),
      setSandbox: () => {},
    }
  }

  ctx.slots.inject(browserSlot, () => {
    let original: StoredEntry | undefined
    let dispose: (() => void) | undefined
    const sync = () => {
      const entry = ctx.slots
        .entries(browserSlot)
        .find((candidate) => candidate.options.key === browserId && (candidate.options.priority ?? 0) === 0)
      if (entry === original) return
      dispose?.()
      dispose = undefined
      original = entry
      if (!entry) return
      dispose = ctx.slots.register(
        {
          name: browserSlot,
          key: browserId,
          priority: -100,
          store: entry.store,
          locale: entry.locale as 'sidebarBrowser',
          inject: (sessionId: string, actions: Actions) => {
            let controller = controllers.get(sessionId)
            if (!controller) {
              controller = createControllers(sessionId, actions)
              controllers.set(sessionId, controller)
            } else controller.rebind(actions)
            return controller
          },
        },
        entry.component as SlotComponent<unknown>
      )
    }
    const unsubscribe = ctx.slots.subscribe(browserSlot, sync)
    sync()
    return () => {
      unsubscribe()
      dispose?.()
    }
  })
  ctx.effect(() => async () => {
    await Promise.all([...controllers.values()].map((controller) => controller.dispose()))
    controllers.clear()
  })
  ctx.effect(() =>
    installStyles(`
.dsh-agent-browser-page { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; }
.dsh-agent-browser-page img { width: 100%; height: 100%; display: block; user-select: none; }
.dsh-agent-browser-page img[hidden] { display: none; }
.dsh-agent-browser-keyboard { position: absolute; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; padding: 0; border: 0; }
`)
  )
}
