import { showToast } from '@devvit/web/client';
import { useEffect, useMemo, useState } from 'react';
import type { ProposalsResponse, ProposeRequest, VoteRequest } from '../shared/api';
import { nodeNames } from '../shared/graph';
import { checkProposal, netFor, PROPOSAL_MAX_HOPS, PROPOSAL_MIN_HOPS } from '../shared/rules';
import { LEVEL_NAME } from './twist';
import { call } from './api';
import { interact } from './journey';
import { MiniStamp } from './passport';

/*
 * "Tomorrow's journey": players vote for (or propose) the next daily. The most-voted
 * proposal at midnight UTC becomes tomorrow's puzzle, credited to whoever proposed it.
 */

const SHOWN = 3;

export const Proposals = () => {
  const [data, setData] = useState<ProposalsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    call<ProposalsResponse>('proposals').then(setData, () => setData(null));
  }, []);

  if (!data) return null;

  const send = async (path: string, body: ProposeRequest | VoteRequest) => {
    setBusy(true);
    try {
      setData(await call<ProposalsResponse>(path, body));
      interact(path === 'vote' ? 'vote_journey' : 'propose_journey');
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Top few, plus your own proposal / vote if they're further down.
  const items = data.items.filter(
    (p, i) => i < SHOWN || p.key === data.myVote || p.key === data.myProposal
  );
  return (
    <section className="proposals">
      <p className="kicker section-h">Vote for journey No. {data.number}</p>
      <p className="sub-h">
        {items.length ? 'The most votes at midnight UTC becomes the puzzle.' : 'No proposals yet. Yours could be the puzzle.'}
      </p>
      {items.length > 0 && (
        <ul className="prop-list">
          {items.map((p) => {
            const mine = data.myVote === p.key;
            return (
              <li key={p.key} className={`ticket prop${mine ? ' voted' : ''}`}>
                <div className="prop-main">
                  <span className="prop-route">
                    r/{p.start} <span className="arrow">→</span> r/{p.target}
                  </span>
                  <span className="prop-meta">
                    {p.hops} hops · by {p.by === '' ? 'a traveller' : `u/${p.by}`}
                  </span>
                </div>
                <button
                  className={`vote${mine ? ' on' : ''}`}
                  disabled={busy || !data.canPropose}
                  aria-pressed={mine}
                  aria-label={`${mine ? 'Your vote' : 'Vote for'} r/${p.start} to r/${p.target}, ${p.votes} votes`}
                  onClick={() => void send('vote', { key: p.key })}
                >
                  <b>{p.votes}</b>
                  <small>{mine ? 'voted' : 'vote'}</small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data.myProposal ? (
        <p className="sub-h">You proposed r/{data.myProposal.replace('>', ' → r/')}. Your vote went to it.</p>
      ) : open ? (
        <ProposeForm data={data} busy={busy} onSubmit={(b) => send('propose', b).then((ok) => ok && setOpen(false))} />
      ) : (
        <button className="ghost stats-open" disabled={!data.canPropose} onClick={() => setOpen(true)}>
          Propose a journey
        </button>
      )}
    </section>
  );
};

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

const ProposeForm = (p: {
  data: ProposalsResponse;
  busy: boolean;
  onSubmit: (b: ProposeRequest) => void;
}) => {
  const { home, homeSide, homeExits } = p.data;
  const subs = useMemo(() => {
    const all = nodeNames();
    return (home && !all.includes(home) ? [...all, home] : all).sort(byName);
  }, [home]);
  const net = useMemo(
    () => (home && homeSide ? netFor({ start: home, target: home, home: homeSide, homeExits }) : netFor({ start: '', target: '', home: null, homeExits: [] })),
    [home, homeSide, homeExits]
  );
  const [start, setStart] = useState(homeSide === 'start' && home ? home : '');
  const [target, setTarget] = useState(homeSide === 'end' && home ? home : '');
  const check = start && target ? checkProposal(net, start, target, home, homeSide) : null;

  const picker = (label: string, value: string, set: (v: string) => void, fixed: boolean) => (
    <label className="prop-field">
      <span className="kicker">{label}</span>
      {fixed ? (
        <span className="prop-fixed">
          <MiniStamp sub={value} />
          r/{value} <small>(home)</small>
        </span>
      ) : (
        <select value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Choose a community</option>
          {subs.map((s) => (
            <option key={s} value={s}>
              r/{s}
            </option>
          ))}
        </select>
      )}
    </label>
  );

  return (
    <div className="prop-form">
      {picker('From', start, setStart, homeSide === 'start')}
      {picker('To', target, setTarget, homeSide === 'end')}
      <p className={`prop-check${check ? (check.ok ? ' ok' : ' bad') : ''}`} aria-live="polite">
        {!check
          ? `Pick two communities ${PROPOSAL_MIN_HOPS}–${PROPOSAL_MAX_HOPS} hops apart.`
          : check.ok
            ? `${check.hops} hops apart. ${LEVEL_NAME[check.level]} journey.`
            : check.reason.startsWith('Too hard')
              ? `${check.reason}. Try a different pair.`
              : `${check.reason}. Needs ${PROPOSAL_MIN_HOPS}–${PROPOSAL_MAX_HOPS} hops.`}
      </p>
      <button className="cta" disabled={p.busy || !check?.ok} onClick={() => p.onSubmit({ start, target })}>
        Propose r/{start || '…'} → r/{target || '…'}
      </button>
    </div>
  );
};
