/**
 * 호스트·저장소 단위로 답이 같은 forge 읽기를 세션 사이에서 공유한다.
 *
 * 세션마다 서는 패널이 로그인 확인과 브랜치 조회를 각자 실행해 같은 저장소의 세션 수만큼 CLI가
 * 떴다. 값이 움직이는 읽기(변경 요청 상태·체크아웃 사실·상세)는 넣지 않는다. 각자의 폴링과
 * 이벤트가 최신성을 책임진다.
 */

import type { ChangeRequestRef, ForgeReadiness, ForgeRepository } from '@deepseek-ai/dsh-experimental-forge'

/** 성공한 로그인 확인을 신뢰하는 시간. 호스트의 로그인은 사용자가 바꾸기 전까지 그대로다. */
export const READY_TTL_MS = 30_000

/**
 * 로그인이 필요하다는 답을 다시 확인하기까지의 시간. 패널은 이 답을 보여 주고 사용자는 그 자리에서
 * 로그인하므로, 실패를 길게 캐시하면 로그인한 뒤에도 한동안 같은 안내가 남는다.
 */
export const UNREADY_TTL_MS = 5_000

/**
 * 브랜치의 열린 변경 요청 조회를 신뢰하는 시간. 우리 경로로 만드는 변경 요청은 Session 바인딩을
 * 직접 기록하므로 이 지연이 게시 결과를 늦추지 않고, 다른 곳에서 만든 요청만 이만큼 늦게 보인다.
 */
export const BRANCH_TTL_MS = 10_000

/** 캐시 항목 상한. 넘으면 가장 오래 쓰지 않은 항목부터 버린다. */
export const MAX_CACHE_ENTRIES = 512

interface Cached {
  readonly until: number
  readonly value: unknown
}

/** 진행 중인 공유 읽기. `users`가 0이 되면 실행도 멈춘다. */
interface Pending {
  readonly controller: AbortController
  readonly promise: Promise<unknown>
  users: number
}

/** 실행 결과를 기다리는 호출자에게 돌려줄 약속과 그 결과를 정하는 손잡이. */
interface Settlement<Value> {
  readonly promise: Promise<Value>
  readonly reject: (reason?: unknown) => void
  readonly resolve: (value: Value) => void
}

/** `RepositoryReads`가 시간을 읽는 방법. 테스트가 시계를 옮길 때만 준다. */
export interface RepositoryReadsOptions {
  readonly now?: () => number
}

/**
 * 저장소 단위 읽기의 TTL 캐시와 동시 실행 합치기다. 같은 키의 읽기가 진행 중이면 새로 실행하지
 * 않고 그 결과를 함께 기다리며, 한 호출자의 취소는 그 호출자만 떠나게 한다.
 */
export class RepositoryReads {
  private readonly cached = new Map<string, Cached>()
  private readonly pending = new Map<string, Pending>()
  private readonly now: () => number
  private readonly lifetime: AbortSignal
  /** 캐시를 비우거나 한 호스트를 잊은 횟수. 진행 중이던 읽기의 옛 답을 다시 캐시하지 않게 한다. */
  private version = 0

  /**
   * @param lifetime 서비스 수명 신호. 취소되면 진행 중인 모든 공유 읽기가 멈춘다.
   * @param options 현재 시각을 읽는 함수. 테스트 전용이다.
   */
  constructor(lifetime: AbortSignal, options: RepositoryReadsOptions = {}) {
    this.lifetime = lifetime
    this.now = options.now ?? Date.now
  }

  /**
   * 호스트의 로그인 확인을 공유한다. 성공과 실패의 신뢰 시간이 다르다.
   * @param family 공급자 계열. 같은 호스트라도 계열이 다르면 다른 답이다.
   * @param host 확인할 호스트 이름.
   * @param run 실제 확인. 공유 실행의 신호를 받는다.
   * @param signal 호출자의 취소 신호.
   * @returns 공급자가 보고한 로그인 상태.
   */
  async readiness(
    family: string,
    host: string,
    run: (signal: AbortSignal) => Promise<ForgeReadiness>,
    signal: AbortSignal
  ): Promise<ForgeReadiness> {
    const key = `login:${family}:${host.toLowerCase()}`
    return await this.share(
      key,
      async (inner) => {
        const value = await run(inner)
        return { ttl: value.state === 'ready' ? READY_TTL_MS : UNREADY_TTL_MS, value }
      },
      signal
    )
  }

  /**
   * 저장소에서 브랜치를 head로 하는 열린 변경 요청 조회를 공유한다. 브랜치 이름은 Git 규칙대로
   * 대소문자를 구분하고, 저장소 이름은 호스트가 비교하는 방식대로 구분하지 않는다. 계열마다
   * 공급자가 따로 있으므로 계열도 키에 넣는다. 캐시가 다른 계열의 검증을 대신하면 안 된다.
   * @param family 공급자 계열.
   * @param repository 조회할 저장소.
   * @param branch head로 찾을 브랜치.
   * @param run 실제 조회. 공유 실행의 신호를 받는다.
   * @param signal 호출자의 취소 신호.
   * @returns 열린 변경 요청 참조 목록.
   */
  async findByHead(
    family: string,
    repository: ForgeRepository,
    branch: string,
    run: (signal: AbortSignal) => Promise<readonly ChangeRequestRef[]>,
    signal: AbortSignal
  ): Promise<readonly ChangeRequestRef[]> {
    const key = `head:${family}:${repositoryKeyOf(repository)}\n${branch}`
    return await this.share(key, async (inner) => ({ ttl: BRANCH_TTL_MS, value: await run(inner) }), signal)
  }

  /** 캐시와 진행 중인 공유 읽기를 모두 버린다. 공급자 구성이 바뀌면 답이 달라질 수 있다. */
  clear(): void {
    this.version += 1
    this.cached.clear()
    for (const pending of this.pending.values()) {
      pending.controller.abort(new Error('Repository reads were cleared'))
    }
    this.pending.clear()
  }

  /**
   * 한 호스트의 로그인 확인 캐시와 진행 표를 버린다. 새 공급자가 그 호스트를 맡으면
   * 미구성 공급자가 준 답은 더 이상 유효하지 않다. 이미 기다리는 호출자는 그 실행의 결과를 끝까지
   * 받지만, 잊은 뒤에 온 호출은 옛 실행에 합류하지 않고 새 공급자로 읽는다.
   * @param host 잊을 호스트 이름.
   */
  forgetHost(host: string): void {
    const suffix = `:${host.toLowerCase()}`
    const forgotten = (key: string): boolean => key.startsWith('login:') && key.endsWith(suffix)
    this.version += 1
    for (const key of this.cached.keys()) {
      if (forgotten(key)) {
        this.cached.delete(key)
      }
    }
    // 실행은 중단하지 않는다. 기다리던 호출자는 약속 참조를 쥐고 있으므로 결과를 그대로 받는다.
    for (const key of this.pending.keys()) {
      if (forgotten(key)) {
        this.pending.delete(key)
      }
    }
  }

  /** 캐시에 있으면 그 값을, 없으면 공유 실행을 만들어 그 결과를 돌려준다. */
  private async share<Value>(
    key: string,
    run: (signal: AbortSignal) => Promise<{ readonly ttl: number; readonly value: Value }>,
    signal: AbortSignal
  ): Promise<Value> {
    signal.throwIfAborted()
    this.lifetime.throwIfAborted()
    const cached = this.cached.get(key)
    if (cached !== undefined) {
      if (cached.until > this.now()) {
        // 최근에 쓰인 항목을 뒤로 보내 상한에 걸릴 때 오래된 것부터 버리게 한다.
        this.cached.delete(key)
        this.cached.set(key, cached)
        return cached.value as Value
      }
      this.cached.delete(key)
    }
    // 마지막 호출자가 떠나 취소된 실행은 새 호출자에게 주지 않는다. 그 사이 자식이 아직 살아 있을 수 있다.
    let pending: Pending | null = this.pending.get(key) ?? null
    if (pending?.controller.signal.aborted === true) {
      this.pending.delete(key)
      pending = null
    }
    return await this.join(key, pending ?? this.start(key, run), signal)
  }

  /** 공유 실행 하나를 진행 표에 먼저 올리고 시작한다. 실패는 기다리는 호출자가 받는다. */
  private start<Value>(
    key: string,
    run: (signal: AbortSignal) => Promise<{ readonly ttl: number; readonly value: Value }>
  ): Pending {
    const controller = new AbortController()
    const operation = AbortSignal.any([controller.signal, this.lifetime])
    const settlement = Promise.withResolvers<Value>()
    const pending: Pending = { controller, promise: settlement.promise, users: 0 }
    // 실행보다 등록이 먼저다. run이 동기적으로 던져도 실패한 항목이 진행 표에 남지 않는다.
    this.pending.set(key, pending)
    void this.read(key, controller, operation, settlement, run)
    // 기다리는 호출자가 모두 떠난 실행의 실패도 처리되지 않은 거부 경고를 내지 않게 한다.
    settlement.promise.catch(() => {
      // 실패는 그때 기다리던 호출자가 받는다.
    })
    return pending
  }

  /**
   * 공유 실행 하나를 실제로 읽고 결과를 약속에 넘긴다. 진행 표에서의 제거는 여기서 끝내고,
   * 잊힌 사이에 끝난 읽기는 캐시하지 않는다.
   */
  private async read<Value>(
    key: string,
    controller: AbortController,
    operation: AbortSignal,
    settlement: Settlement<Value>,
    run: (signal: AbortSignal) => Promise<{ readonly ttl: number; readonly value: Value }>
  ): Promise<void> {
    const { version } = this
    try {
      const { ttl, value } = await run(operation)
      if (!operation.aborted && version === this.version) {
        this.remember(key, { until: this.now() + ttl, value })
      }
      settlement.resolve(value)
    } catch (error) {
      settlement.reject(error)
    } finally {
      if (this.pending.get(key)?.controller === controller) {
        this.pending.delete(key)
      }
    }
  }

  /**
   * 공유 실행의 결과를 기다린다. 호출자의 취소는 그 호출자만 떠나게 하고, 마지막 호출자가 떠나면
   * 공유 실행도 멈춘다. 남은 소비자 없는 CLI 자식을 붙들지 않는다. 취소한 실행은 표에서 먼저 빼
   * 새 호출자가 죽어 가는 실행에 합류하지 않게 한다.
   */
  private async join<Value>(key: string, pending: Pending, signal: AbortSignal): Promise<Value> {
    pending.users += 1
    try {
      return (await withAbort(pending.promise, signal)) as Value
    } finally {
      pending.users -= 1
      if (pending.users === 0) {
        if (this.pending.get(key) === pending) {
          this.pending.delete(key)
        }
        pending.controller.abort(new Error('Every caller of the repository read left'))
      }
    }
  }

  /** 값을 캐시에 넣고 상한을 넘은 항목을 오래된 순서로 버린다. */
  private remember(key: string, entry: Cached): void {
    this.cached.delete(key)
    this.cached.set(key, entry)
    while (this.cached.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cached.keys().next().value
      if (oldest === undefined) {
        return
      }
      this.cached.delete(oldest)
    }
  }
}

/** `changeRequestKey`와 같은 저장소 정체성이다: 호스트·소유자·이름은 대소문자를 구분하지 않는다. */
const repositoryKeyOf = (repository: ForgeRepository): string =>
  `${repository.forge}:${repository.host}/${repository.owner}/${repository.name}`.toLowerCase()

/** 신호가 취소되면 그 이유로 거부하고, 아니면 주어진 작업의 결과를 따른다. */
const withAbort = async <Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> => {
  if (signal.aborted) {
    throw signal.reason
  }
  const aborted = Promise.withResolvers<never>()
  const leave = (): void => {
    aborted.reject(signal.reason)
  }
  signal.addEventListener('abort', leave, { once: true })
  try {
    return await Promise.race([operation, aborted.promise])
  } finally {
    signal.removeEventListener('abort', leave)
  }
}
