# DSH plugins

- This is a pnpm/Turborepo workspace. Each `packages/*` directory is an independently packaged DeepSeek Harness plugin; shared tooling lives in `tools/*`.
- Preserve the pinned pnpm/Node versions in `devEngines`. Use Oxfmt and type-aware Oxlint, not Prettier. Package TypeScript configs extend `@dungsil/dsh-tsconfig`.
- Use the public Harness/Cordis plugin APIs. Do not patch the host UI or bundle host services into client plugins.
- Run `pnpm check` and pack the changed package before delivery.
- For Korean copy, preserve namespace keys, `{placeholders}`, command names, and API identifiers. Keep the upstream English fixtures and Korean keys in sync.
- `pnpm dev` uses an isolated `.dsh-dev` home, never the user's existing Harness profile. It does not require an API key for UI checks.
