import './fonts';
import './index.css';

import { navigateTo, showLoginPrompt, showToast } from '@devvit/web/client';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  BackResponse,
  Crowd,
  FollowResponse,
  GiveUpResponse,
  HopResponse,
  InitResponse,
  LeaderboardResponse,
  LeaderboardRow,
  NodeView,
  PassportResponse,
  Peek,
  PeekResponse,
  Puzzle,
  Results,
  Run,
  ShareResponse,
  StartResponse,
  Twist,
} from '../shared/api';
import { DISTRICT_IDS, DISTRICTS, district, districtOf } from '../shared/districts';
import { nodeNames } from '../shared/graph';
import { call, fmtTime } from './api';
import { INK } from './ink';
import { BoxStamp, InkDefs, MiniStamp, Stamp } from './passport';
import { appReady, interact, journeyEnded, journeyHeaders, startJourney } from './journey';
import { Proposals } from './proposals';
import { journeyLabel } from './twist';
import { fmtCountdown, msToNextPuzzle, pct, useNow } from './time';
import { compact, twistInfo } from './twist';

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'intro' }
  | { kind: 'playing'; run: Run; node: NodeView; newStamp?: boolean }
  | { kind: 'results'; results: Results }
  | { kind: 'leaderboard'; back: Results }
  | { kind: 'passport'; back: Results };

export const App = () => {
  const [init, setInit] = useState<InitResponse | null>(null);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  // Each screen starts at the top; otherwise results open wherever the game screen was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.kind]);

  useEffect(() => {
    call<InitResponse>('init').then(
      (d) => {
        setInit(d);
        appReady();
        if (d.results) setView({ kind: 'results', results: d.results });
        else if (d.run && d.node) setView({ kind: 'playing', run: d.run, node: d.node });
        else setView({ kind: 'intro' });
      },
      (e: Error) => setView({ kind: 'error', message: e.message })
    );
  }, []);

  const act = async <T,>(fn: () => Promise<T>, then: (r: T) => void) => {
    if (busy) return;
    setBusy(true);
    try {
      then(await fn());
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (view.kind === 'loading' || !init) {
    return (
      <div className="paper center">
        <span className="loading">{view.kind === 'error' ? view.message : 'Opening your passport…'}</span>
      </div>
    );
  }
  const { puzzle } = init;
  // Accents (links, highlights) follow the district you're standing in.
  const stageSub = view.kind === 'playing' ? view.node.name : view.kind === 'intro' ? puzzle.start : puzzle.target;

  const screen = (() => {
    switch (view.kind) {
      case 'intro':
        return (
          <Intro
            puzzle={puzzle}
            streak={init.streak}
            players={init.players}
            busy={busy}
            onStart={() => {
              if (!init.username) {
                interact('login_prompt');
                return showLoginPrompt();
              }
              void act(
                async () => {
                  await startJourney();
                  return call<StartResponse>('start', {});
                },
                (r) => setView({ kind: 'playing', run: r.run, node: r.node })
              );
            }}
          />
        );
      case 'playing':
        return (
          <Playing
            puzzle={puzzle}
            run={view.run}
            node={view.node}
            newStamp={view.newStamp ?? false}
            busy={busy}
            onHop={(to) =>
              act(
                async () => {
                  await startJourney(); // no-op mid-journey; picks a resumed run back up
                  return call<HopResponse>('hop', { to }, journeyHeaders());
                },
                (r) => {
                  if (r.status === 'playing') setView({ kind: 'playing', run: r.run, node: r.node, newStamp: r.newStamp });
                  else {
                    journeyEnded();
                    setInit({ ...init, streak: r.streak });
                    setView({ kind: 'results', results: r.results });
                  }
                }
              )
            }
            onBack={() =>
              act(
                () => {
                  interact('step_back');
                  return call<BackResponse>('back', {});
                },
                (r) => setView({ kind: 'playing', run: r.run, node: r.node })
              )
            }
            onGiveUp={() =>
              act(
                () => call<GiveUpResponse>('giveup', {}, journeyHeaders()),
                (r) => {
                  journeyEnded();
                  setView({ kind: 'results', results: r.results });
                }
              )
            }
          />
        );
      case 'results':
        return (
          <ResultsScreen
            puzzle={puzzle}
            results={view.results}
            username={init.username}
            streak={init.streak}
            subreddit={init.subreddit}
            following={init.following}
            busy={busy}
            onShare={() =>
              act(
                () => {
                  interact('share_result');
                  return call<ShareResponse>('share', {});
                },
                () => showToast('Posted to the comments')
              )
            }
            onPassport={() => {
              interact('open_passport');
              setView({ kind: 'passport', back: view.results });
            }}
            onSeeAll={() => {
              interact('open_leaderboard');
              setView({ kind: 'leaderboard', back: view.results });
            }}
          />
        );
      case 'passport':
        return <PassportPage puzzle={puzzle} onBack={() => setView({ kind: 'results', results: view.back })} />;
      case 'leaderboard':
        return <FullLeaderboard puzzle={puzzle} onBack={() => setView({ kind: 'results', results: view.back })} />;
      default:
        return null;
    }
  })();

  return (
    <div className="paper" data-district={districtOf(stageSub)}>
      <InkDefs />
      {screen}
    </div>
  );
};

// ---------- shared bits ----------

const Cover = ({ puzzle, right }: { puzzle: Puzzle; right?: string }) => (
  <header className="cover">
    <span className="cover-brand">Subhop</span>
    <span className="cover-meta">{right ?? (puzzle.number > 0 ? [`Daily No. ${puzzle.number}`, dayLabel(puzzle.id)].filter(Boolean).join(' · ') : 'Test journey')}</span>
  </header>
);

/** "Sun 15 Nov" for a daily's id (its UTC date); empty for anything else. */
const dayLabel = (id: string): string => {
  const d = new Date(`${id}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** A community's name as a heading. Long names shrink to fit one line instead of breaking mid-word. */
const SubTitle = ({ sub, dest }: { sub: string; dest?: boolean }) => (
  <h1 className={`sub-title${dest ? ' dest' : ''}`} style={{ fontSize: `min(34px, calc(100cqi / ${(sub.length + 2) * 0.52}))` }}>
    r/{sub}
  </h1>
);

const TwistNotice = ({ twist }: { twist: Twist }) => {
  const t = twistInfo(twist);
  return (
    <div className="notice">
      <BoxStamp text={t.stamp} tilt={-4} />
      <p>{t.rule}</p>
    </div>
  );
};

const useClock = (startedAt: number) => {
  const now = useNow(500);
  return now - startedAt;
};

// ---------- intro ----------

const Intro = (p: { puzzle: Puzzle; streak: number; players: number; busy: boolean; onStart: () => void }) => {
  const from = district(p.puzzle.start);
  const to = district(p.puzzle.target);
  return (
    <div className="screen">
      <Cover puzzle={p.puzzle} />
      <section className="journey">
        <p className="kicker">{journeyLabel(p.puzzle)}</p>
        <div className="leg">
          <Stamp sub={p.puzzle.start} caption="Departure" size={96} className="slam" />
          <div>
            <span className="kicker">From · {from.name}</span>
            <SubTitle sub={p.puzzle.start} />
          </div>
        </div>
        <div className="leg-line" aria-hidden="true">
          {Array.from({ length: p.puzzle.par }, (_, i) => (
            <span key={i} className="leg-dot" style={{ animationDelay: `${300 + i * 160}ms` }} />
          ))}
          <span className="leg-par">par {p.puzzle.par} hops</span>
        </div>
        <div className="leg">
          <span className="dest-ring" style={{ color: INK[to.id] }}>
            <span>?</span>
          </span>
          <div>
            <span className="kicker">To · {to.name}</span>
            <SubTitle sub={p.puzzle.target} dest />
          </div>
        </div>
      </section>

      <ol className="rules">
        <li>Each community has six exits: the places its commenters also comment. Tap one to hop there.</li>
        <li>
          Reach r/{p.puzzle.target} in {p.puzzle.par} hops or fewer. You get one try.
          {p.puzzle.twist?.kind === 'noback' && ' No stepping back today.'}
        </li>
      </ol>

      {p.puzzle.twist && <TwistNotice twist={p.puzzle.twist} />}

      <button className="cta" disabled={p.busy} onClick={p.onStart}>
        Start the journey
      </button>

      <div className="spacer" />
      <footer className="ledger">
        <span>
          Streak <b>{p.streak} {p.streak === 1 ? 'day' : 'days'}</b>
        </span>
        <span>
          <b>{p.players.toLocaleString()}</b> arrived today
        </span>
      </footer>
    </div>
  );
};

// ---------- playing ----------

// Peeks are cached for the session: stepping back into a sub doesn't refetch.
const peekCache = new Map<string, Peek | null>();

/** undefined while loading, null if there's nothing to show. */
const usePeek = (sub: string): Peek | null | undefined => {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (peekCache.has(sub)) return;
    let live = true;
    const done = (v: Peek | null) => {
      peekCache.set(sub, v);
      if (live) rerender((n) => n + 1);
    };
    call<PeekResponse>(`peek?sub=${encodeURIComponent(sub)}`).then(
      (r) => done(r.peek),
      () => done(null)
    );
    return () => {
      live = false;
    };
  }, [sub]);
  return peekCache.get(sub);
};

const PeekLine = ({ sub }: { sub: string }) => {
  const peek = usePeek(sub);
  if (peek === null) return null;
  if (peek === undefined) return <p className="peek skeleton" aria-hidden="true" />;
  return (
    <div className="peek">
      <p className="peek-stats">
        {peek.members !== null && <span>{compact(peek.members)} residents</span>}
        {peek.online !== null && peek.online > 0 && <span className="live">{compact(peek.online)} in today</span>}
      </p>
      {peek.top && <p className="peek-top">Top this week: “{peek.top.title}”</p>}
    </div>
  );
};

const RouteLine = ({ path }: { path: string[] }) => {
  const shown = path.length > 4 ? [path[0]!, '…', ...path.slice(-2)] : path;
  return (
    <p className="route-line">
      {shown.map((n, i) => (
        <span key={`${n}-${i}`}>
          {i > 0 && <span className="sep"> › </span>}
          {n === '…' ? '…' : `r/${n}`}
        </span>
      ))}
    </p>
  );
};

const Playing = (p: {
  puzzle: Puzzle;
  run: Run;
  node: NodeView;
  newStamp: boolean;
  busy: boolean;
  onHop: (to: string) => void;
  onBack: () => void;
  onGiveUp: () => void;
}) => {
  const elapsed = useClock(p.run.startedAt);
  // Two-tap give up; resets whenever you move (keyed by current node + hops).
  const [confirmAt, setConfirmAt] = useState<string | null>(null);
  const moveKey = `${p.node.name}:${p.run.hops}`;
  const confirmGiveUp = confirmAt === moveKey;
  // Which exit you just tapped, so it shows feedback while the server checks the hop.
  const [tapped, setTapped] = useState<string | null>(null);
  const pending = (e: string) => p.busy && tapped === `${moveKey}>${e}`;

  const { twist, target } = p.puzzle;
  const closed = twist?.kind === 'avoid' ? twist.sub : null;
  const detour = twist?.kind === 'via' ? twist.sub : null;
  const detourDone = detour !== null && p.run.path.includes(detour);
  const targetLocked = detour !== null && !detourDone;
  const here = district(p.node.name);
  const entry = p.run.path.length;
  // Hot or cold: how the hop that brought you here changed the distance left.
  const last = p.run.moves?.slice(-1);
  const temp =
    last === 'c' ? { cls: 'warm', text: 'Warmer' } : last === 'f' ? { cls: 'cold', text: 'Colder' } : last === 's' ? { cls: 'same', text: 'No closer' } : null;

  return (
    <div className="screen playing">
      <header className="cover">
        <span className="cover-brand">Subhop</span>
        <span className="cover-meta">
          to <b>r/{target}</b>
        </span>
      </header>
      <div className="tally-bar">
        <span>
          Hops <b>{p.run.hops}</b>
        </span>
        <span>
          Par <b>{p.puzzle.par}</b>
        </span>
        <span>
          <b>{fmtTime(elapsed)}</b>
        </span>
        {twist && (
          <span className={`tally-twist${detourDone ? ' done' : ''}`}>
            {twist.kind === 'avoid' && `r/${twist.sub} closed`}
            {twist.kind === 'via' && (detourDone ? `Detour done` : `Via r/${twist.sub}`)}
            {twist.kind === 'noback' && 'No return'}
          </span>
        )}
      </div>

      <section className="visa" key={moveKey}>
        <div className="visa-text">
          <p className="kicker">
            {entry === 1 ? 'Departure' : `Entry ${entry}`} · {here.name}
          </p>
          <SubTitle sub={p.node.name} />
          <p className="visa-desc">{p.node.description}</p>
          <PeekLine sub={p.node.name} />
          {temp && <p className={`temp ${temp.cls}`}>{temp.text}</p>}
        </div>
        <div className="visa-stamp">
          <Stamp sub={p.node.name} caption={entry === 1 ? 'Departure' : `Entry ${entry}`} size={112} className="slam" />
          {p.newStamp && (
            <BoxStamp text="New stamp" color="#1b6237" tilt={-10} className="small thud new-stamp" style={{ animationDelay: '420ms' }} />
          )}
        </div>
      </section>
      <RouteLine path={p.run.path} />

      <section className="onward">
        <p className="kicker onward-h">
          {targetLocked && p.node.exits.includes(target)
            ? `Destination in sight. Visit r/${detour} first.`
            : p.node.exits.includes(target)
              ? 'Destination in sight'
              : p.run.path.length === 1
                ? 'Tap a ticket to hop'
                : 'Onward travel'}
        </p>
        <div className="tickets" key={`t-${moveKey}`}>
          {p.node.exits.map((e, i) => {
            const isTarget = e === target;
            const isClosed = e === closed;
            const isLocked = isTarget && targetLocked;
            const cls = [
              'ticket exit',
              isTarget && 'is-target',
              e === detour && !detourDone && 'is-detour',
              (isClosed || isLocked) && 'blocked',
              pending(e) && 'pending',
            ]
              .filter(Boolean)
              .join(' ');
            const d = district(e);
            return (
              <button
                key={e}
                className={cls}
                style={{ animationDelay: `${i * 40}ms` }}
                disabled={p.busy || isClosed || isLocked}
                onClick={() => {
                  setTapped(`${moveKey}>${e}`);
                  p.onHop(e);
                }}
              >
                <span className="ticket-main">
                  <span className="exit-sub">r/{e}</span>
                  <span className="ticket-line">
                    {isTarget ? (isLocked ? `Destination · visa needed` : 'Destination') : d.name}
                    {e === detour && !detourDone ? ' · required stop' : ''}
                  </span>
                </span>
                {isClosed ? <BoxStamp text="Closed" tilt={-10} className="small" /> : <MiniStamp sub={e} />}
              </button>
            );
          })}
        </div>
      </section>

      <div className="spacer" />
      <footer className="actions">
        {twist?.kind === 'noback' ? (
          <span className="actions-note">No stepping back today</span>
        ) : (
          <button className="ghost" disabled={p.busy || p.run.path.length < 2} onClick={p.onBack}>
            Step back +1
          </button>
        )}
        <button
          className={`ghost${confirmGiveUp ? ' warn' : ''}`}
          disabled={p.busy}
          onClick={() => (confirmGiveUp ? p.onGiveUp() : setConfirmAt(moveKey))}
        >
          {confirmGiveUp ? 'Tap again to give up' : 'Give up'}
        </button>
      </footer>
    </div>
  );
};

// ---------- results ----------

/** Every stop you made, stamped onto a passport page. */
const StampPage = (p: { path: string[]; finished: boolean; hops: number; fresh: string[] }) => {
  const { path, finished, hops } = p;
  // Long journeys keep the departure and the last stops.
  const stops = path.length > 9 ? [path[0]!, ...path.slice(-8)] : path;
  const cols = stops.length <= 4 ? 2 : 3;
  const size = cols === 2 ? 124 : 104;
  const cell = 354 / cols;
  const rowH = size * 0.96;
  const rows = Math.ceil(stops.length / cols);
  return (
    // Extra room at the bottom so the ARRIVED stamp never covers your destination stamp.
    <div className="stamp-page" style={{ height: rows * rowH + size * 0.25 + 64 }}>
      {stops.map((sub, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const jitter = ((sub.length * 7 + i * 13) % 17) - 8;
        const last = i === stops.length - 1;
        const caption =
          i === 0
            ? 'Departure'
            : last && finished
              ? 'Arrival'
              : p.fresh.includes(sub)
                ? 'New stamp'
                : `Entry ${path.indexOf(sub) + 1}`;
        return (
          <Stamp
            key={`${sub}-${i}`}
            sub={sub}
            caption={caption}
            size={size}
            className="slam placed"
            style={{
              left: col * cell + (cell - size) / 2 + jitter,
              top: row * rowH + ((i * 11) % 9),
              animationDelay: `${200 + i * 230}ms`,
            }}
          />
        );
      })}
      <BoxStamp
        text={finished ? 'Arrived' : 'Turned back'}
        sub={finished ? `${hops} hops` : `after ${hops} hops`}
        color={finished ? '#b3261e' : '#625844'}
        tilt={-12}
        className="big thud"
        style={{ animationDelay: `${400 + stops.length * 230}ms` }}
      />
    </div>
  );
};

const ResultsScreen = (p: {
  puzzle: Puzzle;
  results: Results;
  username: string | null;
  streak: number;
  subreddit: string;
  following: boolean;
  busy: boolean;
  onShare: () => void;
  onSeeAll: () => void;
  onPassport: () => void;
}) => {
  const { run, timeMs, rank, top, mostCommon, weirdest, optimal, players, crowd } = p.results;
  const finished = run.status === 'finished';
  const delta = run.hops - p.puzzle.par;
  const verdict = !finished ? 'Did not arrive' : delta < 0 ? 'Under par' : delta === 0 ? 'On par' : `${delta} over par`;
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <div className="screen">
      <Cover puzzle={p.puzzle} />
      <section className="results-head">
        <div>
          <p className="kicker">{finished ? `Arrived at r/${p.puzzle.target}` : `Bound for r/${p.puzzle.target}`}</p>
          <p className="score">
            {run.hops}
            <small> hops</small>
          </p>
        </div>
        <dl className="score-meta">
          <div>
            <dt>Result</dt>
            <dd>{verdict}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{fmtTime(timeMs)}</dd>
          </div>
          {crowd.topPct !== null && (
            <div>
              <dt>Rank</dt>
              <dd>Top {crowd.topPct}%</dd>
            </div>
          )}
        </dl>
      </section>

      <StampPage path={run.path} finished={finished} hops={run.hops} fresh={p.results.passport.fresh} />

      <div className="passport-line">
        <span>
          {p.results.passport.fresh.length > 0 ? (
            <>
              <b>
                +{p.results.passport.fresh.length} new {p.results.passport.fresh.length === 1 ? 'stamp' : 'stamps'}
              </b>{' '}
              · {p.results.passport.collected} of {p.results.passport.total} collected
            </>
          ) : (
            <>
              <b>{p.results.passport.collected}</b> of {p.results.passport.total} stamps collected
            </>
          )}
        </span>
        <button className="link" onClick={p.onPassport}>
          Your passport
        </button>
      </div>

      <Insights crowd={crowd} run={run} limit={1} />

      {finished && (
        <button className="cta" disabled={p.busy} onClick={p.onShare}>
          Post my result in the comments
        </button>
      )}

      {(!finished || delta > 0) && optimal.length > 0 && <PathCard title="Shortest route" path={optimal} />}

      <Chapter
        title="Today’s arrivals"
        aside={
          <button className="link" onClick={p.onSeeAll}>
            All {players.toLocaleString()}
          </button>
        }
      >
        {finished && rank !== null && <RivalLine rank={rank} hops={run.hops} timeMs={timeMs} rival={p.results.rival} />}
        <div className="lb">
          {top.slice(0, 3).map((r) => (
            <LbRow key={r.username} row={r} me={r.username === p.username} />
          ))}
          {finished && rank && !top.slice(0, 3).some((r) => r.username === p.username) && (
            <LbRow row={{ rank, username: p.username ?? '', hops: run.hops, timeMs, avatar: p.results.myAvatar }} me />
          )}
        </div>
        <p className="sub-h lb-note">Fewest hops first. Ties go to the faster time.</p>
        {statsOpen ? (
          <div className="stats">
            <Insights crowd={crowd} run={run} skip={1} />
            <CrowdCharts crowd={crowd} run={run} par={p.puzzle.par} start={p.puzzle.start} />
            <div className="routes">
              {mostCommon && <PathCard title={`Most travelled · ${mostCommon.count} took it`} path={mostCommon.path} />}
              {weirdest && <PathCard title="Most scenic" path={weirdest.path} />}
              {!mostCommon && <p className="muted-text">You’re the first traveller today.</p>}
            </div>
          </div>
        ) : (
          <button
            className="ghost stats-open"
            onClick={() => {
              interact('open_stats');
              setStatsOpen(true);
            }}
          >
            How everyone else did
          </button>
        )}
      </Chapter>

      <Chapter title="Tomorrow" aside={p.puzzle.number > 0 ? <NextPuzzle /> : undefined}>
        {p.puzzle.number > 0 && p.streak > 0 && (
          <p className="streak-line">
            <b>{p.streak}-day streak.</b> Play tomorrow to make it {p.streak + 1}.
          </p>
        )}
        <Proposals />
        {!p.following && p.subreddit && <FollowTicket subreddit={p.subreddit} />}
      </Chapter>
    </div>
  );
};

/** Who's just ahead of you on the board, by name. */
const RivalLine = (p: { rank: number; hops: number; timeMs: number; rival: LeaderboardRow | null }) => {
  if (p.rank === 1) return <p className="rival-line">You’re in the lead. Everyone else is chasing you.</p>;
  if (!p.rival) return null;
  const gap = p.hops - p.rival.hops;
  const secs = Math.max(1, Math.round((p.timeMs - p.rival.timeMs) / 1000));
  return (
    <p className="rival-line">
      {gap > 0 ? (
        <>
          <b>
            {gap} {gap === 1 ? 'hop' : 'hops'} behind
          </b>{' '}
          u/{p.rival.username}
        </>
      ) : (
        <>
          Same hops as u/{p.rival.username}, <b>{secs}s slower</b>
        </>
      )}
      , one place ahead of you.
    </p>
  );
};

/** Every community on the map, grouped by district: the ones you've been to are stamped. */
const PassportPage = ({ puzzle, onBack }: { puzzle: Puzzle; onBack: () => void }) => {
  const [data, setData] = useState<PassportResponse | null>(null);
  useEffect(() => {
    call<PassportResponse>('passport').then(setData, (e: Error) => showToast(e.message));
  }, []);
  const have = new Set(data?.collected ?? []);
  const groups = DISTRICT_IDS.map((id) => ({
    id,
    subs: nodeNames()
      .filter((n) => districtOf(n) === id)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
  })).filter((g) => g.subs.length > 0);
  return (
    <div className="screen">
      <Cover puzzle={puzzle} right="Your passport" />
      <button className="link back" onClick={onBack}>
        ‹ Back to your results
      </button>
      {!data ? (
        <p className="muted-text">Loading…</p>
      ) : (
        <>
          <section className="passport-head">
            <p className="score">
              {data.collected.length}
              <small> of {data.total} stamps</small>
            </p>
            <p className="sub-h">Every community you pass through stays stamped here. Take the scenic route to fill it.</p>
          </section>
          {groups.map((g) => {
            const got = g.subs.filter((s) => have.has(s)).length;
            return (
              <section key={g.id} className="district-page">
                <p className="kicker section-h">
                  {DISTRICTS[g.id].name} · {got}/{g.subs.length}
                </p>
                <ul className="visa-chips" style={{ color: INK[g.id] }}>
                  {g.subs.map((s, i) => (
                    <li
                      key={s}
                      className={have.has(s) ? 'got' : ''}
                      style={have.has(s) ? { rotate: `${((i * 7) % 5) - 2}deg` } : undefined}
                    >
                      r/{s}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
};

/** The way back tomorrow: follow the community the journeys are posted in. */
const FollowTicket = ({ subreddit }: { subreddit: string }) => {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const onFollow = async () => {
    setState('sending');
    try {
      const r = await call<FollowResponse>('follow', {});
      interact('follow_subreddit');
      if (r.subscribed) return setState('done');
      // The app can't follow for you here: open the community so you can tap Join.
      setState('idle');
      navigateTo(`https://www.reddit.com/r/${subreddit}/`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Something went wrong');
      setState('idle');
    }
  };
  return (
    <div className="ticket prop follow">
      <div className="prop-main">
        <span className="prop-route">A new journey leaves r/{subreddit} every day</span>
        <span className="prop-meta">{state === 'done' ? 'See you at the next departure.' : 'Follow to catch it in your feed.'}</span>
      </div>
      <button className={`vote follow-btn${state === 'done' ? ' on' : ''}`} disabled={state !== 'idle'} onClick={onFollow}>
        <b>{state === 'done' ? 'Following' : 'Follow'}</b>
      </button>
    </div>
  );
};

const NextPuzzle = () => {
  const now = useNow(30_000);
  return (
    <span className="chapter-aside">
      Next in <b>{fmtCountdown(msToNextPuzzle(now))}</b>
    </span>
  );
};

/** Plain-language takeaways about how you compare with everyone else. */
const Insights = ({ crowd, run, limit, skip = 0 }: { crowd: Crowd; run: Run; limit?: number; skip?: number }) => {
  // weight: how surprising a line is. The most surprising one is shown first.
  const lines: { key: string; lead: string; rest: string; weight: number }[] = [];
  if (crowd.sameRoute !== null && crowd.finishers > 1) {
    lines.push(
      crowd.sameRoute === 0
        ? { key: 'route', lead: 'Nobody else', rest: ' took your exact route.', weight: 3 }
        : {
            key: 'route',
            lead: `${crowd.sameRoute} other${crowd.sameRoute === 1 ? '' : 's'}`,
            rest: ' took exactly your route.',
            weight: 1,
          }
    );
  }
  const first = run.path[1];
  if (first && crowd.firstTotal > 1) {
    const count = crowd.firstMoves.find((m) => m.name === first)?.count ?? 0;
    const share = count / crowd.firstTotal;
    const p = pct(count, crowd.firstTotal);
    lines.push({
      key: 'first',
      lead: share <= 0.15 ? `Only ${p}` : p,
      rest: ` of travellers left via r/${first}, like you.`,
      weight: share <= 0.15 ? 2.5 : 1.2,
    });
  }
  const hub = crowd.hubs[0];
  if (hub && crowd.finishers > 1) {
    lines.push({ key: 'hub', lead: pct(hub.count, crowd.finishers), rest: ` of arrivals passed through r/${hub.name}.`, weight: 0.8 });
  }
  const shown = lines
    .sort((a, b) => b.weight - a.weight)
    .slice(skip, limit === undefined ? undefined : skip + limit);
  if (!shown.length) return null;
  return (
    <ul className="insights">
      {shown.map((l) => (
        <li key={l.key}>
          <b>{l.lead}</b>
          {l.rest}
        </li>
      ))}
    </ul>
  );
};

type BarRow = { key: string; label: string; count: number; mine: boolean; note?: string };

/** Single-series horizontal bars. Your row is highlighted and every value is labelled. */
const BarList = ({ rows, total, caption }: { rows: BarRow[]; total: number; caption: string }) => {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <table className="bars">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key} className={r.mine ? 'mine' : ''} title={`${r.label}: ${r.count} of ${total}`}>
            <th scope="row">
              <span className="bar-label">
                <span className="bar-name">{r.label}</span>
                {r.mine && <span className="you-tag">you</span>}
                {r.note && <span className="note">{r.note}</span>}
              </span>
            </th>
            <td className="track">
              <span
                className="fill"
                style={{ width: `${r.count ? Math.max(3, (r.count / max) * 100) : 0}%`, animationDelay: `${i * 50}ms` }}
              />
            </td>
            <td className="val">{pct(r.count, total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const CrowdCharts = ({ crowd, run, par, start }: { crowd: Crowd; run: Run; par: number; start: string }) => {
  if (crowd.firstTotal < 2 && crowd.finishers < 2) return null;
  const finished = run.status === 'finished';
  // Fold the long tail so the chart stays phone-sized.
  const cap = par + 4;
  const hopRows: BarRow[] = [];
  let tail = 0;
  for (const h of crowd.hopCounts) {
    if (h.hops > cap) {
      tail += h.count;
      continue;
    }
    const row: BarRow = { key: String(h.hops), label: `${h.hops} hops`, count: h.count, mine: finished && run.hops === h.hops };
    if (h.hops === par) row.note = 'par';
    hopRows.push(row);
  }
  if (tail) hopRows.push({ key: 'tail', label: `${cap + 1}+ hops`, count: tail, mine: finished && run.hops > cap });

  const firstRows: BarRow[] = crowd.firstMoves.map((m) => ({
    key: m.name,
    label: `r/${m.name}`,
    count: m.count,
    mine: run.path[1] === m.name,
  }));

  return (
    <section className="crowd">
      {crowd.firstTotal >= 2 && (
        <div>
          <p className="kicker section-h">First ticket out of r/{start}</p>
          <p className="sub-h">{crowd.firstTotal.toLocaleString()} travellers</p>
          <BarList rows={firstRows} total={crowd.firstTotal} caption={`First move out of r/${start}`} />
        </div>
      )}
      {crowd.finishers >= 2 && hopRows.length > 0 && (
        <div>
          <p className="kicker section-h">Hops to arrive</p>
          <p className="sub-h">{crowd.finishers.toLocaleString()} arrivals</p>
          <BarList rows={hopRows} total={crowd.finishers} caption="Arrivals by number of hops" />
        </div>
      )}
    </section>
  );
};

const PathCard = ({ title, path }: { title: string; path: string[] }) => (
  <div className="path-card">
    <div className="path-head">
      <span>{title}</span>
      <span>{path.length - 1} hops</span>
    </div>
    <p>{path.map((n) => `r/${n}`).join(' › ')}</p>
  </div>
);

/** A titled part of the results page: what it's about, at a glance. */
const Chapter = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="chapter">
    <div className="chapter-head">
      <h2>{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

/** One of Reddit's eight default avatars, always the same one for a given name. */
const defaultAvatar = (name: string) => {
  const n = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;
  return `https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${n}.png`;
};

/** Their Snoovatar, else a Reddit default avatar; their initial only if images won't load at all. */
const Avatar = ({ name, url }: { name: string; url: string | null }) => {
  const [broken, setBroken] = useState(false);
  // Snoovatars are tall full-body cutouts and stand free; the defaults are square and fill a circle.
  return !broken ? (
    <span className={`avatar${url ? ' snoo' : ''}`} aria-hidden="true">
      <img src={url ?? defaultAvatar(name)} alt="" onError={() => setBroken(true)} />
    </span>
  ) : (
    <span className="avatar initial" aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
};

const LbRow = ({ row, me }: { row: LeaderboardRow; me?: boolean }) => (
  <div className={`lb-row${me ? ' me' : ''}`}>
    <span className="lb-rank">{row.rank}</span>
    <span className="u">
      <Avatar name={row.username} url={row.avatar} />
      <span className="u-name">{me ? 'You' : `u/${row.username}`}</span>
    </span>
    <span>{row.hops} hops</span>
    <span className="t">{fmtTime(row.timeMs)}</span>
  </div>
);

const FullLeaderboard = ({ puzzle, onBack }: { puzzle: Puzzle; onBack: () => void }) => {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  useEffect(() => {
    call<LeaderboardResponse>('leaderboard').then(setData, (e: Error) => showToast(e.message));
  }, []);
  return (
    <div className="screen">
      <Cover puzzle={puzzle} right="Arrivals board" />
      <button className="link back" onClick={onBack}>
        ‹ Back to your results
      </button>
      {!data ? (
        <p className="muted-text">Loading…</p>
      ) : (
        <div className="lb">
          {data.rows.map((r) => (
            <LbRow key={r.username} row={r} me={r.username === data.you?.username} />
          ))}
          {data.you && data.you.rank > data.rows.length && <LbRow row={data.you} me />}
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
