import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ClaimModal from '../components/ClaimModal';
import FilterPanel from '../components/FilterPanel';
import IssueCard from '../components/IssueCard';
import Pagination from '../components/Pagination';
import StatsBar from '../components/StatsBar';
import {
  applyFilters,
  facetCounts,
  filtersFromParams,
  filtersToParams,
  PAGE_SIZE,
  tokenize,
  type Filters,
} from '../lib/filters';
import type { MergedIssue } from '../lib/types';
import { useData } from '../lib/useData';
import './browse.css';

const USER_KEY = 'ai301.githubUser';

const PRESETS: { label: string; patch: Partial<Filters> }[] = [
  { label: 'Python · good first issue', patch: { langs: ['Python'], tags: ['good first issue'] } },
  { label: 'JavaScript / TypeScript', patch: { langs: ['JavaScript', 'TypeScript'] } },
  { label: 'Docs & writing', patch: { tags: ['documentation'] } },
  { label: 'Rust', patch: { langs: ['Rust'] } },
  { label: 'C++', patch: { langs: ['C++'] } },
];

export default function BrowsePage() {
  const { data, error } = useData();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [savedUser, setSavedUser] = useState(() => localStorage.getItem(USER_KEY) ?? '');
  const [modalIssue, setModalIssue] = useState<MergedIssue | null>(null);
  const [flashUrl, setFlashUrl] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      setParams((prev) => {
        const next = { ...filtersFromParams(prev), ...patch };
        // Any filter change other than an explicit page jump resets pagination.
        if (!('page' in patch)) next.page = 1;
        return filtersToParams(next);
      });
    },
    [setParams],
  );

  // Deferred query keeps typing smooth while 6.6k rows re-filter.
  const deferredQ = useDeferredValue(filters.q);
  const effectiveFilters = useMemo(() => ({ ...filters, q: deferredQ }), [filters, deferredQ]);

  const results = useMemo(
    () => (data ? applyFilters(data.issues, effectiveFilters) : []),
    [data, effectiveFilters],
  );
  const facets = useMemo(
    () => (data ? facetCounts(data.issues, effectiveFilters) : { langs: new Map(), tags: new Map() }),
    [data, effectiveFilters],
  );
  const tokens = useMemo(() => tokenize(deferredQ), [deferredQ]);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const pageResults = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const surprise = () => {
    if (!results.length) return;
    const pick = results[Math.floor(Math.random() * results.length)].issue;
    const targetPage = Math.floor(results.findIndex((r) => r.issue.url === pick.url) / PAGE_SIZE) + 1;
    update({ page: targetPage });
    setFlashUrl(pick.url);
    setTimeout(() => setFlashUrl(null), 2500);
  };

  if (error) {
    return (
      <div className="callout callout-error">
        Failed to load issue data: {error}. Try refreshing; if it persists, the data files may be
        mid-update.
      </div>
    );
  }
  if (!data) return <div className="loading">Loading {`~6,600`} issues…</div>;

  return (
    <div>
      <section className="hero">
        <h1>Find your next open-source issue</h1>
        <p className="hero-sub">
          Curated for CodePath AI&nbsp;301 — filtered for AI-contribution policies, claim status, and
          whether the issue is still open.
        </p>
        <div className="hero-search">
          <input
            ref={searchRef}
            autoFocus
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder={`Search ${data.issues.length.toLocaleString()} issues — try "python docs", a repo name, or a tag  ( / )`}
            aria-label="Search issues"
          />
          <button className="btn btn-secondary" onClick={surprise} title="Jump to a random issue matching your filters">
            🎲 Surprise me
          </button>
        </div>
        <div className="preset-chips">
          {PRESETS.map((preset) => (
            <button key={preset.label} className="chip chip-preset" onClick={() => update(preset.patch)}>
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <StatsBar data={data} />

      <div className="browse-layout">
        <FilterPanel
          filters={filters}
          langCounts={facets.langs}
          tagCounts={facets.tags}
          savedUser={savedUser}
          onChange={update}
          onSetUser={(u) => {
            setSavedUser(u);
            localStorage.setItem(USER_KEY, u);
          }}
        />
        <div className="results">
          <div className="results-header">
            <span>
              <strong>{results.length.toLocaleString()}</strong>{' '}
              {filters.by ? `claim(s) by @${filters.by}` : 'matching issues'}
              {deferredQ !== filters.q && ' …'}
            </span>
            <Link to="/how" className="btn-link">
              How claiming works →
            </Link>
          </div>
          {pageResults.map(({ issue }) => (
            <IssueCard
              key={issue.url}
              issue={issue}
              tokens={tokens}
              flash={issue.url === flashUrl}
              onPickLang={(lang) =>
                update({ langs: filters.langs.includes(lang) ? filters.langs : [...filters.langs, lang] })
              }
              onPickTag={(tag) =>
                update({ tags: filters.tags.includes(tag) ? filters.tags : [...filters.tags, tag] })
              }
              onClaim={setModalIssue}
            />
          ))}
          {!results.length && (
            <div className="callout">
              No issues match. Try clearing a filter
              {filters.q && ' or shortening your search'}
              {!filters.showClaimed && ', or include claimed issues'}
              {!filters.showClosed && ', or include closed ones'}.{' '}
              <button className="btn-link" onClick={() => setParams(new URLSearchParams())}>
                Reset all filters
              </button>
            </div>
          )}
          <Pagination page={page} pageCount={pageCount} onPage={(p) => update({ page: p })} />
        </div>
      </div>

      {modalIssue && (
        <ClaimModal issue={modalIssue} data={data} savedUser={savedUser} onClose={() => setModalIssue(null)} />
      )}
    </div>
  );
}
