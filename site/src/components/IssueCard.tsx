import type { MergedIssue } from '../lib/types';
import Highlight from './Highlight';
import PolicyBadge from './PolicyBadge';
import StateBadge from './StateBadge';

function claimantsLabel(issue: MergedIssue): string {
  const names = issue.claims.map((c) => (c.claimedBy ? `@${c.claimedBy}` : 'class sheet'));
  if (!names.length) return '';
  const pending = issue.claims.some((c) => c.status === 'pending');
  const first = names[0];
  const extra = names.length > 1 ? ` +${names.length - 1} more` : '';
  return `Claimed by ${first}${extra}${pending ? ' (pending review)' : ''}`;
}

export default function IssueCard({
  issue,
  tokens,
  flash,
  onPickTag,
  onPickLang,
  onClaim,
}: {
  issue: MergedIssue;
  tokens: string[];
  flash: boolean;
  onPickTag: (tag: string) => void;
  onPickLang: (lang: string) => void;
  onClaim: (issue: MergedIssue) => void;
}) {
  const claimable = issue.state === 'open';
  return (
    <article className={`issue-card${flash ? ' flash' : ''}`} id={`issue-${issue.number}-${issue.repo}`}>
      <div className="issue-card-main">
        <h3 className="issue-title">
          <a href={issue.url} target="_blank" rel="noreferrer">
            <Highlight text={issue.title} tokens={tokens} />
          </a>
        </h3>
        <div className="issue-repo">
          <Highlight text={`${issue.org}/${issue.repo}`} tokens={tokens} />
          <span className="issue-number">#{issue.number}</span>
        </div>
        <div className="issue-chips">
          {issue.languages.map((lang) => (
            <button key={lang} className="chip chip-lang" onClick={() => onPickLang(lang)} title={`Filter by ${lang}`}>
              {lang}
            </button>
          ))}
          {issue.tags.slice(0, 6).map((tag) => (
            <button key={tag} className="chip chip-tag" onClick={() => onPickTag(tag)} title={`Filter by "${tag}"`}>
              {tag}
            </button>
          ))}
          {issue.tags.length > 6 && <span className="chip chip-more">+{issue.tags.length - 6}</span>}
        </div>
      </div>
      <div className="issue-card-side">
        <div className="issue-badges">
          <PolicyBadge issue={issue} />
          <StateBadge issue={issue} />
        </div>
        {issue.claimed ? (
          <div className="issue-claimed">
            <span className="badge badge-claimed" title={issue.claims.map((c) => c.claimedBy ?? 'class sheet').join(', ')}>
              {claimantsLabel(issue)}
            </span>
            {claimable && (
              <button className="btn-link btn-claim-anyway" onClick={() => onClaim(issue)}>
                claim anyway…
              </button>
            )}
          </div>
        ) : (
          claimable && (
            <button className="btn btn-primary" onClick={() => onClaim(issue)}>
              Claim
            </button>
          )
        )}
        {issue.updatedAt && (
          <div className="issue-updated">updated {new Date(issue.updatedAt).toLocaleDateString()}</div>
        )}
      </div>
    </article>
  );
}
