import { runPnpm } from './pnpm.mjs'

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--fix') || args.length > 1) {
  console.error('Usage: node scripts/lint.mjs [--fix]')
  process.exit(1)
}

function run(args) {
  const result = runPnpm(args, { stdio: 'inherit' })
  return result.status ?? 1
}

const buildStatus = run(['exec', 'turbo', 'run', 'build'])
if (buildStatus !== 0) process.exit(buildStatus)

if (args.includes('--fix')) {
  const lintStatus = run(['exec', 'oxlint', '--fix', '--fix-suggestions', '--deny-warnings', '.'])
  const formatStatus = run(['exec', 'oxfmt', '--write', '.'])
  if (lintStatus !== 0 || formatStatus !== 0) process.exit(lintStatus || formatStatus)
}

const lintStatus = run(['exec', 'oxlint', '--deny-warnings', '.'])
const formatStatus = run(['exec', 'oxfmt', '--check', '.'])
process.exit(lintStatus || formatStatus)
