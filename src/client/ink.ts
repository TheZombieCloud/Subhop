import type { DistrictId } from '../shared/districts';

/** District ink colours. Each passes WCAG AA (4.5:1) on all three paper colours in index.css. */
export const INK: Record<DistrictId, string> = {
  crafts: '#a3245a',
  food: '#834a0a',
  home: '#505c12',
  world: '#1f6878',
  motors: '#b3261e',
  sports: '#1b6237',
  animals: '#6b5610',
  lounge: '#a33a08',
  gaming: '#6d2fa0',
  tech: '#106252',
  science: '#2f5394',
  outdoors: '#3d6b28',
  fitness: '#7a4a2a',
  music: '#4b3fa0',
  screen: '#8e1f2f',
  arts: '#8a2f8a',
  money: '#55606b',
  homebase: '#1d2b4a',
};

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** Deterministic tilt so a sub's stamp always lands the same way. */
export const tiltOf = (s: string, range = 10): number => (hash(s) % (range * 2 + 1)) - range;
