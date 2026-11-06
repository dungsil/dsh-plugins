import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { runPnpm } from './pnpm.mjs'

function output(command, args) {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  if (command !== 'pnpm') return execFileSync(command, args, options).trimEnd()
  const result = runPnpm(args, options)
  if (result.status !== 0) throw new Error(result.stderr || 'pnpm failed')
  return result.stdout.trimEnd()
}

function run(args) {
  const result = runPnpm(args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function check() {
  let changed
  let rootConfigurationChanged = false
  try {
    const head = process.env.TURBO_SCM_HEAD || 'HEAD'
    let base = process.env.TURBO_SCM_BASE
    if (base) {
      if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
        base = output('git', ['merge-base', base, head])
      }
    } else {
      if (process.env.CI) throw new Error('CI comparison base is missing')
      const main = output('git', ['rev-parse', '--verify', 'origin/main'])
      base = output('git', ['merge-base', main, head])
    }
    if (output('git', ['rev-parse', '--is-shallow-repository']) === 'true') {
      throw new Error('Git history is shallow')
    }
    const diffs = [output('git', ['diff', '--name-only', '--no-renames', '-z', base, head, '--'])]
    // Keep staged, unstaged and untracked files, even when their changes cancel each other out.
    diffs.push(output('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--']))
    diffs.push(output('git', ['diff', '--cached', '--name-only', '--no-renames', '-z', '--']))
    diffs.push(output('git', ['ls-files', '--others', '--exclude-standard', '-z']))
    changed = [...new Set(diffs.flatMap((diff) => diff.split('\0').filter(Boolean)))]
    if (changed.includes('package.json')) {
      // Script-only changes affect the runner, not every plugin's runtime or types.
      const manifests = [base, head, ''].map((ref) => output('git', ['show', `${ref}:package.json`]))
      manifests.push(readFileSync('package.json', 'utf8'))
      const configurations = manifests.map((text) => {
        const manifest = JSON.parse(text)
        delete manifest.scripts
        return JSON.stringify(manifest)
      })
      rootConfigurationChanged = new Set(configurations).size > 1
    }
  } catch (error) {
    console.log(`Cannot determine changed packages; running all checks: ${error.message}`)
    run(['check:all'])
    return
  }

  const globalFiles = new Set([
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'turbo.json',
    'tsconfig.json',
    '.oxfmtrc.json',
    '.oxlintrc.json',
    'lint-staged.config.mjs',
    'scripts/lint.mjs',
    'scripts/pnpm.mjs',
    'scripts/check.mjs',
    '.editorconfig',
    '.gitignore',
  ])
  if (
    rootConfigurationChanged ||
    changed.some(
      (file) => globalFiles.has(file) || file.startsWith('tools/tsconfig/') || /(^|\/)\.env($|\.)/.test(file)
    )
  ) {
    console.log('Shared configuration changed; running all checks.')
    run(['check:all'])
    return
  }

  const packages = JSON.parse(output('pnpm', ['exec', 'turbo', 'ls', '--output=json'])).packages.items
  const owners = new Set()
  const files = []
  for (const file of changed) {
    const owner = packages.find((pkg) => file.startsWith(`${pkg.path}/`))
    if (owner) {
      owners.add(owner.name)
    } else if (/^(packages|tools)\//.test(file)) {
      // A removed package can still have consumers in the current workspace.
      console.log('Workspace package layout changed; running all checks.')
      run(['check:all'])
      return
    } else if (existsSync(file)) {
      files.push(file)
    }
  }

  const filters = [...owners].map((name) => `--filter=...${name}`)
  const selected = filters.length
    ? JSON.parse(output('pnpm', ['exec', 'turbo', 'ls', '--output=json', ...filters])).packages.items
    : []
  const paths = [...selected.map((pkg) => pkg.path), ...files]
  if (!paths.length) {
    console.log('No changed files or affected packages to check.')
    return
  }

  console.log(`Checking ${selected.length} affected packages and ${files.length} other files.`)
  run(['lint'])
  if (filters.length) run(['exec', 'turbo', 'run', 'typecheck', 'test', ...filters])
}

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--all')) {
  console.error('Usage: node scripts/check.mjs [--all]')
  process.exit(1)
}

if (args[0] === '--all') {
  run(['lint'])
  run(['exec', 'turbo', 'run', 'typecheck', 'test'])
} else {
  check()
}
