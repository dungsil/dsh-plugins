import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  BRANCH_TTL_MS,
  MAX_CACHE_ENTRIES,
  READY_TTL_MS,
  RepositoryReads,
  UNREADY_TTL_MS,
} from '../src/repository-reads.ts'

const HOST = 'forge.example'
const OTHER_HOST = 'other.example'

const repositoryOf = (overrides = {}) => ({
  forge: 'forgejo',
  host: HOST,
  name: 'project',
  owner: 'team',
  ...overrides,
})

const READY = { message: null, signIn: null, state: 'ready' }
const SIGNED_OUT = {
  message: 'sign in first',
  signIn: { command: 'tea login add --url https://internal.example' },
  state: 'unauthenticated',
}
const UNAVAILABLE = { message: 'tea is not installed', signIn: null, state: 'unavailable' }

const HEAD_REFS = [{ number: 42, repository: repositoryOf() }]

/** 시계를 직접 옮기는 테스트용 시간. TTL 경계를 실제로 기다리지 않는다. */
const clockOf = () => {
  let now = 0
  return {
    advance: (ms) => {
      now += ms
    },
    now: () => now,
  }
}

/** 실행 횟수를 세는 로그인 확인. */
const probeOf = (value) => {
  let calls = 0
  return {
    calls: () => calls,
    run: async () => {
      calls += 1
      await Promise.resolve()
      return value
    },
  }
}

/** 실행 횟수를 세는 브랜치 조회. */
const lookupOf = () => {
  let calls = 0
  return {
    calls: () => calls,
    run: async () => {
      calls += 1
      await Promise.resolve()
      return HEAD_REFS
    },
  }
}

/** 취소될 때까지 기다렸다가 취소 이유로 거부하는 로그인 확인. */
const untilAbortedReadiness = async (signal) => {
  const gate = Promise.withResolvers()
  signal.addEventListener('abort', () => gate.reject(signal.reason), { once: true })
  return await gate.promise
}

/** 첫 실행은 게이트가 열릴 때까지 기다리고, 그 뒤 실행은 바로 준비된 답을 주는 로그인 확인. */
const stalledReadinessOf = (stalled) => {
  let calls = 0
  return {
    calls: () => calls,
    run: async () => {
      calls += 1
      if (calls === 1) {
        return await stalled
      }
      return READY
    },
  }
}

/** 브랜치별 실행 횟수를 세면서 읽는 조회. */
const branchReadsOf = (reads) => {
  const calls = new Map()
  return {
    calls,
    read: async (branch) => {
      await reads.findByHead(
        'forgejo',
        repositoryOf(),
        branch,
        async () => {
          calls.set(branch, (calls.get(branch) ?? 0) + 1)
          await Promise.resolve()
          return HEAD_REFS
        },
        new AbortController().signal
      )
    },
  }
}

/** 브랜치를 하나씩 읽어 캐시 삽입 순서를 고정한다. 상한 초과 시 버릴 항목이 순서에 달려 있다. */
const readInOrder = async (branches, read) => {
  const [next, ...rest] = branches
  if (next === undefined) {
    return
  }
  await read(next)
  await readInOrder(rest, read)
}

/** 0부터 세는 브랜치 이름 목록. 캐시 상한을 채우는 데 쓴다. */
const branchesOf = (count, prefix = 'feat') =>
  Array.from({ length: count }, (_value, index) => `${prefix}/${String(index)}`)

await describe('저장소 단위 읽기 공유', async () => {
  await it('같은 호스트의 로그인 확인은 한 번만 실행하고 결과를 나눠 쓴다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const probe = probeOf(READY)
    assert.deepEqual(await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal), READY)
    assert.deepEqual(
      await reads.readiness('forgejo', HOST.toUpperCase(), probe.run, new AbortController().signal),
      READY
    )
    assert.equal(probe.calls(), 1)
  })

  await it('성공한 로그인 확인은 신뢰 시간 동안 유지하고 그 뒤에는 다시 읽는다', async () => {
    const clock = clockOf()
    const reads = new RepositoryReads(new AbortController().signal, { now: clock.now })
    const probe = probeOf(READY)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    clock.advance(READY_TTL_MS)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    assert.equal(probe.calls(), 2)
    clock.advance(READY_TTL_MS - 1)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    assert.equal(probe.calls(), 2)
  })

  await it('로그인이 필요하다는 답은 짧게만 기억해 로그인 직후 다시 확인한다', async () => {
    const clock = clockOf()
    const reads = new RepositoryReads(new AbortController().signal, { now: clock.now })
    const probe = probeOf(SIGNED_OUT)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    clock.advance(UNREADY_TTL_MS + 1)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    assert.equal(probe.calls(), 2)
  })

  await it('도구를 쓸 수 없다는 답도 짧게만 기억한다', async () => {
    const clock = clockOf()
    const reads = new RepositoryReads(new AbortController().signal, { now: clock.now })
    const probe = probeOf(UNAVAILABLE)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    clock.advance(UNREADY_TTL_MS)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    assert.equal(probe.calls(), 2)
  })

  await it('계열이 다르면 같은 호스트라도 따로 읽는다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const probe = probeOf(READY)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    await reads.readiness('gitea', HOST, probe.run, new AbortController().signal)
    assert.equal(probe.calls(), 2)
  })

  await it('브랜치 조회는 계열·저장소·브랜치가 같을 때만 공유한다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const lookup = lookupOf()
    await reads.findByHead('forgejo', repositoryOf(), 'feat/shared', lookup.run, new AbortController().signal)
    await reads.findByHead(
      'forgejo',
      repositoryOf({ host: HOST.toUpperCase(), name: 'PROJECT', owner: 'TEAM' }),
      'feat/shared',
      lookup.run,
      new AbortController().signal
    )
    assert.equal(lookup.calls(), 1)
    await reads.findByHead('forgejo', repositoryOf(), 'feat/other', lookup.run, new AbortController().signal)
    assert.equal(lookup.calls(), 2)
    await reads.findByHead('gitea', repositoryOf(), 'feat/shared', lookup.run, new AbortController().signal)
    assert.equal(lookup.calls(), 3)
    await reads.findByHead('forgejo', repositoryOf(), 'feat/shared', lookup.run, new AbortController().signal)
    assert.equal(lookup.calls(), 3)
  })

  await it('브랜치 이름의 대소문자는 구분한다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const lookup = lookupOf()
    await reads.findByHead('forgejo', repositoryOf(), 'feat/shared', lookup.run, new AbortController().signal)
    await reads.findByHead('forgejo', repositoryOf(), 'feat/Shared', lookup.run, new AbortController().signal)
    assert.equal(lookup.calls(), 2)
  })

  await it('브랜치 조회는 신뢰 시간이 지나면 다시 읽는다', async () => {
    const clock = clockOf()
    const reads = new RepositoryReads(new AbortController().signal, { now: clock.now })
    const lookup = lookupOf()
    await reads.findByHead('forgejo', repositoryOf(), 'feat/shared', lookup.run, new AbortController().signal)
    clock.advance(BRANCH_TTL_MS + 1)
    await reads.findByHead('forgejo', repositoryOf(), 'feat/shared', lookup.run, new AbortController().signal)
    assert.equal(lookup.calls(), 2)
  })

  await it('동시에 온 같은 읽기는 한 번만 실행한다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const gate = Promise.withResolvers()
    let calls = 0
    const run = async () => {
      calls += 1
      return await gate.promise
    }
    const first = reads.readiness('forgejo', HOST, run, new AbortController().signal)
    const second = reads.readiness('forgejo', HOST, run, new AbortController().signal)
    assert.equal(calls, 1)
    gate.resolve(READY)
    assert.deepEqual(await first, READY)
    assert.deepEqual(await second, READY)
  })

  await it('한 호출자가 취소해도 남은 호출자의 읽기는 계속된다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const gate = Promise.withResolvers()
    const run = async () => await gate.promise
    const leaving = new AbortController()
    const staying = reads.readiness('forgejo', HOST, run, new AbortController().signal)
    const left = reads.readiness('forgejo', HOST, run, leaving.signal)
    leaving.abort(new Error('no longer needed'))
    await assert.rejects(left, /no longer needed/)
    gate.resolve(READY)
    assert.deepEqual(await staying, READY)
  })

  await it('마지막 호출자가 떠나면 공유 읽기도 취소한다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    let operation
    const run = async (signal) => {
      operation = signal
      const gate = Promise.withResolvers()
      signal.addEventListener('abort', () => gate.reject(signal.reason), { once: true })
      return await gate.promise
    }
    const caller = new AbortController()
    const pending = reads.readiness('forgejo', HOST, run, caller.signal)
    caller.abort(new Error('left'))
    await assert.rejects(pending, /left/)
    await Promise.resolve()
    assert.equal(operation?.aborted, true)
  })

  await it('마지막 호출자가 떠난 뒤 온 호출은 새 실행으로 성공한다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    // 취소 신호를 무시하고 살아 있는 CLI 자식을 흉내 낸다. 표에서 먼저 빠지지 않으면 새 호출이 이 실행에 합류한다.
    const stalled = Promise.withResolvers()
    const probe = stalledReadinessOf(stalled.promise)
    const leaving = new AbortController()
    const first = reads.readiness('forgejo', HOST, probe.run, leaving.signal)
    leaving.abort(new Error('left'))
    await assert.rejects(first, /left/)
    assert.deepEqual(await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal), READY)
    assert.equal(probe.calls(), 2)
    stalled.resolve(READY)
    await Promise.resolve()
  })

  await it('실패한 읽기는 기억하지 않는다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    let calls = 0
    const run = () => {
      calls += 1
      if (calls === 1) {
        return Promise.reject(new Error('the sign-in probe failed'))
      }
      return Promise.resolve(READY)
    }
    await assert.rejects(reads.readiness('forgejo', HOST, run, new AbortController().signal), /sign-in probe failed/)
    assert.deepEqual(await reads.readiness('forgejo', HOST, run, new AbortController().signal), READY)
    assert.equal(calls, 2)
  })

  await it('동기적으로 던지는 읽기도 다음 호출을 막지 않는다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    let calls = 0
    const run = () => {
      calls += 1
      if (calls === 1) {
        throw new Error('the provider threw before reading')
      }
      return Promise.resolve(READY)
    }
    await assert.rejects(reads.readiness('forgejo', HOST, run, new AbortController().signal), /provider threw/)
    assert.deepEqual(await reads.readiness('forgejo', HOST, run, new AbortController().signal), READY)
    assert.equal(calls, 2)
  })

  await it('캐시 상한을 넘으면 가장 오래 쓰지 않은 항목부터 버린다', async () => {
    const reads = new RepositoryReads(new AbortController().signal, { now: () => 0 })
    const { calls, read } = branchReadsOf(reads)
    await readInOrder(branchesOf(MAX_CACHE_ENTRIES), read)
    await read(`feat/${String(MAX_CACHE_ENTRIES)}`)
    await read('feat/1')
    assert.equal(calls.get('feat/1'), 1)
    await read('feat/0')
    assert.equal(calls.get('feat/0'), 2)
  })

  await it('캐시에서 읽은 항목은 최근으로 옮겨져 먼저 버려지지 않는다', async () => {
    const reads = new RepositoryReads(new AbortController().signal, { now: () => 0 })
    const { calls, read } = branchReadsOf(reads)
    await read('feat/old')
    await read('feat/keep')
    // 히트가 항목을 최근으로 옮기므로, 다음 상한 초과에서는 먼저 들어온 `feat/keep`이 버려진다.
    await read('feat/old')
    await readInOrder(branchesOf(MAX_CACHE_ENTRIES - 1, 'feat/fill'), read)
    await read('feat/old')
    assert.equal(calls.get('feat/old'), 1)
    await read('feat/keep')
    assert.equal(calls.get('feat/keep'), 2)
  })

  await it('clear는 캐시를 비우고 진행 중인 읽기를 취소한다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const probe = probeOf(READY)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    reads.clear()
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    assert.equal(probe.calls(), 2)

    const pendingReads = new RepositoryReads(new AbortController().signal)
    const pending = pendingReads.readiness('forgejo', HOST, untilAbortedReadiness, new AbortController().signal)
    pendingReads.clear()
    await assert.rejects(pending, /Repository reads were cleared/)
  })

  await it('수명이 끝나면 진행 중인 읽기를 취소한다', async () => {
    const lifetime = new AbortController()
    const reads = new RepositoryReads(lifetime.signal)
    const pending = reads.readiness('forgejo', HOST, untilAbortedReadiness, new AbortController().signal)
    lifetime.abort(new Error('service disposed'))
    await assert.rejects(pending, /service disposed/)
  })

  await it('수명이 끝난 뒤의 호출은 읽기를 시작하지 않는다', async () => {
    const lifetime = new AbortController()
    const reads = new RepositoryReads(lifetime.signal)
    lifetime.abort(new Error('service disposed'))
    let calls = 0
    const run = () => {
      calls += 1
      return Promise.resolve(READY)
    }
    await assert.rejects(reads.readiness('forgejo', HOST, run, new AbortController().signal), /service disposed/)
    assert.equal(calls, 0)
  })

  await it('forgetHost는 그 호스트의 로그인 캐시만 버린다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const probe = probeOf(READY)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    await reads.readiness('gitea', OTHER_HOST, probe.run, new AbortController().signal)
    reads.forgetHost(HOST)
    await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    await reads.readiness('gitea', OTHER_HOST, probe.run, new AbortController().signal)
    assert.equal(probe.calls(), 3)
  })

  await it('forgetHost 뒤에 온 호출은 진행 중이던 옛 읽기에 합류하지 않는다', async () => {
    const reads = new RepositoryReads(new AbortController().signal)
    const stalled = Promise.withResolvers()
    const probe = stalledReadinessOf(stalled.promise)
    const stale = reads.readiness('forgejo', HOST, probe.run, new AbortController().signal)
    reads.forgetHost(HOST)
    assert.deepEqual(await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal), READY)
    assert.equal(probe.calls(), 2)
    stalled.resolve(SIGNED_OUT)
    assert.deepEqual(await stale, SIGNED_OUT)
    // 잊힌 뒤에 끝난 옛 결과는 캐시를 덮지 않는다.
    assert.deepEqual(await reads.readiness('forgejo', HOST, probe.run, new AbortController().signal), READY)
    assert.equal(probe.calls(), 2)
  })
})
