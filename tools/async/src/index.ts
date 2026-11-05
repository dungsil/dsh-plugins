interface PendingTask {
  start: () => void
  cancel: () => void
}

// Keep a slot until the entire task settles, including awaited process-tree teardown.
// Aborting an active task must not admit a replacement while its children still exit.
export function createTaskQueue({ concurrency, maxPending }: { concurrency: number; maxPending: number }) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(maxPending) || maxPending < 0)
    throw new RangeError('Invalid task queue limits')
  let active = 0
  const pending = new Set<PendingTask>()
  const drain = () => {
    while (active < concurrency && pending.size) pending.values().next().value!.start()
  }
  return <T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> => {
    if (signal.aborted) return Promise.reject(signal.reason)
    if (active >= concurrency && pending.size >= maxPending) return Promise.reject(new Error('busy'))
    return new Promise<T>((resolve, reject) => {
      const entry: PendingTask = {
        start() {
          pending.delete(entry)
          signal.removeEventListener('abort', entry.cancel)
          active++
          void (async () => {
            try {
              signal.throwIfAborted()
              resolve(await task())
            } catch (error) {
              reject(error)
            } finally {
              active--
              drain()
            }
          })()
        },
        cancel() {
          pending.delete(entry)
          signal.removeEventListener('abort', entry.cancel)
          reject(signal.reason)
        },
      }
      pending.add(entry)
      signal.addEventListener('abort', entry.cancel, { once: true })
      drain()
    })
  }
}
