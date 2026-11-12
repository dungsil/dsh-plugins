import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { x } from 'tar'

const VERSION = '0.38.1'
const INTEGRITY = 'k58FCz0yUOCANoNkMiqJe+H2y6r6sUZazqXsWF+MYq1iRC42PjtLcBoag6SSTOD/FRQppvPDvE5HDYEhclvnhw=='
const URL = `https://registry.npmjs.org/agent-browser/-/agent-browser-${VERSION}.tgz`
const MAX_DOWNLOAD = 256 * 1024 * 1024
const MAX_EXECUTABLE = 128 * 1024 * 1024
const TIMEOUT = 120_000
const pending = new Map<string, Promise<string>>()

type InstallerOptions = {
  directory?: string
  fetch?: typeof fetch
  platform?: NodeJS.Platform
  arch?: string
  integrity?: string
}

function nativeName(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'win32' && arch === 'arm64') arch = 'x64'
  if (
    !['darwin', 'linux', 'win32'].includes(platform) ||
    !['x64', 'arm64'].includes(arch) ||
    (platform === 'win32' && arch !== 'x64')
  ) {
    throw new Error(`Unsupported agent-browser platform: ${platform}-${arch}`)
  }
  let target: string = platform
  if (platform === 'linux') {
    const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } }
    if (!report.header?.glibcVersionRuntime) target = 'linux-musl'
  }
  return `agent-browser-${target}-${arch}${platform === 'win32' ? '.exe' : ''}`
}

async function digestFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
  return hash.digest('base64')
}

async function validCache(directory: string, name: string, integrity: string, signal: AbortSignal): Promise<boolean> {
  try {
    const executable = join(directory, name)
    const [directoryStat, executableStat, manifestStat] = await Promise.all([
      lstat(directory),
      lstat(executable),
      lstat(join(directory, 'checksum.json')),
    ])
    if (
      !directoryStat.isDirectory() ||
      !executableStat.isFile() ||
      !manifestStat.isFile() ||
      executableStat.size === 0 ||
      executableStat.size > MAX_EXECUTABLE ||
      manifestStat.size > 4096
    )
      return false
    const metadata = JSON.parse(await readFile(join(directory, 'checksum.json'), 'utf8'))
    if (
      metadata.integrity !== integrity ||
      metadata.name !== name ||
      metadata.sha512 !== (await digestFile(executable, signal))
    )
      return false
    await chmod(executable, 0o755)
    signal.throwIfAborted()
    return true
  } catch (error) {
    signal.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === 'EACCES') throw error
    return false
  }
}

async function download(fetcher: typeof fetch, file: string, integrity: string, signal: AbortSignal): Promise<void> {
  const response = await fetcher(URL, { signal, redirect: 'error' })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`agent-browser download failed: HTTP ${response.status}`)
  }
  const length = Number(response.headers.get('content-length'))
  if (length > MAX_DOWNLOAD) {
    await response.body.cancel()
    throw new Error('agent-browser download exceeds size limit')
  }
  const reader = response.body.getReader()
  const handle = await open(file, 'wx')
  const hash = createHash('sha512')
  let bytes = 0
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_DOWNLOAD) throw new Error('agent-browser download exceeds size limit')
      hash.update(value)
      await handle.writeFile(value)
    }
    if (hash.digest('base64') !== integrity) throw new Error('agent-browser SHA-512 integrity mismatch')
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
    await handle.close()
  }
}

export function createBrowserInstaller(options: InstallerOptions = {}): (signal: AbortSignal) => Promise<string> {
  const platform = options.platform ?? process.platform
  const name = nativeName(platform, options.arch ?? process.arch)
  const integrity = (options.integrity ?? INTEGRITY).replace(/^sha512-/, '')
  if (!/^[A-Za-z0-9+/]{86}==$/.test(integrity)) throw new Error('Invalid agent-browser SHA-512 integrity')
  const root = resolve(
    options.directory ??
      (platform === 'win32'
        ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'dsh', 'cache', 'agent-browser')
        : join(homedir(), '.cache', 'dsh', 'agent-browser'))
  )
  const directory = join(
    root,
    `${VERSION}-${name}-${createHash('sha256').update(integrity).digest('hex').slice(0, 16)}`
  )
  const executable = join(directory, name)

  return (lifetimeSignal) => {
    if (lifetimeSignal.aborted) return Promise.reject(lifetimeSignal.reason)
    const existing = pending.get(directory)
    if (existing) return existing
    const operation = (async () => {
      const signal = AbortSignal.any([lifetimeSignal, AbortSignal.timeout(TIMEOUT)])
      if (await validCache(directory, name, integrity, signal)) return executable
      signal.throwIfAborted()
      await mkdir(root, { recursive: true })
      const staging = await mkdtemp(join(root, '.staging-'))
      try {
        const archive = join(staging, 'download.tgz')
        await download(options.fetch ?? fetch, archive, integrity, signal)
        signal.throwIfAborted()
        const extracted = join(staging, 'ready')
        await mkdir(extracted)
        let count = 0
        let invalidEntry = false
        await pipeline(
          createReadStream(archive),
          x({
            cwd: extracted,
            strip: 2,
            strict: true,
            preservePaths: false,
            filter: (path, entry) => {
              if (path !== `package/bin/${name}`) return false
              count++
              if (
                !('type' in entry) ||
                entry.type !== 'File' ||
                entry.size <= 0 ||
                entry.size > MAX_EXECUTABLE ||
                count !== 1
              ) {
                invalidEntry = true
                return false
              }
              return true
            },
          }),
          { signal }
        )
        if (invalidEntry) throw new Error('Invalid agent-browser native executable entry')
        if (count !== 1) throw new Error(`agent-browser archive is missing ${name}`)
        const native = join(extracted, basename(name))
        await chmod(native, 0o755)
        await writeFile(
          join(extracted, 'checksum.json'),
          JSON.stringify({
            integrity,
            name,
            sha512: await digestFile(native, signal),
          }),
          { flag: 'wx' }
        )
        signal.throwIfAborted()
        if (await validCache(directory, name, integrity, signal)) return executable
        try {
          await rename(extracted, directory)
        } catch (error) {
          if (await validCache(directory, name, integrity, signal)) return executable
          const code = (error as NodeJS.ErrnoException).code
          if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) throw error
          await rename(directory, join(staging, 'damaged'))
          try {
            await rename(extracted, directory)
          } catch (publishError) {
            if (!(await validCache(directory, name, integrity, signal))) throw publishError
          }
        }
        signal.throwIfAborted()
        return executable
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    })()
    pending.set(directory, operation)
    void operation
      .finally(() => {
        if (pending.get(directory) === operation) pending.delete(directory)
      })
      .catch(() => {})
    return operation
  }
}
