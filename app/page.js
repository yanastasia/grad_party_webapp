import Link from 'next/link';

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
        <h1 className="display">Join the <span className="script displayScript">party</span></h1>
        <p className="gratitude">
          Photos, songs, and good decisions optional.
          <em>Pick your side quest.</em>
        </p>
      </section>

      <section className="activityList" aria-label="Party activities">
        <Link className="activity activityPhoto" href="/photos">
          <span className="activitySketch" aria-hidden="true">▣</span>
          <span>
            <span className="activityTitle">Photo Booth</span>
            <span className="activityCopy">Take it. Send it. Keep the night alive.</span>
            <span className="activityNote">Up to 15 photos per guest.</span>
          </span>
          <span className="activityArrow" aria-hidden="true">↗</span>
        </Link>

        <a className="activity activityMusic" href="https://dekk.fm/mix?room=a-l-xi" target="_blank" rel="noreferrer">
          <span className="activitySketch" aria-hidden="true">♫</span>
          <span>
            <span className="activityTitle">Song Requests</span>
            <span className="activityCopy">Request a song or vote for your favorites.</span>
            <span className="activityNote">The dance floor is a democracy. Mostly.</span>
          </span>
          <span className="activityArrow" aria-hidden="true">↗</span>
        </a>
      </section>

      <p className="partyFooter">STATE EXAM SURVIVOR · PARTY DEGREE IN PROGRESS</p>
    </main>
  );
}
