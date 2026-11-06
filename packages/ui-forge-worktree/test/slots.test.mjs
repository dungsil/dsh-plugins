import assert from 'node:assert/strict'
import test from 'node:test'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

await test('같은 ID의 낮은 우선순위는 기본 옵션만 교체하고 해제하면 원래 옵션을 복원한다', () => {
  const core = new SlotCore()
  core.register(
    {
      name: 'root',
      children: {
        'conversation.hero.options': { kind: 'list', scope: 'session' },
        'conversation.input.dock': { kind: 'list', scope: 'session' },
      },
    },
    () => null
  )
  const original = () => 'original'
  const progress = () => 'progress'
  core.register({ name: 'conversation.hero.options', id: 'forge-panel.worktree' }, original)
  core.register({ name: 'conversation.input.dock', id: 'forge-panel.worktree' }, progress)
  const remove = core.register(
    { name: 'conversation.hero.options', id: 'forge-panel.worktree', priority: -100 },
    () => null
  )
  assert.equal(core.entriesOfSlot('conversation.hero.options').length, 1)
  assert.equal(core.entriesOfSlot('conversation.hero.options')[0].component(), null)
  assert.equal(core.entriesOfSlot('conversation.input.dock')[0].component, progress)
  remove()
  assert.equal(core.entriesOfSlot('conversation.hero.options')[0].component, original)
  assert.equal(core.entriesOfSlot('conversation.input.dock')[0].component, progress)
})
