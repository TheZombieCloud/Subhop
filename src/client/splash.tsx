import './fonts';
import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { InitResponse } from '../shared/api';
import { district } from '../shared/districts';
import { call } from './api';
import { INK } from './ink';
import { BoxStamp, InkDefs, MiniStamp, Stamp } from './passport';
import { fmtCountdown, msToNextPuzzle, useNow } from './time';
import { journeyLabel, twistInfo } from './twist';

// Inline view shown in the feed. Kept light: one fetch, no game logic.
export const Splash = () => {
  const [data, setData] = useState<InitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(30_000);

  useEffect(() => {
    call<InitResponse>('init').then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="paper center error">{error}</div>;
  if (!data) return <div className="paper center" />;
  const { puzzle, run, players, best, streak, results } = data;
  const done = run && run.status !== 'playing';
  const daily = puzzle.number > 0;

  return (
    <div className="paper splash">
      <InkDefs />
      <header className="cover">
        <span className="cover-brand">Subhop</span>
        <span className="cover-meta">
          {daily ? `Daily No. ${puzzle.number}` : 'Test journey'}
          {streak > 0 && ` · ${streak}-day streak`}
        </span>
      </header>

      <div className="splash-body">
        <div className="splash-stamps" aria-hidden="true">
          <Stamp sub={puzzle.start} caption="Departure" size={150} />
          <span className="splash-route">
            {Array.from({ length: puzzle.par }, (_, i) => (
              <span key={i} className="leg-dot" style={{ animationDelay: `${i * 160}ms` }} />
            ))}
          </span>
          {run?.status === 'finished' ? (
            <Stamp sub={puzzle.target} caption="Arrived" size={150} className="slam" />
          ) : (
            <span className="dest-ring" style={{ color: INK[district(puzzle.target).id] }}>
              <span>?</span>
            </span>
          )}
        </div>
        <p className="kicker">{journeyLabel(puzzle)}</p>
        <div className="splash-leg">
          <MiniStamp sub={puzzle.start} />
          <span className="splash-sub">r/{puzzle.start}</span>
          <span className="splash-district">{district(puzzle.start).name}</span>
        </div>
        <div className="splash-par">
          {Array.from({ length: puzzle.par }, (_, i) => (
            <span key={i} className="leg-dot" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
          <span>par {puzzle.par}</span>
        </div>
        <div className="splash-leg">
          {run?.status === 'finished' ? (
            <MiniStamp sub={puzzle.target} />
          ) : (
            <span className="dest-ring mini" style={{ color: INK[district(puzzle.target).id] }}>
              <span>?</span>
            </span>
          )}
          <span className="splash-sub dest">r/{puzzle.target}</span>
          <span className="splash-district">{district(puzzle.target).name}</span>
        </div>

        <p className="splash-tag">Hop between related communities. Fewest hops wins.</p>

        {puzzle.twist && (
          <div className="splash-twist">
            <BoxStamp text={twistInfo(puzzle.twist).stamp} tilt={-5} className="small" />
            <span>{twistInfo(puzzle.twist).rule}</span>
          </div>
        )}

        <p className="splash-stats" style={{ marginTop: 'auto' }}>
          {players > 0 ? (
            <span>
              <b>{players.toLocaleString()}</b> arrived
            </span>
          ) : (
            <span>Be the first to arrive</span>
          )}
          {best && (
            <span>
              Best <b>{best.hops} hops</b>
            </span>
          )}
          {done && results && (
            <span className="mine">
              You <b>{run.status === 'finished' ? `${run.hops} hops` : 'turned back'}</b>
              {results.rank ? ` · #${results.rank}` : ''}
            </span>
          )}
        </p>

        <button className="cta" onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}>
          {done ? 'See everyone’s routes' : run ? 'Continue the journey' : 'Start the journey'}
        </button>
        {done && daily && <p className="fine">Next journey in {fmtCountdown(msToNextPuzzle(now))}</p>}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
