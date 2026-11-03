import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import release from 'release-it'
import semver from 'semver'

export function releaseOptions({ dryRun = false } = {}) {
  const { name } = JSON.parse(readFileSync('package.json', 'utf8'))
  const tags = execFileSync('git', ['tag', '--merged', 'HEAD', '--list', `${name}@*`], { encoding: 'utf8' })
  // Only locale-ko was published under the old repository-wide v* tags.
  const prefix = name === '@dungsil/dsh-plugin-locale-ko' && !tags.trim() ? 'v' : `${name}@`
  const archiveName = name.replace(/^@/, '').replaceAll('/', '-')
  const destination = `../../release/${archiveName}`

  return {
    ci: true,
    'dry-run': dryRun,
    git: {
      requireBranch: dryRun ? false : 'main',
      tagMatch: `${prefix}*`,
      tagName: `${name}@\${version}`,
      commitMessage: `chore(release): ${name}@\${version} [skip ci]`,
      pushArgs: ['--follow-tags', '--atomic'],
    },
    npm: {
      publish: !dryRun,
      // pnpm rewrites workspace dependencies to published version ranges.
      publishPackageManager: 'pnpm',
      publishArgs: ['--no-git-checks'],
      // npm whoami cannot authenticate with the workflow's OIDC identity.
      skipChecks: true,
    },
    github: {
      release: !dryRun,
      releaseName: `${name}@\${version}`,
      assets: [`${destination}/${archiveName}-\${version}.tgz`],
    },
    plugins: {
      '@release-it/conventional-changelog': {
        preset: { name: 'conventionalcommits' },
        infile: 'CHANGELOG.md',
        header: `# ${name}`,
        tagOpts: { prefix },
        commitsOpts: { path: '.' },
        gitRawCommitsOpts: { path: '.' },
        context: { linkCompare: prefix === 'v' || Boolean(tags.trim()) },
        // Other packages' tags must not split this package's release notes.
        writerOpts: { generateOn: null },
      },
    },
    hooks: {
      'before:git:beforeRelease': [
        'pnpm exec oxfmt --write package.json CHANGELOG.md',
        `pnpm pack --pack-destination ${destination}`,
      ],
      // npm has published by this point; record the confirmed version without waiting for registry propagation.
      'before:git:release': [`pnpm --dir ../.. market:index --release ${name}`, 'git add ../../market/index.json'],
    },
  }
}

export async function releaseWorkspace({ dryRun = false, packageName, version, ...options } = {}) {
  if (version && (!packageName || semver.valid(version) !== version)) {
    throw new Error('An exact version requires a package name and a valid semantic version')
  }
  const root = process.cwd()
  // Unlike `pnpm list`, recursive exec honors dependency order. Serial output
  // keeps that order intact before release-it bumps and packs each package.
  const packages = execFileSync(
    'pnpm',
    [
      '-r',
      '--sort',
      '--workspace-concurrency=1',
      '--reporter=silent',
      'exec',
      'node',
      '-p',
      'JSON.stringify({ path: process.cwd(), ...require("./package.json") })',
    ],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const selected = packages.filter((pkg) => !pkg.private && (!packageName || pkg.name === packageName))
  if (packageName && selected.length === 0) throw new Error(`Unknown public package: ${packageName}`)
  try {
    // Each release commits its own manifest and changelog before the next starts.
    for (const pkg of selected) {
      process.chdir(pkg.path)
      const settings = releaseOptions({ dryRun })
      await release({
        ...settings,
        ...(version ? { increment: version } : {}),
        ...options,
        npm: { ...settings.npm, ...options.npm, ...(version ? { allowSameVersion: true } : {}) },
      })
    }
  } finally {
    process.chdir(root)
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      package: { type: 'string' },
      version: { type: 'string' },
    },
  })
  await releaseWorkspace({ dryRun: values['dry-run'], packageName: values.package, version: values.version })
}
