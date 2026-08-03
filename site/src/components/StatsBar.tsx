import type { DataBundle } from '../lib/types';

export default function StatsBar({ data }: { data: DataBundle }) {
  const total = data.issues.length;
  const claimed = data.issues.filter((i) => i.claimed).length;
  const solved = data.issues.filter((i) => i.state !== 'open').length;
  const available = data.issues.filter((i) => !i.claimed && i.state === 'open').length;
  const asOf = data.statusGeneratedAt
    ? new Date(data.statusGeneratedAt).toLocaleDateString()
    : null;
  return (
    <div className="stats-bar">
      <div className="stat">
        <strong>{available.toLocaleString()}</strong>
        <span>available</span>
      </div>
      <div className="stat">
        <strong>{claimed.toLocaleString()}</strong>
        <span>claimed</span>
      </div>
      <div className="stat">
        <strong>{solved.toLocaleString()}</strong>
        <span>closed upstream</span>
      </div>
      <div className="stat">
        <strong>{total.toLocaleString()}</strong>
        <span>total in pool</span>
      </div>
      {asOf && <div className="stats-asof">issue status as of {asOf}</div>}
    </div>
  );
}
