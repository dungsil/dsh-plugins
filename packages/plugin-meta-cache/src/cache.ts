import { setTimeout as sleep } from 'node:timers/promises'

/** 감쌀 서비스의 최소 표면. 실제 `PluginPackages`가 이 모양이다. */
export interface PluginPackagesLike {
  /** 현재 런타임 해석 객체. 세대가 바뀌면 객체 정체성이 바뀐다. */
  readonly resolution?: unknown
}

/** 캐시 키를 이루는 호출 인자 한 쌍이다. */
export interface MetaKey {
  readonly parentURL: string
  readonly specifier: string
}

/** 캐시 동작을 조절하는 값. 테스트는 시계와 양보 함수를 바꿔 끼운다. */
export interface MetaCacheOptions {
  readonly capacity?: number
  readonly sliceMs?: number
  readonly revalidateIntervalMs?: number
  readonly now?: () => number
  readonly yieldToLoop?: () => Promise<void>
}

/** 설치된 캐시의 조작 면이다. */
export interface MetaCache {
  readonly drop: () => void
  readonly dispose: () => void
  readonly prewarm: (keys: readonly MetaKey[]) => Promise<void>
  readonly size: () => number
}

interface Entry {
  checkedAt: number
  json: string | null
}

const DEFAULT_CAPACITY = 4000
const DEFAULT_SLICE_MS = 8
const DEFAULT_REVALIDATE_INTERVAL_MS = 2000

type MetaOf = (specifier: string, parentURL: string) => unknown

const keyOf = ({ parentURL, specifier }: MetaKey): string => `${parentURL}\u0000${specifier}`

// 정지 중인 프로세스를 대기만으로 붙잡지 않도록 타이머를 `ref: false`로 둔다.
const defaultYield = async (): Promise<void> => {
  await sleep(0, null, { ref: false })
}

const ownMetaOf = (target: object): unknown => {
  const descriptor: PropertyDescriptor | undefined = Reflect.getOwnPropertyDescriptor(target, 'metaOf')
  return descriptor?.value
}

/** 서비스에서 원본 `metaOf`를 프록시 없이 꺼낸다. 이미 덮어쓴 것이 있으면 그것이 원본이다. */
const findOriginal = (service: object): MetaOf | undefined => {
  let found: unknown = ownMetaOf(service)
  let proto = Reflect.getPrototypeOf(service)
  while (found === undefined && proto !== null) {
    found = ownMetaOf(proto)
    proto = Reflect.getPrototypeOf(proto)
  }
  if (typeof found !== 'function') return undefined
  return (specifier, parentURL) => Reflect.apply(found, service, [specifier, parentURL])
}

/** 결과를 JSON 문자열로 굳힌다. `null`은 원본이 `undefined`를 돌려줬다는 뜻이다. */
const serialize = (value: unknown): string | null => {
  if (value === undefined) return null
  const json: string | undefined = JSON.stringify(value)
  if (json === undefined) throw new TypeError('plugin metadata is not JSON-serializable')
  return json
}

const noop = (): void => {
  // 감쌀 것이 없을 때 조작 면이 아무 일도 하지 않는 자리다.
}

const inertCache: MetaCache = {
  dispose: noop,
  drop: noop,
  prewarm: async () => {
    await Promise.resolve()
  },
  size: () => 0,
}

/**
 * `service.metaOf`를 stale-while-revalidate 캐시로 감싼다.
 * @param service - `pluginPackages` 서비스 인스턴스.
 * @param options - 용량·조각 시간·재읽기 간격과 테스트용 시계.
 */
export const installMetaCache = (service: PluginPackagesLike, options: MetaCacheOptions = {}): MetaCache => {
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  const sliceMs = options.sliceMs ?? DEFAULT_SLICE_MS
  const revalidateIntervalMs = options.revalidateIntervalMs ?? DEFAULT_REVALIDATE_INTERVAL_MS
  const now = options.now ?? ((): number => performance.now())
  const yieldToLoop = options.yieldToLoop ?? defaultYield

  const original = findOriginal(service)
  if (original === undefined) return inertCache
  const hadOwn = Object.getOwnPropertyDescriptor(service, 'metaOf')

  const entries = new Map<string, Entry>()
  const pending = new Map<string, MetaKey>()
  let generation = 0
  let resolution: unknown = service.resolution
  let disposed = false
  let pumping = false

  const drop = (): void => {
    generation += 1
    entries.clear()
    pending.clear()
  }

  /** 해석 세대가 바뀌었으면 이전 세대의 결과를 모두 버린다. */
  const syncResolution = (): void => {
    const current = service.resolution
    if (current !== resolution) {
      resolution = current
      drop()
    }
  }

  const remember = (key: string, json: string | null): void => {
    entries.delete(key)
    entries.set(key, { checkedAt: now(), json })
    while (entries.size > capacity) {
      const oldest = entries.keys().next()
      if (oldest.done === true) break
      entries.delete(oldest.value)
    }
  }

  /** 대기열 항목 하나를 다시 읽는다. 내용이 같으면 시각만 갱신한다. */
  const revalidate = (item: MetaKey): void => {
    const key = keyOf(item)
    const previous = entries.get(key)
    if (previous === undefined) return
    try {
      const json = serialize(original(item.specifier, item.parentURL))
      if (json === previous.json) {
        previous.checkedAt = now()
        return
      }
      remember(key, json)
    } catch {
      // 재읽기 실패는 이전 값을 그대로 둔다. 다음 읽기가 다시 시도한다.
    }
  }

  const takeNext = (): MetaKey | undefined => {
    const first = pending.entries().next()
    if (first.done === true) return undefined
    pending.delete(first.value[0])
    return first.value[1]
  }

  /** 대기열을 `sliceMs` 조각으로 나눠 비운다. 조각 사이에 루프에 양보한다. */
  const pump = async (): Promise<void> => {
    try {
      await yieldToLoop()
      // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- `dispose`가 다른 호출에서 바꾼다.
      while (!disposed && pending.size > 0) {
        const sliceStart = now()
        for (let item = takeNext(); item !== undefined; item = takeNext()) {
          revalidate(item)
          if (now() - sliceStart >= sliceMs) break
        }
        if (pending.size > 0) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- 조각 사이에 순서대로 루프에 양보한다.
          await yieldToLoop()
        }
      }
    } finally {
      pumping = false
    }
  }

  const scheduleRevalidation = (key: string, entry: Entry, item: MetaKey): void => {
    if (pending.has(key) || now() - entry.checkedAt < revalidateIntervalMs) return
    pending.set(key, item)
    if (!pumping) {
      pumping = true
      void pump()
    }
  }

  const decode = (entry: Entry): unknown => (entry.json === null ? undefined : JSON.parse(entry.json))

  const wrapper = function wrapper(specifier: string, parentURL: string): unknown {
    const item: MetaKey = { parentURL, specifier }
    const key = keyOf(item)
    try {
      syncResolution()
      const entry = entries.get(key)
      if (entry !== undefined) {
        entries.delete(key)
        entries.set(key, entry)
        const value = decode(entry)
        scheduleRevalidation(key, entry, item)
        return value
      }
    } catch {
      return original(specifier, parentURL)
    }
    const value = original(specifier, parentURL)
    try {
      remember(key, serialize(value))
    } catch {
      // 저장 실패는 다음 호출이 다시 원본을 읽을 뿐이다.
    }
    return value
  }

  Object.defineProperty(service, 'metaOf', {
    configurable: true,
    enumerable: false,
    value: wrapper,
    writable: true,
  })

  const prewarm = async (keys: readonly MetaKey[]): Promise<void> => {
    const startedGeneration = generation
    let index = 0
    // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- 양보하는 사이 `disposed`와 `generation`이 바뀐다.
    while (!disposed && generation === startedGeneration && index < keys.length) {
      const sliceStart = now()
      while (index < keys.length && now() - sliceStart < sliceMs) {
        const item = keys[index]
        index += 1
        if (item === undefined || entries.has(keyOf(item))) continue
        try {
          syncResolution()
          remember(keyOf(item), serialize(original(item.specifier, item.parentURL)))
        } catch {
          // 한 항목이 실패해도 나머지는 계속 채운다.
        }
        if (generation !== startedGeneration) return
      }
      if (index < keys.length) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 조각 사이에 순서대로 루프에 양보한다.
        await yieldToLoop()
      }
    }
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    drop()
    // 다른 플러그인이 같은 속성을 다시 덮어썼다면 그 값을 건드리지 않는다.
    if (Object.getOwnPropertyDescriptor(service, 'metaOf')?.value !== wrapper) return
    if (hadOwn === undefined) {
      Reflect.deleteProperty(service, 'metaOf')
    } else {
      Object.defineProperty(service, 'metaOf', hadOwn)
    }
  }

  return { dispose, drop, prewarm, size: () => entries.size }
}
