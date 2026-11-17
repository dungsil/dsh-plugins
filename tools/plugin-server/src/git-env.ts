/**
 * Environment entries that redirect git or a forge CLI to a repository other
 * than the session working directory. Each entry must arrive unset so an
 * inherited value cannot escape the session cwd.
 */
const repositoryEnvKeys = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE',
  'GIT_ATTR_SOURCE',
] as const

/**
 * Hardened environment for spawning git or a forge CLI from a session cwd.
 * Config injection and terminal prompts are disabled, lazy fetch is off, and
 * output stays in the C locale so parsers can match stable English messages.
 * `extra` adds tool-specific entries, including bare keys set to undefined to
 * scrub inherited values.
 */
export function gitProcessEnvironment(
  extra: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(repositoryEnvKeys.map((key) => [key, undefined])),
    GIT_CONFIG_COUNT: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1',
    LC_ALL: 'C',
    ...extra,
  }
}
