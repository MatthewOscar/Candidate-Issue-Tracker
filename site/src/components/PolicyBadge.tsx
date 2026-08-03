import type { MergedIssue } from '../lib/types';

const LABELS: Record<string, { text: string; cls: string; hint: string }> = {
  allows: {
    text: 'AI OK',
    cls: 'badge-policy-allows',
    hint: 'This repo explicitly allows AI-assisted contributions (per staff-verified source).',
  },
  conditional: {
    text: 'AI: conditions',
    cls: 'badge-policy-conditional',
    hint: 'AI-assisted contributions are allowed with conditions — read the linked policy before starting.',
  },
  disallows: {
    text: 'No AI contributions',
    cls: 'badge-policy-disallows',
    hint: 'This repo rejects AI-assisted contributions. Pick a different issue for this course.',
  },
  unverified: {
    text: 'AI policy unknown',
    cls: 'badge-policy-unverified',
    hint: 'No verified info — unknown does NOT mean safe. Check CONTRIBUTING before you start.',
  },
};

export default function PolicyBadge({ issue }: { issue: MergedIssue }) {
  const meta = LABELS[issue.policy];
  const note = issue.policyDetail?.note;
  const title = note ? `${meta.hint}\n\n${note}` : meta.hint;
  const badge = (
    <span className={`badge ${meta.cls}`} title={title}>
      {meta.text}
    </span>
  );
  const src = issue.policyDetail?.sourceUrl;
  return src ? (
    <a href={src} target="_blank" rel="noreferrer" className="badge-link">
      {badge}
    </a>
  ) : (
    badge
  );
}
