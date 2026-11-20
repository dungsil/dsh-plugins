import { draftOf, entryOf } from './draft.js'
import type { McpDraft } from './draft.js'
import type { McpTranslate } from './locale.js'
import type { McpSnapshot, McpSource, McpStatus } from './model.js'

type Message = Parameters<McpTranslate>[0]
export interface McpEditor {
  readonly snapshot: McpSnapshot
  readonly originalName?: string
  readonly draft: McpDraft
}
export interface McpPageSnapshot {
  readonly snapshot: McpSnapshot | null
  readonly statuses: readonly McpStatus[]
  readonly loading: boolean
  readonly loadError: boolean
  readonly watchError: boolean
  readonly pending: boolean
  readonly search: string
  readonly sensitiveVisible: boolean
  readonly editor: McpEditor | null
  readonly removing: { readonly name: string; readonly snapshot: McpSnapshot } | null
  readonly notice: { readonly key: Message; readonly error: boolean } | null
  readonly editorError: Message | null
  readonly cleanupBlocked: ReadonlySet<string>
}

/** 비동기 요청의 수명을 React 렌더와 분리해 늦은 응답·중복 쓰기·초안 손실을 막는다. */
export class McpPageState {
  private current: McpPageSnapshot = {
    cleanupBlocked: new Set(),
    editor: null,
    editorError: null,
    loadError: false,
    loading: true,
    notice: null,
    pending: false,
    removing: null,
    search: '',
    sensitiveVisible: false,
    snapshot: null,
    statuses: [],
    watchError: false,
  }
  private readonly listeners = new Set<() => void>()
  private alive = false
  private generation = 0
  private locked = false
  private unwatch: (() => void) | null = null
  private readonly source: McpSource

  constructor(source: McpSource) {
    this.source = source
  }
  readonly getSnapshot = (): McpPageSnapshot => this.current
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private patch(value: Partial<McpPageSnapshot>): void {
    if (!this.alive) {
      return
    }
    this.current = { ...this.current, ...value }
    for (const listener of this.listeners) {
      listener()
    }
  }
  private watch(): void {
    this.unwatch?.()
    this.unwatch = this.source.watch(
      (statuses) => {
        this.patch({ statuses, watchError: false })
        void this.load()
      },
      () => {
        this.patch({ watchError: true })
      }
    )
  }
  readonly start = (): (() => void) => {
    this.alive = true
    void this.load()
    this.watch()
    return () => {
      this.alive = false
      this.generation += 1
      this.unwatch?.()
      this.unwatch = null
    }
  }
  readonly load = async (showLoading = false): Promise<void> => {
    this.generation += 1
    const { generation } = this
    this.patch({ loadError: false, ...(showLoading || this.current.snapshot === null ? { loading: true } : {}) })
    try {
      const snapshot = await this.source.read()
      if (generation === this.generation) {
        this.patch({ loading: false, snapshot, statuses: snapshot.statuses })
      }
    } catch {
      if (generation === this.generation) {
        this.patch({ loadError: true, loading: false })
      }
    }
  }
  readonly refresh = (): void => {
    if (!this.locked) {
      this.watch()
      void this.load(true)
    }
  }
  readonly search = (value: string): void => {
    this.patch({ search: value })
  }
  readonly revealSensitive = (value: boolean): void => {
    this.patch({ sensitiveVisible: value })
  }
  readonly openEditor = (name?: string): void => {
    const { snapshot } = this.current
    if (snapshot?.writable !== true || this.locked) {
      return
    }
    this.patch({
      editor: {
        snapshot,
        ...(name === undefined ? {} : { originalName: name }),
        draft: draftOf(name ?? '', name === undefined ? undefined : snapshot.entries[name]),
      },
      editorError: null,
      sensitiveVisible: false,
    })
  }
  readonly closeEditor = (): void => {
    if (!this.locked) {
      this.patch({ editor: null, editorError: null })
    }
  }
  readonly updateDraft = (key: keyof McpDraft, value: string | boolean): void => {
    const { editor } = this.current
    if (editor && !this.locked) {
      this.patch({ editor: { ...editor, draft: { ...editor.draft, [key]: value } }, editorError: null })
    }
  }
  private async run(action: () => Promise<void>, success?: Message): Promise<boolean> {
    if (this.locked || !this.alive) {
      return false
    }
    this.locked = true
    this.patch({ notice: null, pending: true })
    try {
      await action()
      if (success !== undefined) {
        this.patch({ notice: { error: false, key: success } })
      }
      await this.load()
      return true
    } catch {
      this.patch({
        ...(this.current.editor === null ? {} : { editorError: 'actionFailed' as const }),
        notice: { error: true, key: 'actionFailed' },
      })
      await this.load()
      return false
    } finally {
      this.locked = false
      this.patch({ pending: false })
    }
  }
  readonly save = async (): Promise<void> => {
    const { editor, statuses, snapshot } = this.current
    if (!editor) {
      return
    }
    const { draft, originalName, snapshot: captured } = editor
    const entry = entryOf(draft, originalName === undefined ? undefined : captured.entries[originalName])
    if (!entry) {
      this.patch({ editorError: 'invalid' })
      return
    }
    if (
      originalName === undefined &&
      (Object.hasOwn(snapshot?.entries ?? {}, draft.name) || statuses.some((item) => item.name === draft.name))
    ) {
      this.patch({ editorError: 'duplicate' })
      return
    }
    if (
      await this.run(async () => {
        await this.source.save(captured, draft.name, entry, originalName === undefined)
      }, 'saved')
    ) {
      this.closeEditor()
    } else {
      const latest = this.current.snapshot
      if (latest && latest.revision !== captured.revision) {
        if (JSON.stringify(latest.entries[draft.name]) === JSON.stringify(captured.entries[draft.name])) {
          this.patch({ editor: { ...editor, snapshot: latest } })
        } else {
          this.patch({ editorError: 'conflict' })
        }
      }
    }
  }
  readonly setEnabled = (name: string, enabled: boolean): void => {
    const { snapshot } = this.current
    if (snapshot) {
      void this.run(async () => {
        await this.source.setEnabled(snapshot, name, enabled)
      })
    }
  }
  readonly resetEnabled = (name: string): void => {
    const { snapshot } = this.current
    if (this.current.loading || this.current.loadError) {
      return
    }
    if (
      snapshot?.writable === true &&
      snapshot.enabledOverrides.includes(name) &&
      Object.hasOwn(snapshot.entries, name)
    ) {
      void this.run(async () => {
        await this.source.resetEnabled(snapshot, name)
      })
    }
  }
  readonly restart = (name: string): void => {
    void this.run(async () => {
      await this.source.restart(name)
    })
  }
  readonly probe = (name: string): void => {
    void this.run(async () => {
      const result = await this.source.probe(name)
      if (result.cleanupFailed === true) {
        this.patch({
          cleanupBlocked: new Set([...this.current.cleanupBlocked, name]),
          notice: { error: true, key: 'cleanupFailed' },
        })
      } else {
        this.patch({ notice: { error: !result.ok, key: result.ok ? 'probeOk' : 'probeFailed' } })
      }
    })
  }
  readonly confirmRemove = (name: string): void => {
    const { snapshot } = this.current
    if (snapshot?.writable === true && !snapshot.inherited.includes(name) && !this.locked) {
      this.patch({ removing: { name, snapshot } })
    }
  }
  readonly cancelRemove = (): void => {
    if (!this.locked) {
      this.patch({ removing: null })
    }
  }
  readonly remove = async (): Promise<void> => {
    const { removing } = this.current
    if (
      removing &&
      (await this.run(async () => {
        await this.source.remove(removing.snapshot, removing.name)
      }, 'removed'))
    ) {
      this.patch({ removing: null })
    }
  }
}
