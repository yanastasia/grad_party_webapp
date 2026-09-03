import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="page">
      <section className="homeHero">
        <p className="eyebrow">A&amp;L</p>
        <h1 className="display">Graduation<br />Party</h1>
        <p className="gratitude">
          Thank you for being part of this.
          <em>Help us remember the night.</em>
        </p>
      </section>

      <section className="activityList" aria-label="Party activities">
        <Link className="activity" href="/photos">
          <span className="activityIcon" aria-hidden="true">◎</span>
          <span>
            <span className="activityTitle">Take photos</span>
            <span className="activityCopy">15 shots. Make them count.</span>
          </span>
          <span className="activityArrow" aria-hidden="true">→</span>
        </Link>

        <a className="activity" href="https://dekk.fm/mix?room=a-l-xi" target="_blank" rel="noreferrer">
          <span className="activityIcon" aria-hidden="true">♪</span>
          <span>
            <span className="activityTitle">Request a song</span>
            <span className="activityCopy">Request it. Vote it up.</span>
          </span>
          <span className="activityArrow" aria-hidden="true">→</span>
        </a>
      </section>

      <p className="partyDate">05 · 09 · 26</p>
    </main>
  );
}
