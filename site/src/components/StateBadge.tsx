import type { MergedIssue } from '../lib/types';

export default function StateBadge({ issue }: { issue: MergedIssue }) {
  if (issue.state === 'closed') {
    const solved = issue.stateReason === 'completed';
    return (
      <span
        className={`badge ${solved ? 'badge-solved' : 'badge-closed'}`}
        title={`Closed upstream${issue.stateReason ? ` (${issue.stateReason})` : ''}`}
      >
        {solved ? 'Solved' : 'Closed'}
      </span>
    );
  }
  if (issue.state === 'missing') {
    return (
      <span className="badge badge-closed" title="The issue or repo is no longer reachable (moved, deleted, or made private).">
        Unavailable
      </span>
    );
  }
  if (issue.assigned) {
    return (
      <span
        className="badge badge-assigned"
        title="Someone is assigned upstream — maintainers may already have this in progress."
      >
        Has assignee
      </span>
    );
  }
  return null;
}
