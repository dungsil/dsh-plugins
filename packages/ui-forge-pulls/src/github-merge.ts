import type { ChangeRequestSnapshot } from '@deepseek-ai/dsh-experimental-forge/types'
import type { MergeMethod, RequestItem } from './protocol.js'

// The provider can collapse unknown check context types into the rollup. Confirm the
// entire GraphQL connection separately rather than treating that rollup as complete.
export const checksQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    headRefOid commits(last: 1) { nodes { commit { oid statusCheckRollup {
      state contexts(first: 100) { pageInfo { hasNextPage } nodes {
        __typename ... on CheckRun { status conclusion } ... on StatusContext { state }
      } }
    } } } }
  } }
}`

export function completeChecks(value: any, sha: string): boolean {
  const pr = value?.data?.repository?.pullRequest
  if (value?.errors || pr?.headRefOid !== sha || !Array.isArray(pr?.commits?.nodes) || pr.commits.nodes.length !== 1)
    return false
  const commit = pr.commits.nodes[0]?.commit
  if (!commit || commit.oid !== sha || !Object.hasOwn(commit, 'statusCheckRollup')) return false
  const rollup = commit.statusCheckRollup
  if (rollup === null) return true
  if (rollup?.state !== 'SUCCESS') return false
  const contexts = rollup.contexts
  if (contexts?.pageInfo?.hasNextPage !== false || !Array.isArray(contexts.nodes) || contexts.nodes.length === 0)
    return false
  // The forge provider selects the latest run for each check; older failed runs
  // may legitimately remain in this connection after a successful rerun.
  return contexts.nodes.every((check: any) => ['CheckRun', 'StatusContext'].includes(check?.__typename))
}

export function mergeMethods(snapshot: ChangeRequestSnapshot | undefined, item: RequestItem): MergeMethod[] {
  if (
    !snapshot ||
    snapshot.url !== item.url ||
    snapshot.ref.repository.forge !== 'github' ||
    snapshot.ref.number !== item.number ||
    snapshot.headSha !== item.headSha ||
    snapshot.headBranch !== item.source ||
    snapshot.baseBranch !== item.target ||
    snapshot.state !== 'open' ||
    snapshot.draft !== false ||
    snapshot.mergeReady !== true ||
    snapshot.mergeability !== 'mergeable' ||
    snapshot.checksTruncated !== false ||
    !['none', 'success'].includes(snapshot.checksRollup) ||
    !['none', 'approved'].includes(snapshot.reviewDecision) ||
    !Array.isArray(snapshot.checks) ||
    !snapshot.checks.every((check) => ['success', 'neutral', 'skipped'].includes(check.state)) ||
    !Array.isArray(snapshot.mergeMethods)
  )
    return []
  return snapshot.mergeMethods.filter((method): method is MergeMethod => ['merge', 'squash', 'rebase'].includes(method))
}
