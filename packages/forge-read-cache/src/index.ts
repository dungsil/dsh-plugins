import type { Context } from '@deepseek-ai/cordis'
import type { ChangeRequestRef, ForgeReadiness, ForgeRepository } from '@deepseek-ai/dsh-experimental-forge'

import { RepositoryReads } from './repository-reads.js'

export const name = 'dungsil-forge-read-cache'

export const inject = ['forge'] as const

/** 이 플러그인이 감싸는 두 읽기만 담는다. 나머지 forge 서비스 API는 손대지 않는다. */
interface ReadService {
  readiness: (repository: ForgeRepository, signal: AbortSignal) => Promise<ForgeReadiness>
  findByHead: (repository: ForgeRepository, branch: string, signal: AbortSignal) => Promise<readonly ChangeRequestRef[]>
}

/**
 * 세션마다 반복되는 로그인 확인과 브랜치 조회를 서비스 경계에서 합친다.
 *
 * 두 읽기는 세션이 아니라 호스트 또는 저장소와 브랜치에만 달려 있으므로 같은 답을 공유해도 된다.
 * 패널이 `ctx.forge`로 부르는 경로를 감싸면 공급자 등록 순서와 무관하게 모든 소비자가 함께 읽는다.
 * 상태·체크·상세는 각자의 폴링과 이벤트가 최신성을 책임지므로 캐시에 넣지 않는다.
 */
export function apply(ctx: Context): void {
  // `ctx.forge`의 추적 프록시가 아니라 공유 인스턴스를 감싸야 다른 소비자의 호출에도 적용된다.
  const forge = ctx.reflect.get('forge', false) as ReadService
  const originalReadiness = forge.readiness
  const originalFindByHead = forge.findByHead
  const lifetime = new AbortController()
  const reads = new RepositoryReads(lifetime.signal)

  forge.readiness = (repository, signal) =>
    reads.readiness(
      repository.forge,
      repository.host,
      async (inner) => await Reflect.apply(originalReadiness, forge, [repository, inner]),
      signal
    )
  forge.findByHead = (repository, branch, signal) =>
    reads.findByHead(
      repository.forge,
      repository,
      branch,
      async (inner) => await Reflect.apply(originalFindByHead, forge, [repository, branch, inner]),
      signal
    )

  // 공급자가 바뀌면 캐시가 준 답이 새 공급자의 답과 다를 수 있으므로 함께 비운다.
  ctx.on('forge/providers-changed', () => reads.clear())
  ctx.effect(() => () => {
    forge.readiness = originalReadiness
    forge.findByHead = originalFindByHead
    lifetime.abort()
  })
}
