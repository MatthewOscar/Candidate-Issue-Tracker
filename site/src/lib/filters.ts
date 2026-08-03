import type { MergedIssue, PolicyStatus } from './types';

export interface Filters {
  q: string;
  langs: string[];
  tags: string[];
  /** Policy statuses to include. */
  policy: PolicyStatus[];
  showClaimed: boolean;
  showClosed: boolean;
  /** GitHub username — "my claims" view; overrides the show* toggles. */
  by: string;
  page: number;
}

export const ALL_POLICIES: PolicyStatus[] = ['allows', 'conditional', 'unverified', 'disallows'];
/** Default: everything except repos known to reject AI-assisted work. */
export const DEFAULT_POLICIES: PolicyStatus[] = ['allows', 'conditional', 'unverified'];

export const PAGE_SIZE = 50;

export const DEFAULT_FILTERS: Filters = {
  q: '',
  langs: [],
  tags: [],
  policy: DEFAULT_POLICIES,
  showClaimed: false,
  showClosed: false,
  by: '',
  page: 1,
};

const samePolicySet = (a: PolicyStatus[], b: PolicyStatus[]) =>
  a.length === b.length && a.every((p) => b.includes(p));

/** Compact, shareable URL encoding; defaults are omitted. */
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.langs.length) p.set('langs', f.langs.join(','));
  if (f.tags.length) p.set('tags', f.tags.join(','));
  if (!samePolicySet(f.policy, DEFAULT_POLICIES)) p.set('policy', f.policy.join(','));
  if (f.showClaimed) p.set('claimed', '1');
  if (f.showClosed) p.set('closed', '1');
  if (f.by) p.set('by', f.by);
  if (f.page > 1) p.set('page', String(f.page));
  return p;
}

export function filtersFromParams(p: URLSearchParams): Filters {
  const list = (key: string) =>
    (p.get(key) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const policy = list('policy').filter((s): s is PolicyStatus =>
    (ALL_POLICIES as string[]).includes(s),
  );
  return {
    q: p.get('q') ?? '',
    langs: list('langs'),
    tags: list('tags'),
    policy: policy.length ? policy : DEFAULT_POLICIES,
    showClaimed: p.get('claimed') === '1',
    showClosed: p.get('closed') === '1',
    by: p.get('by') ?? '',
    page: Math.max(1, Number(p.get('page')) || 1),
  };
}

export function tokenize(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Relevance score for a search token set; 0 means "does not match".
 * Every token must match somewhere (AND); weight by where it matched.
 */
export function scoreIssue(issue: MergedIssue, tokens: string[]): number {
  if (!tokens.length) return 1;
  let score = 0;
  const title = issue.title.toLowerCase();
  const repoLine = `${issue.org}/${issue.repo}`.toLowerCase();
  const tagLine = `${issue.tags.join(' ')} ${issue.languages.join(' ')}`.toLowerCase();
  for (const token of tokens) {
    if (title.includes(token)) score += 3;
    else if (repoLine.includes(token)) score += 2;
    else if (tagLine.includes(token)) score += 1;
    else return 0;
  }
  return score;
}

export interface FilterResult {
  issue: MergedIssue;
  score: number;
}

export function applyFilters(issues: MergedIssue[], f: Filters): FilterResult[] {
  const tokens = tokenize(f.q);
  const by = f.by.trim().toLowerCase();
  const results: FilterResult[] = [];

  for (const issue of issues) {
    if (by) {
      // "My claims" view: only this user's claims, regardless of other toggles.
      if (!issue.claims.some((c) => c.claimedBy?.toLowerCase() === by)) continue;
    } else {
      if (!f.showClaimed && issue.claimed) continue;
      if (!f.showClosed && issue.state !== 'open') continue;
      if (!f.policy.includes(issue.policy)) continue;
      if (f.langs.length && !f.langs.some((l) => issue.languages.includes(l))) continue;
      if (f.tags.length && !f.tags.some((t) => issue.tags.includes(t))) continue;
    }
    const score = scoreIssue(issue, tokens);
    if (score === 0) continue;
    results.push({ issue, score });
  }

  const time = (i: MergedIssue) => (i.updatedAt ? Date.parse(i.updatedAt) : 0);
  if (tokens.length) {
    results.sort((a, b) => b.score - a.score || time(b.issue) - time(a.issue));
  } else {
    results.sort((a, b) => time(b.issue) - time(a.issue));
  }
  return results;
}

/** Facet counts over the issues that pass every OTHER filter dimension. */
export function facetCounts(
  issues: MergedIssue[],
  f: Filters,
): { langs: Map<string, number>; tags: Map<string, number> } {
  const tokens = tokenize(f.q);
  const langs = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const issue of issues) {
    if (f.by) break; // facets are hidden in "my claims" view
    if (!f.showClaimed && issue.claimed) continue;
    if (!f.showClosed && issue.state !== 'open') continue;
    if (!f.policy.includes(issue.policy)) continue;
    if (scoreIssue(issue, tokens) === 0) continue;
    for (const l of issue.languages) langs.set(l, (langs.get(l) ?? 0) + 1);
    for (const t of issue.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  return { langs, tags };
}
