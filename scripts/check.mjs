import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
}

function run(args) {
  execFileSync('pnpm', args, { stdio: 'inherit' })
}

function check() {
  let changed
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
  } catch (error) {
    console.log(`Cannot determine changed packages; running all checks: ${error.message}`)
    run(['check:all'])
    return
  }

  const globalFiles = new Set([
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'turbo.json',
    'tsconfig.json',
    '.oxfmtrc.json',
    '.oxlintrc.json',
    '.editorconfig',
    '.gitignore',
    'scripts/check.mjs',
    '.github/workflows/ci.yml',
  ])
  if (
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
  run(['exec', 'oxfmt', '--check', '--no-error-on-unmatched-pattern', '--', ...paths])
  if (filters.length) run(['exec', 'turbo', 'run', 'typecheck', 'test', ...filters])
  run(['exec', 'oxlint', '--deny-warnings', '--no-error-on-unmatched-pattern', '--', ...paths])
}

check()
