import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

await test('공통 아이콘은 JSX 설정이 없는 TypeScript 소비자에서도 타입 검사한다', async (t) => {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(cwd, '.icons-compat-'))
  t.after(async () => {
    assert.equal(dirname(await realpath(directory)), await realpath(cwd))
    await rm(directory, { recursive: true, force: true })
  })
  await writeFile(
    join(directory, 'entry.ts'),
    [
      "import { ProviderIcon, modelSettingsIconSvg, IconRefreshOutlineRegular } from '@dungsil/dsh-ui/icons'",
      'void ProviderIcon',
      'void modelSettingsIconSvg',
      'void IconRefreshOutlineRegular',
    ].join('\n')
  )
  await writeFile(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      extends: '@dungsil/dsh-tsconfig',
      compilerOptions: { lib: ['ES2025', 'DOM'], strict: true, noEmit: true },
      include: ['entry.ts'],
    })
  )
  const require = createRequire(import.meta.url)
  execFileSync(
    process.execPath,
    [
      join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'),
      '--project',
      join(directory, 'tsconfig.json'),
    ],
    {
      cwd,
      stdio: 'inherit',
    }
  )
})
