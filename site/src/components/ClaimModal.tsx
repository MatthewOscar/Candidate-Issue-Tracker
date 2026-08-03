import { useEffect } from 'react';
import { buildClaimUrl, buildUnclaimUrl } from '../lib/claimLinks';
import type { DataBundle, MergedIssue } from '../lib/types';
import PolicyBadge from './PolicyBadge';

export default function ClaimModal({
  issue,
  data,
  savedUser,
  onClose,
}: {
  issue: MergedIssue;
  data: DataBundle;
  savedUser: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const alreadyClaimed = issue.claimed;
  const mine = savedUser
    ? issue.claims.some((c) => c.claimedBy?.toLowerCase() === savedUser.toLowerCase())
    : false;
  const claimants = issue.claims
    .map((c) => (c.claimedBy ? `@${c.claimedBy}` : 'someone via the class sheet'))
    .join(', ');
  const claimUrl = buildClaimUrl(data.config, issue, { acknowledgeDuplicate: alreadyClaimed });
  const contributingUrl = `https://github.com/${issue.repoKey}/blob/HEAD/CONTRIBUTING.md`;
  const review = data.config.claimMode === 'review';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>Claim this issue</h2>
        <p className="modal-issue">
          <a href={issue.url} target="_blank" rel="noreferrer">
            {issue.org}/{issue.repo}#{issue.number}
          </a>{' '}
          — {issue.title}
        </p>
        <p className="modal-policy">
          <PolicyBadge issue={issue} />
          {issue.policy === 'unverified' && (
            <span className="modal-policy-note">
              Unknown does <strong>not</strong> mean safe — check their docs before you invest time.
            </span>
          )}
          {issue.policyDetail?.note && <span className="modal-policy-note">{issue.policyDetail.note}</span>}
        </p>

        {alreadyClaimed && (
          <div className="callout callout-warn">
            <strong>Heads up:</strong> this issue is already claimed by {claimants}.{' '}
            {mine
              ? 'That includes you — no need to claim again.'
              : 'Working the same issue as another student is discouraged (this rule exists to protect you from duplicated effort and lost credit). You can still proceed — the form will include your acknowledgement.'}
          </div>
        )}

        <ol className="claim-steps">
          <li>
            <strong>Read the repo's contributing guide</strong> and double-check its AI policy —{' '}
            <a href={contributingUrl} target="_blank" rel="noreferrer">
              CONTRIBUTING.md
            </a>
            .
          </li>
          <li>
            <strong>Submit the claim form on GitHub</strong> (pre-filled; you just sign in to GitHub
            and submit). The bot confirms in ~1 minute{review ? ', and staff give final approval' : ''};
            the site shows it claimed within ~3 minutes.
          </li>
          <li>
            <strong>Introduce yourself on the upstream issue — in your own words.</strong> Tell the
            maintainers who you are and how you plan to help.{' '}
            <em>This site never posts anything to the project for you</em>; a hand-written intro is
            part of the assignment.
          </li>
        </ol>

        <div className="modal-actions">
          <a
            className={`btn ${alreadyClaimed ? 'btn-warn' : 'btn-primary'}`}
            href={claimUrl}
            target="_blank"
            rel="noreferrer"
          >
            {alreadyClaimed ? 'Open claim form anyway →' : 'Open claim form on GitHub →'}
          </a>
          {mine && (
            <a className="btn btn-secondary" href={buildUnclaimUrl(data.config, issue)} target="_blank" rel="noreferrer">
              Unclaim instead
            </a>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
