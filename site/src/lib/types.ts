export interface Issue {
  url: string;
  title: string;
  org: string;
  repo: string;
  number: number;
  languages: string[];
  tags: string[];
  rawTags: string[];
  claimedInSheet: boolean;
}

export interface ClaimRecord {
  claimedBy: string | null;
  claimedAt: string | null;
  status: 'pending' | 'active';
  source: 'issue-form' | 'sheet-import' | 'staff';
  claimIssue: number | null;
}

export type IssueState = 'open' | 'closed' | 'missing';

export interface IssueStatus {
  state: IssueState;
  stateReason: string | null;
  assigned: boolean;
  updatedAt: string | null;
}

export type PolicyStatus = 'disallows' | 'conditional' | 'allows' | 'unverified';

export interface RepoPolicy {
  status: PolicyStatus;
  sourceUrl?: string;
  note?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface ScanHit {
  path: string;
  keyword: string;
  snippet: string;
  url: string;
}

export interface ScanEntry {
  scannedAt: string;
  error: string | null;
  hits: ScanHit[];
}

export interface TrackerConfig {
  trackerOwner: string;
  trackerRepo: string;
  claimMode: 'review' | 'auto';
  maxActiveClaimsPerUser: number;
}

export interface MergedIssue extends Issue {
  repoKey: string;
  claims: ClaimRecord[];
  claimed: boolean;
  state: IssueState;
  stateReason: string | null;
  assigned: boolean;
  updatedAt: string | null;
  policy: PolicyStatus;
  policyDetail: RepoPolicy | null;
  searchBlob: string;
}

export interface DataBundle {
  issues: MergedIssue[];
  config: TrackerConfig;
  policies: Record<string, RepoPolicy>;
  scan: { generatedAt: string | null; repos: Record<string, ScanEntry> };
  statusGeneratedAt: string | null;
  issuesGeneratedAt: string | null;
}
