import { Link } from 'react-router-dom';
import { buildPolicyReportUrl } from '../lib/claimLinks';
import { useData } from '../lib/useData';
import './how.css';

export default function HowItWorksPage() {
  const { data } = useData();
  const review = data?.config.claimMode !== 'auto';
  return (
    <div className="how">
      <h1>How it works</h1>

      <section>
        <h2>Finding an issue</h2>
        <p>
          The <Link to="/">Browse page</Link> covers the full AI&nbsp;301 issue pool. Search matches
          titles, repos, orgs, tags, and languages; filters narrow by language, tag, availability,
          and AI policy. By default you only see issues that are <strong>unclaimed</strong>, still{' '}
          <strong>open upstream</strong>, and not in repos known to reject AI-assisted work. Share
          any view by copying the URL — filters live in it.
        </p>
      </section>

      <section>
        <h2>Claiming an issue</h2>
        <ol>
          <li>
            Click <strong>Claim</strong> on an issue. Read the repo's contributing guide first — the
            modal links it.
          </li>
          <li>
            The claim form opens on GitHub, pre-filled. Submitting it is how you "sign in": your
            claim is tied to your GitHub account, publicly and auditably.
          </li>
          <li>
            A bot validates your claim in about a minute and replies on your claim issue.
            {review && ' Course staff then approve or deny it (you can start working while it’s pending).'}{' '}
            The site shows the issue as claimed within ~3 minutes.
          </li>
          <li>
            <strong>Introduce yourself to the maintainers on the upstream issue — in your own
            words.</strong> This site never posts to the project for you. A genuine, hand-written
            intro is part of the assignment and part of being a good open-source citizen.
          </li>
        </ol>
        <p className="fine">
          One active claim per student by default. Done or moving on? Use the unclaim form (linked
          from your claim, or from the card once you set your username in “My claims”). If someone
          else already claimed an issue, working it anyway is discouraged — that rule protects you
          from duplicated effort — but the form lets you proceed with an explicit acknowledgement.
        </p>
      </section>

      <section>
        <h2>AI-contribution policy badges</h2>
        <p>
          Some projects reject AI-assisted contributions — several students have had finished work
          turned away. Badges show what we know:
        </p>
        <ul className="policy-legend">
          <li>
            <span className="badge badge-policy-allows">AI OK</span> staff-verified: the repo
            explicitly allows AI-assisted work (source linked on the badge).
          </li>
          <li>
            <span className="badge badge-policy-conditional">AI: conditions</span> allowed with
            conditions — read the linked policy before starting.
          </li>
          <li>
            <span className="badge badge-policy-disallows">No AI contributions</span> verified: the
            repo rejects AI-assisted work. Hidden from results by default.
          </li>
          <li>
            <span className="badge badge-policy-unverified">AI policy unknown</span> no verified
            info. <strong>Unknown does not mean safe</strong> — some repos reject AI work with no
            written policy. Check CONTRIBUTING, and when in doubt ask the maintainers before
            investing weeks.
          </li>
        </ul>
        <p>
          Got rejected over AI usage, or found a policy we're missing?{' '}
          {data ? (
            <a href={buildPolicyReportUrl(data.config)} target="_blank" rel="noreferrer">
              Report it
            </a>
          ) : (
            'Report it via the tracker repo'
          )}{' '}
          — staff verify reports and update the badges so the next student doesn't lose their time.
        </p>
      </section>

      <section>
        <h2>Timing expectations</h2>
        <ul>
          <li>Claim confirmation comment: ~1 minute after you submit the form.</li>
          <li>Site updates (claimed badge, unclaim, approvals): ~2–3 minutes.</li>
          <li>Open/closed status of issues: refreshed daily — a just-closed issue can briefly show as open.</li>
          <li>Please don't re-submit a claim that hasn't shown up yet; check your claim issue on GitHub instead.</li>
        </ul>
      </section>

      <section>
        <h2>For staff</h2>
        <p>
          Claims are reviewed via <code>/approve</code> and <code>/deny</code> comments on claim
          issues; the <Link to="/review">review page</Link> lists the pending inbox, AI-policy scanner
          findings, and student reports. The full runbook is in the repo README.
        </p>
      </section>
    </div>
  );
}
