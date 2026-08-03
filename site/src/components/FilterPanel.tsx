import { useMemo, useState } from 'react';
import type { Filters } from '../lib/filters';
import { ALL_POLICIES } from '../lib/filters';
import type { PolicyStatus } from '../lib/types';
import TagPicker from './TagPicker';

const POLICY_LABEL: Record<PolicyStatus, string> = {
  allows: 'Explicitly allows AI',
  conditional: 'Allows with conditions',
  unverified: 'Policy unknown',
  disallows: 'Rejects AI work',
};

export default function FilterPanel({
  filters,
  langCounts,
  tagCounts,
  savedUser,
  onChange,
  onSetUser,
}: {
  filters: Filters;
  langCounts: Map<string, number>;
  tagCounts: Map<string, number>;
  savedUser: string;
  onChange: (patch: Partial<Filters>) => void;
  onSetUser: (username: string) => void;
}) {
  const [userDraft, setUserDraft] = useState(savedUser);
  const langsSorted = useMemo(
    () => [...langCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [langCounts],
  );
  const [showAllLangs, setShowAllLangs] = useState(false);
  const langs = showAllLangs ? langsSorted : langsSorted.slice(0, 12);

  const toggle = (key: 'langs' | 'tags' | 'policy', value: string) => {
    const current = filters[key] as string[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ [key]: next } as Partial<Filters>);
  };

  const myClaimsActive = Boolean(filters.by);

  return (
    <aside className="filter-panel">
      <section className="facet">
        <h3>My claims</h3>
        <form
          className="user-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSetUser(userDraft.trim());
            onChange({ by: userDraft.trim() });
          }}
        >
          <input
            type="text"
            placeholder="Your GitHub username"
            value={userDraft}
            onChange={(e) => setUserDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-small">
            View
          </button>
        </form>
        {myClaimsActive && (
          <button className="btn-link" onClick={() => onChange({ by: '' })}>
            ← Back to all issues
          </button>
        )}
      </section>

      {!myClaimsActive && (
        <>
          <section className="facet">
            <h3>AI contribution policy</h3>
            {ALL_POLICIES.map((p) => (
              <label key={p} className="facet-option">
                <input
                  type="checkbox"
                  checked={filters.policy.includes(p)}
                  onChange={() => toggle('policy', p)}
                />
                <span className={`facet-label policy-${p}`}>{POLICY_LABEL[p]}</span>
              </label>
            ))}
          </section>

          <section className="facet">
            <h3>Availability</h3>
            <label className="facet-option">
              <input
                type="checkbox"
                checked={filters.showClaimed}
                onChange={(e) => onChange({ showClaimed: e.target.checked })}
              />
              <span className="facet-label">Show claimed issues</span>
            </label>
            <label className="facet-option">
              <input
                type="checkbox"
                checked={filters.showClosed}
                onChange={(e) => onChange({ showClosed: e.target.checked })}
              />
              <span className="facet-label">Show closed / unavailable</span>
            </label>
          </section>

          <section className="facet">
            <h3>Language</h3>
            {langs.map(([lang, count]) => (
              <label key={lang} className="facet-option">
                <input
                  type="checkbox"
                  checked={filters.langs.includes(lang)}
                  onChange={() => toggle('langs', lang)}
                />
                <span className="facet-label">{lang}</span>
                <span className="facet-count">{count.toLocaleString()}</span>
              </label>
            ))}
            {langsSorted.length > 12 && (
              <button className="btn-link" onClick={() => setShowAllLangs((v) => !v)}>
                {showAllLangs ? 'Show fewer' : `Show all ${langsSorted.length} languages`}
              </button>
            )}
          </section>

          <section className="facet">
            <h3>Tags</h3>
            <TagPicker counts={tagCounts} selected={filters.tags} onToggle={(t) => toggle('tags', t)} />
          </section>
        </>
      )}
    </aside>
  );
}
