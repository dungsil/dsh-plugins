import { createTaskQueue } from '@dungsil/dsh-async'

// Both automatic Git-context and PR lookups share the same provider budget.
const queues = new WeakMap<object, ReturnType<typeof createTaskQueue>>()
export function readQueue(provider: object) {
  let queue = queues.get(provider)
  if (!queue) {
    queue = createTaskQueue({ concurrency: 2, maxPending: 128 })
    queues.set(provider, queue)
  }
  return queue
}
