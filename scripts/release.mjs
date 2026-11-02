import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import release from 'release-it'

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
    },
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } })
  const root = process.cwd()
  const packages = JSON.parse(execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], { encoding: 'utf8' }))
  try {
    // Each release commits its own manifest and changelog before the next starts.
    for (const pkg of packages.filter((pkg) => !pkg.private)) {
      process.chdir(pkg.path)
      await release(releaseOptions({ dryRun: values['dry-run'] }))
    }
  } finally {
    process.chdir(root)
  }
}
