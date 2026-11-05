import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import {
  isQuotaCacheFresh,
  loadQuotaSnapshot,
  QuotaCache,
  quotaCacheTTL,
  quotaKey,
  subscribeQuotaGeneration,
} from '../src/quota-cache.ts'
import { copy, localizedCopy } from '../src/copy.ts'

test('automatic loading and cache copy has complete English, Korean, and Chinese locales', () => {
  const keys = Object.keys(copy.en).sort()
  for (const language of ['en', 'ko', 'zh']) {
    assert.deepEqual(Object.keys(copy[language]).sort(), keys)
    for (const value of Object.values(copy[language])) assert.ok(value.trim())
    assert.strictEqual(localizedCopy(`${language}-region`), copy[language])
    assert.ok(copy[language].accountsObservedAt)
  }
})

const connection = {
  baseURL: 'http://localhost:8317',
  revision: 'revision-1',
  apiKeySaved: true,
  managementKeySaved: true,
}

function account(name, overrides = {}) {
  return {
    name,
    provider: 'codex',
    status: 'ready',
    disabled: false,
    authIndex: `auth-${name}`,
    editable: true,
    supported: true,
    ...overrides,
  }
}

function quota(usedPercent = 25) {
  return {
    windows: [{ id: 'primary', usedPercent }],
    observedAt: '2026-11-05T00:00:00.000Z',
  }
}

function snapshot(accounts = [account('first')]) {
  return { accounts, quotas: {}, fetchedAt: 1_000_000 }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('cache freshness uses a five-minute TTL with an exclusive expiry boundary', () => {
  const value = snapshot()
  assert.equal(quotaCacheTTL, 300_000)
  for (const [age, expected] of [
    [-1, false],
    [0, true],
    [299_999, true],
    [300_000, false],
    [300_001, false],
  ]) {
    assert.equal(isQuotaCacheFresh(value, value.fetchedAt + age), expected, `age ${age}ms`)
  }
})

test('cache freshness defaults to the current clock', (t) => {
  const value = snapshot()
  t.mock.method(Date, 'now', () => value.fetchedAt + quotaCacheTTL - 1)
  assert.equal(isQuotaCacheFresh(value), true)
  Date.now.mock.mockImplementation(() => value.fetchedAt + quotaCacheTTL)
  assert.equal(isQuotaCacheFresh(value), false)
})

test('cache reads the same connection, replaces snapshots, and clears explicitly', () => {
  const cache = new QuotaCache()
  assert.equal(cache.read(connection), undefined)
  const first = snapshot()
  cache.write(connection, first)
  assert.strictEqual(cache.read({ ...connection }), first)
  const replacement = snapshot([])
  cache.write(connection, replacement)
  assert.strictEqual(cache.read(connection), replacement)
  cache.clear()
  assert.equal(cache.read(connection), undefined)
})

for (const [field, value] of [
  ['baseURL', 'http://other.example:8317'],
  ['revision', 'revision-2'],
  ['managementKeySaved', false],
]) {
  test(`changing connection ${field} permanently discards the previous snapshot`, () => {
    const cache = new QuotaCache()
    cache.write(connection, snapshot())
    assert.equal(cache.read({ ...connection, [field]: value }), undefined)
    assert.equal(cache.read(connection), undefined)
  })
}

test('changing only the saved API key flag does not discard management quota data', () => {
  const cache = new QuotaCache()
  const value = snapshot()
  cache.write(connection, value)
  assert.strictEqual(cache.read({ ...connection, apiKeySaved: false }), value)
})

test('quota keys distinguish both name and auth index without delimiter collisions', () => {
  const values = [
    account('same', { authIndex: 'auth-1' }),
    account('same', { authIndex: 'auth-2' }),
    account('other', { authIndex: 'auth-1' }),
    account('a:b', { authIndex: 'c' }),
    account('a', { authIndex: 'b:c' }),
  ]
  assert.equal(new Set(values.map(quotaKey)).size, values.length)
  assert.equal(quotaKey(values[0]), quotaKey({ ...values[0] }))
})

test('quota updates preserve accounts, other quotas, and the original TTL timestamp', () => {
  const cache = new QuotaCache()
  const first = account('same', { authIndex: 'auth-1' })
  const second = account('same', { authIndex: 'auth-2' })
  const initial = {
    ...snapshot([first, second]),
    quotas: { [quotaKey(first)]: quota(10), [quotaKey(second)]: quota(20) },
  }
  cache.write(connection, initial)
  const updatedQuota = quota(80)
  cache.update(connection, first, updatedQuota)
  const updated = cache.read(connection)
  assert.notStrictEqual(updated, initial)
  assert.notStrictEqual(updated.quotas, initial.quotas)
  assert.strictEqual(updated.accounts, initial.accounts)
  assert.equal(updated.fetchedAt, initial.fetchedAt)
  assert.strictEqual(updated.quotas[quotaKey(first)], updatedQuota)
  assert.strictEqual(updated.quotas[quotaKey(second)], initial.quotas[quotaKey(second)])
  assert.equal(initial.quotas[quotaKey(first)].windows[0].usedPercent, 10)
  cache.update(connection, first, null)
  assert.equal(cache.read(connection).quotas[quotaKey(first)], null)
})

test('quota updates cannot create a cache entry or revive data from another connection', () => {
  const cache = new QuotaCache()
  const first = account('first')
  cache.update(connection, first, quota())
  assert.equal(cache.read(connection), undefined)
  cache.write(connection, snapshot([first]))
  const changed = { ...connection, revision: 'revision-2' }
  cache.update(changed, first, quota())
  assert.equal(cache.read(changed), undefined)
  assert.equal(cache.read(connection), undefined)
})

test('loading publishes accounts first and immutable incremental quota snapshots', async (t) => {
  const accounts = [account('first'), account('second')]
  const results = accounts.map((_, index) => quota(index * 10))
  const published = []
  let listCalls = 0
  let now = 1_000
  t.mock.method(Date, 'now', () => now)
  const loaded = await loadQuotaSnapshot(
    async () => {
      listCalls++
      return accounts
    },
    async (value) => {
      now = 9_000
      return results[accounts.indexOf(value)]
    },
    new AbortController().signal,
    (value) => published.push(value)
  )
  assert.equal(listCalls, 1)
  assert.equal(published.length, 3)
  assert.strictEqual(published[0].accounts, accounts)
  assert.deepEqual(published[0].quotas, {})
  assert.equal(Object.keys(published[1].quotas).length, 1)
  assert.notStrictEqual(published[1], published[2])
  assert.notStrictEqual(published[1].quotas, published[2].quotas)
  assert.ok(published.every((value) => value.fetchedAt === 1_000))
  assert.deepEqual(loaded.quotas, Object.fromEntries(accounts.map((value, index) => [quotaKey(value), results[index]])))
  assert.strictEqual(loaded, published.at(-1))
})

test('disabled, unsupported, and missing-auth accounts stay visible without quota requests', async () => {
  const accounts = [
    account('disabled', { disabled: true }),
    account('unsupported', { supported: false }),
    account('empty-auth', { authIndex: '' }),
    account('missing-auth', { authIndex: undefined }),
    account('enabled'),
  ]
  const requested = []
  const result = quota()
  const published = []
  const loaded = await loadQuotaSnapshot(
    async () => accounts,
    async (value) => {
      requested.push(value)
      return result
    },
    new AbortController().signal,
    (value) => published.push(value)
  )
  assert.deepEqual(requested, [accounts.at(-1)])
  assert.strictEqual(loaded.accounts, accounts)
  assert.deepEqual(loaded.quotas, { [quotaKey(accounts.at(-1))]: result })
  assert.equal(published.length, 2)
})

test('quota requests run with at most three workers and drain all queued accounts', async (t) => {
  const accounts = Array.from({ length: 8 }, (_, index) => account(`account-${index}`))
  const gates = accounts.map(() => deferred())
  const requested = []
  let active = 0
  let maximum = 0
  t.after(() => gates.forEach((gate) => gate.resolve(quota())))
  const loading = loadQuotaSnapshot(
    async () => accounts,
    async (value) => {
      const index = accounts.indexOf(value)
      requested.push(value)
      active++
      maximum = Math.max(maximum, active)
      try {
        return await gates[index].promise
      } finally {
        active--
      }
    },
    new AbortController().signal,
    () => {}
  )
  await setImmediate()
  assert.equal(active, 3)
  assert.deepEqual(requested, accounts.slice(0, 3))
  gates[1].resolve(quota(10))
  await setImmediate()
  assert.equal(active, 3)
  assert.deepEqual(requested, accounts.slice(0, 4))
  gates.forEach((gate, index) => gate.resolve(quota(index)))
  const loaded = await loading
  assert.equal(maximum, 3)
  assert.equal(active, 0)
  assert.deepEqual(requested, accounts)
  assert.equal(Object.keys(loaded.quotas).length, accounts.length)
})

test('synchronous and asynchronous quota failures do not prevent other accounts loading', async () => {
  const accounts = Array.from({ length: 5 }, (_, index) => account(`account-${index}`))
  const requested = []
  const published = []
  const result = quota(75)
  const loaded = await loadQuotaSnapshot(
    async () => accounts,
    (value) => {
      requested.push(value)
      if (value === accounts[0]) throw new Error('sync failure')
      if (value === accounts[1]) return Promise.reject(new Error('async failure'))
      return Promise.resolve(result)
    },
    new AbortController().signal,
    (value) => published.push(value)
  )
  assert.deepEqual(requested, accounts)
  assert.equal(published.length, accounts.length + 1)
  assert.equal(loaded.quotas[quotaKey(accounts[0])], null)
  assert.equal(loaded.quotas[quotaKey(accounts[1])], null)
  for (const value of accounts.slice(2)) assert.strictEqual(loaded.quotas[quotaKey(value)], result)
  assert.deepEqual(published[0].quotas, {})
})

test('empty account lists publish a reusable empty snapshot without fetching quotas', async () => {
  const published = []
  const loaded = await loadQuotaSnapshot(
    async () => [],
    () => assert.fail('empty lists must not fetch quota'),
    new AbortController().signal,
    (value) => published.push(value)
  )
  assert.deepEqual(loaded.accounts, [])
  assert.deepEqual(loaded.quotas, {})
  assert.equal(published.length, 1)
  assert.strictEqual(loaded, published[0])
  assert.equal(isQuotaCacheFresh(loaded, loaded.fetchedAt), true)
})

test('lists containing only skipped accounts publish once without fetching quotas', async () => {
  const accounts = [account('disabled', { disabled: true }), account('unsupported', { supported: false })]
  const published = []
  const loaded = await loadQuotaSnapshot(
    async () => accounts,
    () => assert.fail('skipped accounts must not fetch quota'),
    new AbortController().signal,
    (value) => published.push(value)
  )
  assert.strictEqual(loaded.accounts, accounts)
  assert.deepEqual(loaded.quotas, {})
  assert.equal(published.length, 1)
})

test('an already aborted signal prevents even the account-list request', async () => {
  const controller = new AbortController()
  const reason = new Error('already inactive')
  controller.abort(reason)
  await assert.rejects(
    loadQuotaSnapshot(
      () => assert.fail('inactive views must not list accounts'),
      () => assert.fail('inactive views must not fetch quotas'),
      controller.signal,
      () => assert.fail('inactive views must not publish')
    ),
    (error) => error === reason
  )
})

test('aborting while listing prevents publishing accounts or starting quota requests', async () => {
  const controller = new AbortController()
  const gate = deferred()
  const reason = new Error('view unmounted')
  const loading = loadQuotaSnapshot(
    () => gate.promise,
    () => assert.fail('aborted list must not start quota requests'),
    controller.signal,
    () => assert.fail('aborted list must not publish')
  )
  const rejected = assert.rejects(loading, (error) => error === reason)
  controller.abort(reason)
  gate.resolve([account('first')])
  await rejected
})

test('aborting from the initial accounts publish stops every quota request', async () => {
  const controller = new AbortController()
  const reason = new Error('view changed during publish')
  const published = []
  await assert.rejects(
    loadQuotaSnapshot(
      async () => [account('first'), account('second')],
      () => assert.fail('no quota request may start after abort'),
      controller.signal,
      (value) => {
        published.push(value)
        controller.abort(reason)
      }
    ),
    (error) => error === reason
  )
  assert.equal(published.length, 1)
  assert.deepEqual(published[0].quotas, {})
})

for (const outcome of ['resolve', 'reject']) {
  test(`aborting pending quota requests prevents late ${outcome} publishes and queued requests`, async (t) => {
    const controller = new AbortController()
    const accounts = Array.from({ length: 6 }, (_, index) => account(`account-${index}`))
    const gates = accounts.map(() => deferred())
    const requested = []
    const published = []
    const reason = new Error('connection changed')
    t.after(() => gates.forEach((gate) => gate.resolve(quota())))
    const loading = loadQuotaSnapshot(
      async () => accounts,
      (value) => {
        requested.push(value)
        return gates[accounts.indexOf(value)].promise
      },
      controller.signal,
      (value) => published.push(value)
    )
    const rejected = assert.rejects(loading, (error) => error === reason)
    await setImmediate()
    assert.equal(requested.length, 3)
    assert.equal(published.length, 1)
    controller.abort(reason)
    for (const gate of gates.slice(0, 3)) {
      if (outcome === 'resolve') gate.resolve(quota())
      else gate.reject(new Error('late upstream failure'))
    }
    await rejected
    await setImmediate()
    assert.deepEqual(requested, accounts.slice(0, 3))
    assert.equal(published.length, 1)
    assert.deepEqual(published[0].quotas, {})
  })
}

test('aborting after a quota publish preserves that snapshot but stops later work', async () => {
  const controller = new AbortController()
  const accounts = Array.from({ length: 6 }, (_, index) => account(`account-${index}`))
  const requested = []
  const published = []
  const reason = new Error('view closed after first quota')
  await assert.rejects(
    loadQuotaSnapshot(
      async () => accounts,
      async (value) => {
        requested.push(value)
        return quota()
      },
      controller.signal,
      (value) => {
        published.push(value)
        if (Object.keys(value.quotas).length === 1) controller.abort(reason)
      }
    ),
    (error) => error === reason
  )
  assert.deepEqual(requested, accounts.slice(0, 3))
  assert.equal(published.length, 2)
  assert.deepEqual(published[0].quotas, {})
  assert.equal(Object.keys(published[1].quotas).length, 1)
})

test('generation loss cancels pending quota work before clearing the cache and waits for readiness', async () => {
  const cache = new QuotaCache()
  cache.write(connection, snapshot())
  const controller = new AbortController()
  let current = { id: 1 }
  let listener
  let disposed = false
  const ready = []
  const unsubscribe = subscribeQuotaGeneration(
    {
      subscribe: (next) => {
        listener = next
        return () => {
          disposed = true
        }
      },
      getSnapshot: () => current,
    },
    cache,
    () => controller.abort(),
    (connected) => {
      assert.equal(controller.signal.aborted, true)
      assert.equal(cache.read(connection), undefined)
      ready.push(connected)
    }
  )
  const accounts = Array.from({ length: 5 }, (_, index) => account(`account-${index}`))
  const gate = deferred()
  const requested = []
  const published = []
  const loading = loadQuotaSnapshot(
    async () => accounts,
    (value) => {
      requested.push(value)
      return gate.promise
    },
    controller.signal,
    (value) => published.push(value)
  ).then((value) => cache.write(connection, value))
  const rejected = assert.rejects(loading, { name: 'AbortError' })
  await setImmediate()
  current = undefined
  listener()
  gate.resolve(quota())
  await rejected
  assert.equal(requested.length, 3)
  assert.equal(published.length, 1)
  assert.equal(cache.read(connection), undefined)
  assert.deepEqual(ready, [false])
  current = { id: 2 }
  listener()
  assert.deepEqual(ready, [false, true])
  unsubscribe()
  assert.equal(disposed, true)
})

for (const accounts of [[], [account('last')]]) {
  test(`abort during the final publish cannot complete a snapshot with ${accounts.length} accounts`, async () => {
    const controller = new AbortController()
    await assert.rejects(
      loadQuotaSnapshot(
        async () => accounts,
        async () => quota(),
        controller.signal,
        (value) => {
          if (accounts.length === 0 || Object.keys(value.quotas).length === accounts.length) controller.abort()
        }
      ),
      { name: 'AbortError' }
    )
  })
}

test('account-list rejection is propagated without publishing or fetching quotas', async () => {
  const reason = new Error('management list failed')
  await assert.rejects(
    loadQuotaSnapshot(
      async () => {
        throw reason
      },
      () => assert.fail('failed list must not fetch quotas'),
      new AbortController().signal,
      () => assert.fail('failed list must not publish a successful snapshot')
    ),
    (error) => error === reason
  )
})
