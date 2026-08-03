import { useEffect, useState } from 'react';
import type {
  ClaimRecord,
  DataBundle,
  Issue,
  IssueStatus,
  MergedIssue,
  RepoPolicy,
  ScanEntry,
  TrackerConfig,
} from './types';

const DATA_FILES = [
  'issues.json',
  'claims.json',
  'status.json',
  'ai-policies.json',
  'ai-policy-scan.json',
  'config.json',
] as const;

async function fetchJson(name: string): Promise<unknown> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`failed to load ${name}: HTTP ${res.status}`);
  return res.json();
}

function merge(
  issuesDoc: { generatedAt: string | null; issues: Issue[] },
  claimsDoc: { claims: Record<string, ClaimRecord[]> },
  statusDoc: { generatedAt: string | null; statuses: Record<string, IssueStatus> },
  policiesDoc: { repos: Record<string, RepoPolicy> },
  scanDoc: { generatedAt: string | null; repos: Record<string, ScanEntry> },
  config: TrackerConfig,
): DataBundle {
  const issues: MergedIssue[] = issuesDoc.issues.map((issue) => {
    const repoKey = `${issue.org.toLowerCase()}/${issue.repo.toLowerCase()}`;
    const claims = claimsDoc.claims[issue.url] ?? [];
    const status = statusDoc.statuses[issue.url];
    const policyDetail = policiesDoc.repos[repoKey] ?? null;
    return {
      ...issue,
      repoKey,
      claims,
      claimed: claims.length > 0,
      state: status?.state ?? 'open',
      stateReason: status?.stateReason ?? null,
      assigned: status?.assigned ?? false,
      updatedAt: status?.updatedAt ?? null,
      policy: policyDetail?.status ?? 'unverified',
      policyDetail,
      searchBlob: [
        issue.title,
        issue.org,
        issue.repo,
        `${issue.org}/${issue.repo}`,
        issue.languages.join(' '),
        issue.tags.join(' '),
      ]
        .join(' \n ')
        .toLowerCase(),
    };
  });
  return {
    issues,
    config,
    policies: policiesDoc.repos,
    scan: scanDoc,
    statusGeneratedAt: statusDoc.generatedAt,
    issuesGeneratedAt: issuesDoc.generatedAt,
  };
}

let cache: Promise<DataBundle> | null = null;

export function loadData(): Promise<DataBundle> {
  if (!cache) {
    cache = Promise.all(DATA_FILES.map(fetchJson)).then(
      ([issuesDoc, claimsDoc, statusDoc, policiesDoc, scanDoc, config]) =>
        merge(
          issuesDoc as Parameters<typeof merge>[0],
          claimsDoc as Parameters<typeof merge>[1],
          statusDoc as Parameters<typeof merge>[2],
          policiesDoc as Parameters<typeof merge>[3],
          scanDoc as Parameters<typeof merge>[4],
          config as TrackerConfig,
        ),
    );
    cache.catch(() => {
      cache = null; // allow retry after a failed load
    });
  }
  return cache;
}

export function useData(): { data: DataBundle | null; error: string | null } {
  const [data, setData] = useState<DataBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadData().then(
      (bundle) => alive && setData(bundle),
      (err) => alive && setError(String(err?.message ?? err)),
    );
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}
