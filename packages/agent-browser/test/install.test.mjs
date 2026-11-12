import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import test from 'node:test'
import { c } from 'tar'
import { createBrowserInstaller } from '../dist/install.js'

const name = 'agent-browser-win32-x64.exe'
const native = Buffer.from('native executable fixture')

async function fixture(t, { files = { [`package/bin/${name}`]: native } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(source)
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(source, path)), { recursive: true })
    await writeFile(join(source, path), body)
  }
  const archive = join(root, 'fixture.tgz')
  c({ gzip: true, cwd: source, file: archive, sync: true }, Object.keys(files))
  const bytes = await readFile(archive)
  const integrity = createHash('sha512').update(bytes).digest('base64')
  const directory = join(root, 'cache')
  const options = { directory, platform: 'win32', arch: 'x64', integrity }
  return { root, bytes, integrity, directory, options }
}

const signal = () => new AbortController().signal
const response = (bytes) => new Response(bytes)

async function assertClean(directory) {
  const entries = await readdir(directory).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)))
  assert.equal(
    entries.some((name) => name.startsWith('.staging-')),
    false
  )
}

await test('고정 URL에서 다운로드하고 선택한 플랫폼 실행 파일만 설치한다', async (t) => {
  const f = await fixture(t, {
    files: {
      [`package/bin/${name}`]: native,
      'package/bin/agent-browser-darwin-arm64': 'other platform',
      'package/postinstall.js': 'must not run',
    },
  })
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async (url, options) => {
      assert.equal(url, 'https://registry.npmjs.org/agent-browser/-/agent-browser-0.38.1.tgz')
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      return response(f.bytes)
    },
  })
  const executable = await install(signal())
  assert.ok(isAbsolute(executable))
  assert.deepEqual(await readFile(executable), native)
  assert.deepEqual((await readdir(dirname(executable))).sort(), [name, 'checksum.json'].sort())
  await assertClean(f.directory)
})

await test('다운로드가 실패하면 부분 파일을 정리하고 다음 호출에서 재시도한다', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async () => {
      if (++calls === 1) return new Response('unavailable', { status: 503 })
      return response(f.bytes)
    },
  })
  await assert.rejects(install(signal()), /HTTP 503/)
  await assertClean(f.directory)
  assert.deepEqual(await readFile(await install(signal())), native)
  assert.equal(calls, 2)
})

await test('무결성이 일치하지 않으면 압축을 풀지 않고 다음 호출에서 재시도한다', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async () => response(++calls === 1 ? Buffer.from('not a tar') : f.bytes),
  })
  await assert.rejects(install(signal()), /integrity mismatch/)
  assert.deepEqual(await readdir(f.directory), [])
  assert.deepEqual(await readFile(await install(signal())), native)
})

await test('검증된 캐시는 새 설치기에서도 다운로드하지 않고 사용한다', async (t) => {
  const f = await fixture(t)
  const executable = await createBrowserInstaller({ ...f.options, fetch: async () => response(f.bytes) })(signal())
  const cached = createBrowserInstaller({
    ...f.options,
    fetch: async () => {
      assert.fail('cache must not download')
    },
  })
  assert.equal(await cached(signal()), executable)
})

await test(
  'Unix 캐시 실행 권한이 사라지면 재다운로드 없이 권한을 복구한다',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = await fixture(t)
    let calls = 0
    const install = createBrowserInstaller({
      ...f.options,
      fetch: async () => {
        calls++
        return response(f.bytes)
      },
    })
    const executable = await install(signal())
    await chmod(executable, 0o644)
    assert.equal(await install(signal()), executable)
    assert.equal((await stat(executable)).mode & 0o777, 0o755)
    assert.equal(calls, 1)
  }
)

await test('캐시 실행 파일의 체크섬이 바뀌면 다시 다운로드한다', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async () => {
      calls++
      return response(f.bytes)
    },
  })
  const executable = await install(signal())
  await writeFile(executable, 'corrupt')
  assert.equal(await install(signal()), executable)
  assert.deepEqual(await readFile(executable), native)
  assert.equal(calls, 2)
  await assertClean(f.directory)
})

await test('동일 프로세스의 동시 호출과 설치기 인스턴스는 다운로드를 공유한다', async (t) => {
  const f = await fixture(t)
  let calls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const options = {
    ...f.options,
    fetch: async () => {
      calls++
      await gate
      return response(f.bytes)
    },
  }
  const first = createBrowserInstaller(options)
  const second = createBrowserInstaller(options)
  const results = [first(signal()), first(signal()), second(signal())]
  release()
  const paths = await Promise.all(results)
  assert.equal(new Set(paths).size, 1)
  assert.equal(calls, 1)
  await assertClean(f.directory)
})

await test('다운로드 본문이 중간에 실패하면 부분 파일을 남기지 않는다', async (t) => {
  const f = await fixture(t)
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(f.bytes.subarray(0, 20))
          },
          pull(controller) {
            controller.error(new Error('interrupted stream'))
          },
        })
      ),
  })
  await assert.rejects(install(signal()), /interrupted stream/)
  assert.deepEqual(await readdir(f.directory), [])
})

await test('수명 신호 취소는 대기 중인 다운로드를 중단하고 부분 파일을 정리한다', async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  let started
  const ready = new Promise((resolve) => {
    started = resolve
  })
  let cancelled = false
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(f.bytes.subarray(0, 20))
            started()
          },
          cancel() {
            cancelled = true
          },
        })
      ),
  })
  const operation = install(controller.signal)
  await ready
  controller.abort(new Error('lifetime ended'))
  await assert.rejects(operation, /lifetime ended/)
  assert.equal(cancelled, true)
  await assertClean(f.directory)
  assert.deepEqual(await readdir(f.directory), [])
})

await test('이미 취소된 수명 신호는 다운로드를 시작하지 않는다', async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  controller.abort()
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async () => {
      assert.fail('must not fetch')
    },
  })
  await assert.rejects(install(controller.signal), { name: 'AbortError' })
})

await test('선택한 실행 파일이 없으면 실패하고 staging을 정리한다', async (t) => {
  const f = await fixture(t, { files: { 'package/bin/other': 'other' } })
  const install = createBrowserInstaller({ ...f.options, fetch: async () => response(f.bytes) })
  await assert.rejects(install(signal()), /archive is missing/)
  assert.deepEqual(await readdir(f.directory), [])
})

await test('Windows arm64에서는 x64 실행 파일을 선택한다', async (t) => {
  const f = await fixture(t)
  const executable = await createBrowserInstaller({
    ...f.options,
    arch: 'arm64',
    fetch: async () => response(f.bytes),
  })(signal())
  assert.equal(executable.endsWith(name), true)
})

await test('선택한 실행 파일이 비어 있으면 게시하지 않고 staging을 정리한다', async (t) => {
  const f = await fixture(t, { files: { [`package/bin/${name}`]: '' } })
  const install = createBrowserInstaller({ ...f.options, fetch: async () => response(f.bytes) })
  await assert.rejects(install(signal()), /Invalid agent-browser native executable entry/)
  assert.deepEqual(await readdir(f.directory), [])
})

await test('지원하지 않는 플랫폼은 다운로드 전에 거부한다', () => {
  assert.throws(() => createBrowserInstaller({ platform: 'freebsd' }), /Unsupported/)
})

await test('다운로드 크기 상한을 넘는 응답은 본문을 저장하지 않는다', async (t) => {
  const f = await fixture(t)
  const install = createBrowserInstaller({
    ...f.options,
    fetch: async () =>
      new Response('large', {
        headers: { 'content-length': String(256 * 1024 * 1024 + 1) },
      }),
  })
  await assert.rejects(install(signal()), /size limit/)
  assert.deepEqual(await readdir(f.directory), [])
})
