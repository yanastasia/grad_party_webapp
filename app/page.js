import Link from 'next/link';

function ArrowUpRightIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17L17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="page partyPage homePage">
      <div className="doodle doodleFlowers" aria-hidden="true" />
      <div className="doodle doodleLights" aria-hidden="true" />
      <div className="doodle doodleMountain" aria-hidden="true" />
      <div className="scribble scribbleOne" aria-hidden="true" />
      <div className="scribble scribbleTwo" aria-hidden="true" />

      <section className="homeHero vintageCard">
        <p className="eyebrow">Anastasia &amp; Leona · 05.09.26</p>
        <h1 className="script homePrompt" style={{ margin: '14px 0 0', fontSize: 'clamp(42px, 10vw, 68px)', lineHeight: 1.02, textAlign: 'left', transform: 'rotate(-1deg)' }}>Pick your side quest.</h1>
      </section>

      <section className="activityList" aria-label="Party activities">
        <Link className="activity activityPhoto" href="/photos">
          <span className="activitySketch" aria-hidden="true">▣</span>
          <span>
            <span className="activityTitle">Photo Booth</span>
            <span className="activityNote">For the archives. Or the group chat.</span>
          </span>
          <span className="activityArrow" aria-hidden="true"><ArrowUpRightIcon /></span>
        </Link>

        <a className="activity activityMusic" href="https://dekk.fm/mix?room=a-l-xi" target="_blank" rel="noreferrer">
          <span className="activitySketch" aria-hidden="true">♫</span>
          <span>
            <span className="activityTitle">Song Requests</span>
            <span className="activityNote">The dance floor is a democracy. Mostly.</span>
          </span>
          <span className="activityArrow" aria-hidden="true"><ArrowUpRightIcon /></span>
        </a>
      </section>
    </main>
  );
}
