import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { dictionaries } from '../src/locale.ts'

const source = stripTypeScriptTypes(await readFile(new URL('../src/client.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')
const previousKey = 'dungsil.sidebar-inbox.sort.v1'
const selectedKey = 'dungsil.sidebar-inbox.selected-sort.v1'

function harness({ saved = [], orderBy = 'updated', groupBy = 'workspace', denied = false } = {}) {
  const storage = new Map(saved)
  const listeners = new Set()
  const dataListeners = new Set()
  let language = 'en'
  let snapshot = { orderBy, groupBy, sessionOrderByAccount: {} }
  const view = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    store: {
      set(value) {
        snapshot = value
        for (const listener of listeners) listener()
      },
    },
  }
  let mount, option
  const context = {
    localStorage: {
      getItem(key) {
        if (denied) throw new Error('denied')
        return storage.get(key) ?? null
      },
      setItem(key, value) {
        if (denied) throw new Error('denied')
        storage.set(key, value)
      },
    },
    placeSessions: () => ({ order: [], placements: new Map() }),
    installHeadings: () => ({ refresh() {}, dispose() {} }),
    installSortOption: (value) => {
      option = value
      return { refresh() {}, dispose() {} }
    },
    dictionaries,
    NS: 'inbox',
  }
  runInNewContext(`${source}\nglobalThis.apply = apply`, context)
  const store = (value) => ({
    getSnapshot: () => value,
    subscribe(listener) {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
  })
  const ctx = {
    effect: (callback) => callback(),
    locale: {
      register() {},
      bind: () => (key) => key,
      getSnapshot: () => ({ active: language }),
      subscribe: () => () => {},
    },
    slots: {
      inject: (_name, callback) => {
        mount = callback
      },
      entries: () => [{ registrant: '@deepseek-ai/dsh-client-ui-workspace', store: { create: () => view } }],
    },
    sessions: { list: store({ phase: 'ready' }) },
    workspaces: { list: store({ phase: 'ready', pinnedSessionIds: [], archivedSessionIds: [] }) },
    uiSession: { sessionStatus: store(new Map()) },
  }
  context.apply(ctx)
  return {
    storage,
    mount: () => mount(),
    snapshot: () => snapshot,
    set: (patch) => view.store.set({ ...snapshot, ...patch }),
    toggle: () => option.onToggle(),
    label: (active) => {
      language = active
      return option.label()
    },
    refresh: () => {
      for (const listener of dataListeners) listener()
    },
  }
}

void test('정렬 이름은 여섯 추가 언어의 지역 식별자와 실시간 언어 변경을 지원한다', () => {
  const app = harness()
  app.mount()
  for (const [language, expected] of [
    ['ja-JP', 'エージェントの活動'],
    ['es-MX', 'Actividad del agente'],
    ['fr-CA', 'Activité de l’agent'],
    ['de-DE', 'Agentenaktivität'],
    ['ru-RU', 'Активность агента'],
    ['pt-BR', 'Atividade do agente'],
    ['JA_jp', 'エージェントの活動'],
    ['ko-KR', '에이전트 활동'],
    ['en-US', 'Agent activity'],
  ]) {
    assert.equal(app.label(language), expected)
  }
  assert.equal(app.label('zh-CN'), 'sort.agentActivity', 'existing host dictionary fallback is preserved')
})

void test('신규 설치는 기존 그룹과 관계없이 에이전트 활동을 기본 선택한다', () => {
  const app = harness()
  app.mount()
  assert.equal(app.snapshot().orderBy, 'agent-activity')
  assert.equal(app.snapshot().groupBy, 'flat')
  assert.equal(app.storage.get(previousKey), 'updated')
  assert.equal(app.storage.get(selectedKey), 'agent-activity')
})

void test('업데이트 정리 시 기본 정렬로 돌려도 재마운트는 에이전트 활동을 복원한다', () => {
  const app = harness()
  const dispose = app.mount()
  dispose()
  assert.equal(app.snapshot().orderBy, 'updated')
  assert.equal(app.storage.get(selectedKey), 'agent-activity')
  app.mount()
  assert.equal(app.snapshot().orderBy, 'agent-activity')
})

void test('페이지 재시작으로 호스트가 정렬값을 정규화해도 저장한 에이전트 활동을 복원한다', () => {
  const app = harness({
    saved: [
      [previousKey, 'updated'],
      [selectedKey, 'agent-activity'],
    ],
  })
  app.mount()
  assert.equal(app.snapshot().orderBy, 'agent-activity')
  assert.equal(app.snapshot().groupBy, 'flat')
})

for (const mode of ['manual', 'updated']) {
  void test(`사용자가 직접 선택한 ${mode} 정렬은 업데이트 후에도 유지한다`, () => {
    const app = harness()
    app.mount()
    app.set({ orderBy: mode })
    assert.equal(app.storage.get(selectedKey), mode)
    const restarted = harness({ saved: [...app.storage], orderBy: 'manual' })
    restarted.mount()
    assert.equal(restarted.snapshot().orderBy, mode)
  })
}

void test('에이전트 활동을 다시 누르면 이전 기본 정렬을 선택하고 재마운트에도 유지한다', () => {
  const app = harness()
  const dispose = app.mount()
  app.toggle()
  assert.equal(app.snapshot().orderBy, 'updated')
  dispose()
  app.mount()
  assert.equal(app.snapshot().orderBy, 'updated')
})

void test('그룹 보기를 바꾸면 기본 정렬로 전환하고 재마운트에서 강제로 되돌리지 않는다', () => {
  const app = harness()
  const dispose = app.mount()
  app.set({ groupBy: 'workspace' })
  assert.equal(app.storage.get(selectedKey), 'updated')
  dispose()
  app.mount()
  assert.equal(app.snapshot().groupBy, 'workspace')
  assert.equal(app.snapshot().orderBy, 'updated')
})

void test('세션과 에이전트 상태가 갱신되어도 선택한 에이전트 활동을 유지한다', () => {
  const app = harness()
  app.mount()
  app.refresh()
  app.refresh()
  assert.equal(app.snapshot().orderBy, 'agent-activity')
})

void test('이전 버전에서 기본 정렬을 선택한 사용자는 새 저장 키로 이관한다', () => {
  const app = harness({ saved: [[previousKey, 'manual']] })
  app.mount()
  assert.equal(app.snapshot().orderBy, 'updated')
  assert.equal(app.storage.get(selectedKey), 'updated')
})

void test('이전 버전에서 활성화된 에이전트 활동은 새 저장 키로 이관한다', () => {
  const app = harness({ saved: [[previousKey, 'manual']], orderBy: 'agent-activity', groupBy: 'flat' })
  app.mount()
  assert.equal(app.storage.get(selectedKey), 'agent-activity')
})

void test('저장소 접근이 거부되어도 기본 선택과 정리 코드가 동작한다', () => {
  const app = harness({ denied: true })
  const dispose = app.mount()
  assert.equal(app.snapshot().orderBy, 'agent-activity')
  assert.doesNotThrow(dispose)
})
