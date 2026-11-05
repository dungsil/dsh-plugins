import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import conventionalCommits from 'conventional-changelog-conventionalcommits'
import release from 'release-it'
import semver from 'semver'

export function releaseOptions({ dryRun = false } = {}) {
  const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
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
        whatBump(commits) {
          const bump = conventionalCommits().whatBump(commits)
          // Keep feature and fix bumps unchanged; only cap breaking changes in 0.x.
          if (bump?.level === 0 && semver.major(version) === 0) bump.level = 1
          return bump
        },
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
  const releases = []
  try {
    // Publish dependencies first, but defer workspace Git and GitHub releases
    // until every manifest and changelog is ready for one commit.
    for (const pkg of selected) {
      process.chdir(pkg.path)
      const settings = releaseOptions({ dryRun })
      let increment = version
      if (!increment) {
        // Resolve the commit-based bump without changing manifests or publishing.
        const preview = await release({
          ...settings,
          ...options,
          'dry-run': true,
          quiet: true,
          hooks: {},
          npm: { ...settings.npm, ...options.npm, publish: false },
          git: {
            ...settings.git,
            requireBranch: false,
            commit: false,
            tag: false,
            push: false,
            requireCleanWorkingDir: releases.length === 0,
          },
          github: { release: false },
        })
        if (!preview.version) continue
        increment = preview.version
        let published = []
        try {
          published = JSON.parse(execFileSync('pnpm', ['view', pkg.name, 'versions', '--json'], { encoding: 'utf8' }))
        } catch (error) {
          // Only a missing package means there are no published versions.
          if (JSON.parse(error.stdout || '{}').error?.code !== 'ERR_PNPM_FETCH_404') throw error
        }
        const latest = semver.maxSatisfying(published, `>=${increment}`)
        if (latest) {
          // npm may have succeeded before the release commit/tags were pushed.
          // Publish fresh code under a new version, never relabel an old artifact.
          increment = semver.inc(latest, 'patch')
          console.log(`${pkg.name}: ${preview.version} is behind npm ${latest}; releasing ${increment}`)
        }
      }
      const result = await release({
        ...settings,
        ...options,
        increment,
        npm: { ...settings.npm, ...options.npm, ...(version ? { allowSameVersion: true } : {}) },
        git: {
          ...settings.git,
          commit: false,
          tag: false,
          push: false,
          requireCleanWorkingDir: releases.length === 0,
        },
        github: { ...settings.github, ...options.github, release: false },
      })
      if (result.version) releases.push({ pkg, settings, result })
    }
    if (!dryRun && releases.length > 0) {
      process.chdir(root)
      const git = (args) => execFileSync('git', args, { encoding: 'utf8' })
      git(['add', '--', ...releases.flatMap(({ pkg }) => [`${pkg.path}/package.json`, `${pkg.path}/CHANGELOG.md`])])
      const message = packageName
        ? `chore(release): ${packageName}@${releases[0].result.version} [skip ci]`
        : 'chore(release): 전체 패키지를 릴리즈한다 [skip ci]'
      git(['commit', '-m', message])
      for (const { pkg, result } of releases) {
        git(['tag', '--annotate', '--message', `Release ${result.version}`, `${pkg.name}@${result.version}`])
      }
      // Merge instead of rebasing: tags must keep identifying the source that was published.
      git(['fetch', 'origin', 'main'])
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const remoteHead = git(['rev-parse', 'origin/main']).trim()
        git(['merge', '--no-edit', '-m', 'chore(release): 원격 변경을 통합한다 [skip ci]', 'origin/main'])
        try {
          git(['push', '--follow-tags', '--atomic'])
          break
        } catch (error) {
          if (attempt === 2) throw error
          git(['fetch', 'origin', 'main'])
          // Retry only when main moved during the push, not on auth or tag errors.
          if (git(['rev-parse', 'origin/main']).trim() === remoteHead) throw error
        }
      }

      // Publish immutable GitHub releases only after all tags reach the remote.
      for (const { pkg, settings, result } of releases) {
        process.chdir(pkg.path)
        await release({
          ...settings,
          ...options,
          increment: false,
          plugins: {},
          hooks: {},
          git: { ...settings.git, commit: false, tag: false, push: false },
          npm: { ...settings.npm, publish: false },
          github: { ...settings.github, ...options.github, releaseNotes: () => result.changelog },
        })
      }
    }
  } finally {
    process.chdir(root)
  }
  return dryRun ? [] : releases.map(({ pkg }) => pkg.name)
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      package: { type: 'string' },
      version: { type: 'string' },
    },
  })
  const packages = await releaseWorkspace({
    dryRun: values['dry-run'],
    packageName: values.package,
    version: values.version,
  })
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `packages=${JSON.stringify(packages)}\n`)
  }
}
