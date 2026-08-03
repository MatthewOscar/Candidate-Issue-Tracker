import { useMemo } from 'react';
import { buildPolicyReportUrl, trackerIssuesUrl } from '../lib/claimLinks';
import type { PolicyStatus, RepoPolicy, ScanEntry } from '../lib/types';
import { useData } from '../lib/useData';
import './review.css';

const POLICY_BADGE: Record<PolicyStatus, string> = {
  allows: 'badge-policy-allows',
  conditional: 'badge-policy-conditional',
  disallows: 'badge-policy-disallows',
  unverified: 'badge-policy-unverified',
};

function ScanRepo({
  repoKey,
  entry,
  policy,
  editUrl,
}: {
  repoKey: string;
  entry: ScanEntry;
  policy: RepoPolicy | undefined;
  editUrl: string;
}) {
  return (
    <details className="scan-repo">
      <summary>
        <span className="scan-repo-name">
          <a href={`https://github.com/${repoKey}`} target="_blank" rel="noreferrer">
            {repoKey}
          </a>
          {entry.error && <span className="scan-error"> ({entry.error})</span>}
        </span>
        <span className="scan-meta">
          {entry.hits.length} hit{entry.hits.length === 1 ? '' : 's'}
          {' · '}
          <span className={`badge ${POLICY_BADGE[policy?.status ?? 'unverified']}`}>
            {policy?.status ?? 'unverified'}
          </span>
        </span>
      </summary>
      <ul className="scan-hits">
        {entry.hits.map((hit, i) => (
          <li key={i}>
            <a href={hit.url} target="_blank" rel="noreferrer">
              <code>{hit.path}</code>
            </a>{' '}
            · keyword <strong>{hit.keyword}</strong>
            <blockquote>{hit.snippet}</blockquote>
          </li>
        ))}
      </ul>
      <p className="scan-actions">
        <a href={editUrl} target="_blank" rel="noreferrer">
          Curate in ai-policies.json →
        </a>
      </p>
    </details>
  );
}

export default function ReviewPage() {
  const { data, error } = useData();

  const queue = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.scan.repos)
      .filter(([, entry]) => entry.hits.length > 0 || entry.error)
      .sort(([ka, a], [kb, b]) => {
        const curatedA = ka in data.policies ? 1 : 0;
        const curatedB = kb in data.policies ? 1 : 0;
        return curatedA - curatedB || b.hits.length - a.hits.length;
      });
  }, [data]);

  if (error) return <div className="callout callout-error">Failed to load data: {error}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const cfg = data.config;
  const editUrl = `https://github.com/${cfg.trackerOwner}/${cfg.trackerRepo}/edit/main/data/ai-policies.json`;
  const curated = Object.entries(data.policies).sort(([a], [b]) => a.localeCompare(b));
  const scannedCount = Object.keys(data.scan.repos).length;

  return (
    <div className="review">
      <h1>Staff review</h1>
      <p className="review-intro">
        Everything here is public but staff-operated: claims are decided with{' '}
        <code>/approve</code> / <code>/deny reason…</code> comments on the claim issues below, and
        AI-policy findings are promoted into{' '}
        <a href={editUrl} target="_blank" rel="noreferrer">
          <code>data/ai-policies.json</code>
        </a>{' '}
        (which is what students see as badges).
      </p>

      <section>
        <h2>Inboxes</h2>
        <ul className="inbox-links">
          <li>
            <a href={trackerIssuesUrl(cfg, 'claim:pending')} target="_blank" rel="noreferrer">
              Claims pending approval
            </a>{' '}
            — <code>/approve</code> or <code>/deny reason…</code>
          </li>
          <li>
            <a href={trackerIssuesUrl(cfg, 'claim:awaiting-confirm')} target="_blank" rel="noreferrer">
              Duplicate claims awaiting student confirmation
            </a>{' '}
            — student replies <code>/confirm</code>; staff can <code>/deny</code>
          </li>
          <li>
            <a href={trackerIssuesUrl(cfg, 'needs-staff')} target="_blank" rel="noreferrer">
              Needs staff
            </a>{' '}
            — sheet-era claims to verify or release by editing <code>data/claims.json</code>
          </li>
          <li>
            <a href={trackerIssuesUrl(cfg, 'policy-report')} target="_blank" rel="noreferrer">
              Student AI-policy reports
            </a>{' '}
            — verify the evidence, then curate; also{' '}
            <a href={buildPolicyReportUrl(cfg)} target="_blank" rel="noreferrer">
              file one
            </a>
          </li>
        </ul>
      </section>

      <section>
        <h2>AI-policy scanner queue</h2>
        <p className="review-note">
          {scannedCount === 0 ? (
            <>No scan has run yet — trigger the “AI policy scan” workflow from the Actions tab.</>
          ) : (
            <>
              {scannedCount.toLocaleString()} repos scanned · {queue.length} flagged for review
              (uncurated first). Scanner hits are <em>leads, not verdicts</em> — read the source
              before curating.
            </>
          )}
        </p>
        {queue.map(([repoKey, entry]) => (
          <ScanRepo
            key={repoKey}
            repoKey={repoKey}
            entry={entry}
            policy={data.policies[repoKey]}
            editUrl={editUrl}
          />
        ))}
      </section>

      <section>
        <h2>Curated policies ({curated.length})</h2>
        <table className="curated-table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>Status</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {curated.map(([repoKey, policy]) => (
              <tr key={repoKey}>
                <td>
                  <a href={`https://github.com/${repoKey}`} target="_blank" rel="noreferrer">
                    {repoKey}
                  </a>
                </td>
                <td>
                  <a href={policy.sourceUrl} target="_blank" rel="noreferrer" className="badge-link">
                    <span className={`badge ${POLICY_BADGE[policy.status]}`}>{policy.status}</span>
                  </a>
                </td>
                <td className="curated-note">{policy.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
