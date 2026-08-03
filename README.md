# AI 301 Issue Finder

A search-first website for the CodePath AI 301 course issue pool: students find open-source
GitHub issues that fit them, claim them self-serve (tied to their GitHub account), and see two
things the old spreadsheet couldn't tell them — whether an issue is **still open upstream**, and
whether the repo **accepts AI-assisted contributions** (several students have had finished work
rejected purely over AI usage).

**Live site:** `https://matthewoscar.github.io/Candidate-Issue-Tracker/` (once Pages is enabled — see
[Going live](#going-live)).

Everything runs on GitHub: the site is static (Vite + React on GitHub Pages), the data is JSON in
[`data/`](data/), and GitHub Actions are the only backend. No servers, no databases, no secrets
beyond the built-in `GITHUB_TOKEN`.

## How students use it

1. **Browse** — search ~6,600 issues by title/repo/tag/language. Defaults hide claimed issues,
   closed issues, and repos verified to reject AI work.
2. **Claim** — the Claim button opens a pre-filled issue form in this repo; submitting it while
   signed into GitHub records the claim under their username within ~1 minute (site updates in
   ~3). One active claim per student by default.
3. **Introduce themselves upstream — in their own words.** The tracker never posts anything to
   the upstream project; the confirmation comment and UI say so explicitly and link the repo's
   CONTRIBUTING guide first.
4. **Unclaim** when done (or stepping back) via the unclaim form; a merged-PR unclaim gets a
   little celebration.

Multiple students *may* work the same issue but it's discouraged (it protects them from
duplicated effort): the site and bot warn, and proceeding requires an explicit acknowledgement
(`duplicate_ack` in the form, or replying `/confirm`).

## Staff guide

### Reviewing claims

`data/config.json` → `claimMode`:

- `"review"` (default): claims record instantly as **pending** (they block the pool immediately
  and the student can start), and the claim issue stays open as your inbox. Comment `/approve`
  or `/deny optional reason…` on it. Deny releases the issue back to the pool.
- `"auto"`: claims auto-approve and close. `/deny reason…` still works retroactively on the
  closed claim issue.

Commands are honored only from accounts with **write access** to this repo (checked against the
collaborators API, not just the comment's author association). The site's **Staff review** page
links every inbox: pending claims, duplicate-confirmations, `needs-staff` items (sheet-era
claims with no username — verify and resolve by editing `data/claims.json`), and student
policy reports.

### AI-policy curation

- A weekly Action scans every pool repo's contribution docs for AI-policy language into
  `data/ai-policy-scan.json` — that's a **review queue**, never shown to students as a verdict.
- You promote confirmed findings into [`data/ai-policies.json`](data/ai-policies.json)
  (statuses: `disallows` / `conditional` / `allows`; everything else is `unverified`). Cite the
  `sourceUrl` — the badge links to it.
- Students file rejection reports via the `policy-report` issue form; verify the evidence, then
  curate.

### Refreshing the issue pool

One click: **Actions → "Refresh pool from sheet" → Run workflow.** It downloads the Google
Sheet's xlsx export, re-runs the gated import, posts a reconciliation + orphaned-claims report
to the run summary, and redeploys. Set it up once by creating a repository **variable**
`SHEET_EXPORT_URL` = `https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=xlsx`
(the sheet must be link-viewable). Claims are never touched by a refresh; claims whose issue
left the pool are only removed if you check *prune orphan claims*.

Manual fallback: `npm ci && npm run import -- --in path/to/export.xlsx` and commit the result.
First-time seeding from a sheet also takes `--seed-claims` (only writes when `claims.json` is
empty).

### Moderation

- `data/blocklist.json`: GitHub usernames barred from claiming.
- Any claim can be reverted with `/deny` on its claim issue, or by editing `data/claims.json`
  directly (git history is the audit log). `validate-data` gates every deploy, so a malformed
  hand-edit fails the build and leaves the last good site up.

## Going live

1. Repo must be **public** with **Issues enabled**.
2. **Settings → Pages → Source: "GitHub Actions".**
3. Bootstrap the labels: **Actions → Claims → Run workflow** (once, right after merging). The
   run creates every pipeline label (`claim`, `unclaim`, `claim:pending`, …). This matters
   because GitHub silently drops template labels that don't exist yet — a claim opened before
   the labels exist would be invisible to the processor.
4. Set the `SHEET_EXPORT_URL` repository variable (see above).
5. Merge to `main`. The deploy workflow publishes the site.
6. Smoke-test the pipeline:
   - **Actions → Status sync → Run workflow** with `dry_run` + `limit: 200` (probe; verify the
     log), then run it for real.
   - **Actions → AI policy scan → Run workflow** with `limit: 10`, then for real.
   - Open a claim through the site with a test account: expect the bot confirmation in ~1 min,
     `/approve` it, and see the site flip to Claimed in ~3 min.
7. Note: GitHub disables cron workflows after ~60 days without repo activity (e.g. term break) —
   re-enable them from the Actions tab.

## Development

```bash
npm ci
npm test            # vitest: importer, canonicalizer, claim ladder, scanner, form parser
npm run dev         # local site at http://localhost:5173
npm run build       # typecheck + production build into dist/
npm run validate:data
```

Repo layout: `site/` (Vite + React SPA) · `data/` (canonical JSON, the site's database) ·
`shared/` (URL canonicalizer, tag normalizer, issue-form parser — used by scripts, Actions, and
the site) · `scripts/` (import + the Action entrypoints; dependency-free except the importer) ·
`.github/workflows/` (claims, status-sync, policy-scan, refresh-pool, deploy, ci).

Two Actions design rules worth knowing before you refactor
([`deploy.yml`](.github/workflows/deploy.yml) and
[`claims.yml`](.github/workflows/claims.yml) explain them inline): pushes made with
`GITHUB_TOKEN` trigger no workflows, so every data workflow chains the deploy explicitly via
`workflow_call`; and the claim processor drains *all* open claim issues each run because GitHub's
concurrency queue keeps only one pending run.

## License

MIT © 2026 CodePath. Built by students, themed after
[codepath.org](https://www.codepath.org); not an official CodePath product.
