import { useMemo, useState } from 'react';

/** Top-N tag checkboxes plus a type-ahead over the long tail. */
export default function TagPicker({
  counts,
  selected,
  onToggle,
}: {
  counts: Map<string, number>;
  selected: string[];
  onToggle: (tag: string) => void;
}) {
  const [query, setQuery] = useState('');
  const sorted = useMemo(
    () => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [counts],
  );
  const top = sorted.slice(0, 20);
  const q = query.trim().toLowerCase();
  const tail = q
    ? sorted.filter(([tag]) => tag.includes(q) && !top.some(([t]) => t === tag)).slice(0, 12)
    : [];
  // Selected tags always stay visible even when filtered out of the top list.
  const pinned = selected.filter((t) => !top.some(([tag]) => tag === t));

  const box = (tag: string, count?: number) => (
    <label key={tag} className="facet-option">
      <input type="checkbox" checked={selected.includes(tag)} onChange={() => onToggle(tag)} />
      <span className="facet-label">{tag}</span>
      {count !== undefined && <span className="facet-count">{count.toLocaleString()}</span>}
    </label>
  );

  return (
    <div>
      {pinned.map((tag) => box(tag, counts.get(tag) ?? 0))}
      {top.map(([tag, count]) => box(tag, count))}
      <input
        className="facet-search"
        type="search"
        placeholder={`Search ${Math.max(sorted.length - 20, 0)} more tags…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {tail.map(([tag, count]) => box(tag, count))}
      {q && !tail.length && <div className="facet-empty">No matching tags</div>}
    </div>
  );
}
