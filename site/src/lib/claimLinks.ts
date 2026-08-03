import type { MergedIssue, TrackerConfig } from './types';

// Field ids below must match .github/ISSUE_TEMPLATE/*.yml. GitHub prefills
// issue-form inputs/dropdowns from query params keyed by field id; required
// checkboxes are deliberately not prefillable (the pledge stays a live action).
export const DUPLICATE_ACK_VALUE =
  'Yes — I understand working a claimed issue is discouraged and want to proceed';

const newIssueBase = (cfg: TrackerConfig) =>
  `https://github.com/${cfg.trackerOwner}/${cfg.trackerRepo}/issues/new`;

export function buildClaimUrl(
  cfg: TrackerConfig,
  issue: MergedIssue,
  opts: { acknowledgeDuplicate?: boolean } = {},
): string {
  const p = new URLSearchParams({
    template: 'claim.yml',
    title: `Claim: ${issue.org}/${issue.repo}#${issue.number}`,
    issue_url: issue.url,
  });
  if (opts.acknowledgeDuplicate) p.set('duplicate_ack', DUPLICATE_ACK_VALUE);
  return `${newIssueBase(cfg)}?${p}`;
}

export function buildUnclaimUrl(cfg: TrackerConfig, issue: MergedIssue): string {
  const p = new URLSearchParams({
    template: 'unclaim.yml',
    title: `Unclaim: ${issue.org}/${issue.repo}#${issue.number}`,
    issue_url: issue.url,
  });
  return `${newIssueBase(cfg)}?${p}`;
}

export function buildPolicyReportUrl(cfg: TrackerConfig, repoKey?: string): string {
  const p = new URLSearchParams({ template: 'policy-report.yml' });
  if (repoKey) {
    p.set('title', `AI policy report: ${repoKey}`);
    p.set('repo_url', `https://github.com/${repoKey}`);
  }
  return `${newIssueBase(cfg)}?${p}`;
}

export function trackerIssuesUrl(cfg: TrackerConfig, label: string): string {
  return `https://github.com/${cfg.trackerOwner}/${cfg.trackerRepo}/issues?q=${encodeURIComponent(
    `is:issue is:open label:${label}`,
  )}`;
}
