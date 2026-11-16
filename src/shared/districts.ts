import districtsJson from './districts.json';

/*
 * The map is split into themed districts. Each sub belongs to exactly one
 * (validated by scripts/build-puzzles.mjs). A community that isn't on the map
 * (an off-map home destination) lives in "homebase".
 */

export const DISTRICT_IDS = [
  'crafts',
  'food',
  'home',
  'world',
  'motors',
  'sports',
  'animals',
  'lounge',
  'gaming',
  'tech',
  'science',
  'outdoors',
  'fitness',
  'music',
  'screen',
  'arts',
  'money',
  'homebase',
] as const;

export type DistrictId = (typeof DISTRICT_IDS)[number];

/** `code` is the three-letter mark printed on passport stamps and in shared results. */
export type District = { name: string; code: string };

export const DISTRICTS: Record<DistrictId, District> = {
  crafts: { name: 'Maker’s Quarter', code: 'MKR' },
  food: { name: 'Food Hall', code: 'KIT' },
  home: { name: 'Home & Style', code: 'HSE' },
  world: { name: 'Departures', code: 'WLD' },
  motors: { name: 'The Paddock', code: 'PDK' },
  sports: { name: 'The Stadium', code: 'STD' },
  animals: { name: 'The Petting Zoo', code: 'ZOO' },
  lounge: { name: 'Town Square', code: 'TSQ' },
  gaming: { name: 'The Arcade', code: 'ARC' },
  tech: { name: 'Server Room', code: 'SRV' },
  science: { name: 'Observatory', code: 'OBS' },
  outdoors: { name: 'The Wilds', code: 'WIL' },
  fitness: { name: 'The Gym', code: 'GYM' },
  music: { name: 'The Venue', code: 'VEN' },
  screen: { name: 'The Cinema', code: 'CIN' },
  arts: { name: 'The Studio', code: 'STU' },
  money: { name: 'The Exchange', code: 'EXC' },
  homebase: { name: 'Home', code: 'HQ' },
};

const isDistrictId = (v: string): v is DistrictId => DISTRICT_IDS.some((d) => d === v);

const bySub = new Map<string, DistrictId>();
for (const [id, subs] of Object.entries(districtsJson)) {
  if (!isDistrictId(id)) continue;
  for (const s of subs) bySub.set(s, id);
}

export const districtOf = (sub: string): DistrictId => bySub.get(sub) ?? 'homebase';
/** Spoiler-free route for sharing: start and finish named, every stop in between hidden. */
export const stampTrail = (path: string[]): string =>
  path.map((n, i) => (i === 0 || i === path.length - 1 ? `r/${n}` : '?')).join(' › ');

export const district = (sub: string): District & { id: DistrictId } => {
  const id = districtOf(sub);
  return { id, ...DISTRICTS[id] };
};
