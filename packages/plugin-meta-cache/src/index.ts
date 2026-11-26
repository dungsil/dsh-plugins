/**
 * Plugins 페이지 API의 메타데이터 읽기 비용을 줄이는 Host 행.
 *
 * 업스트림 `pluginPackages.metaOf`는 호출마다 파일을 읽고, 인벤토리 한 번이 수백 번 부른다.
 * 공개 계약은 없지만 서비스 인스턴스의 메서드를 런타임에 감싸는 것이 가능하므로(rung 3)
 * 업스트림을 패치하지 않고 이 행이 stale-while-revalidate 캐시를 씌운다. 메타데이터는
 * 표시 전용이라 한 번 뒤처진 값은 허용한다.
 */
import { installMetaCache } from './cache.js'
import type { MetaCache, MetaKey, PluginPackagesLike } from './cache.js'

export const name = 'dungsil-plugin-meta-cache'

/** 기동 직후에는 다른 활성화가 끝나도록 예열을 미루는 시간(ms). */
const PREWARM_START_DELAY_MS = 1500

/** 조합이 바뀐 직후 예열을 다시 시작하기까지 모으는 시간(ms). */
const PREWARM_RESTART_DELAY_MS = 500

/** 조합·해석이 바뀌었음을 알리는 이벤트. 이 중 무엇이 와도 전체를 버린다(최선 노력). */
const INVALIDATING_EVENTS = ['plugin-manager/changed', 'app-boot/config-reload', 'hmr/change', 'hmr/reload'] as const

type Disposer = () => void

interface LoaderEntryLike {
  readonly options: { readonly group?: unknown; readonly name?: unknown }
  readonly parent?: { readonly tree?: { readonly ctx?: { readonly baseUrl?: unknown } } }
}

interface LoaderLike {
  readonly entries: () => Iterable<LoaderEntryLike>
}

interface AgentPresetsLike {
  readonly compositionInventory: () => Promise<readonly { readonly rows: readonly { readonly moduleName: string }[] }[]>
}

/** 이 행이 쓰는 컨텍스트 표면이다. 서비스는 모두 `get`으로 선택 조회해 없으면 건너뛴다. */
export interface MetaCacheContext {
  readonly baseUrl?: unknown
  readonly effect: (callback: () => Disposer | undefined) => void
  readonly get: (service: string) => unknown
  readonly on: (event: string, listener: () => void) => Disposer
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const hasMethod = (value: unknown, method: string): boolean => isRecord(value) && typeof value[method] === 'function'

/** 인벤토리가 읽는 것과 같은 키를 모은다. 키가 어긋나면 예열은 아무도 읽지 않는 항목만 채운다. */
const collectKeys = async (ctx: MetaCacheContext): Promise<MetaKey[]> => {
  const keys: MetaKey[] = []
  const loader = ctx.get('loader')
  if (hasMethod(loader, 'entries')) {
    for (const entry of (loader as LoaderLike).entries()) {
      const specifier = entry.options.name
      const parentURL = entry.parent?.tree?.ctx?.baseUrl
      if (entry.options.group === undefined && typeof specifier === 'string' && typeof parentURL === 'string') {
        keys.push({ parentURL, specifier })
      }
    }
  }
  const presets = ctx.get('agentPresets')
  if (hasMethod(presets, 'compositionInventory') && typeof ctx.baseUrl === 'string') {
    const { baseUrl } = ctx
    for (const composition of await (presets as AgentPresetsLike).compositionInventory()) {
      for (const row of composition.rows) {
        keys.push({ parentURL: baseUrl, specifier: row.moduleName })
      }
    }
  }
  return keys
}

/** `pluginPackages.metaOf`에 캐시를 씌우고 기동 뒤 한가할 때 미리 채운다. */
export const apply = (ctx: MetaCacheContext): void => {
  const service = ctx.get('pluginPackages')
  if (!isRecord(service)) return

  ctx.effect(() => {
    const cache: MetaCache = installMetaCache(service satisfies PluginPackagesLike)
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const runPrewarm = async (): Promise<void> => {
      try {
        const keys = await collectKeys(ctx)
        if (!stopped) await cache.prewarm(keys)
      } catch {
        // 예열은 최적화다. 키를 모으다 실패해도 읽기는 원본으로 정상 동작한다.
      }
    }

    const schedulePrewarm = (delay: number): void => {
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        void runPrewarm()
      }, delay)
      timer.unref()
    }

    const listeners = INVALIDATING_EVENTS.map((event) =>
      ctx.on(event, () => {
        cache.drop()
        schedulePrewarm(PREWARM_RESTART_DELAY_MS)
      })
    )
    schedulePrewarm(PREWARM_START_DELAY_MS)

    return () => {
      stopped = true
      clearTimeout(timer)
      for (const dispose of listeners) dispose()
      cache.dispose()
    }
  })
}
