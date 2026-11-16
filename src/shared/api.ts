export type Exit = { name: string };

/** Weekly rule changes. Par is always computed with the twist applied. */
export type Twist =
  | { kind: 'avoid'; sub: string } // Roadblock: this sub is closed today
  | { kind: 'via'; sub: string } // Detour: you must pass through this sub
  | { kind: 'noback' }; // No return: stepping back is off

export type Puzzle = {
  id: string; // YYYY-MM-DD for daily puzzles, test-<ts> for mod test posts
  number: number; // Daily #N
  start: string;
  target: string;
  par: number;
  twist: Twist | null;
  home: HomeSide | null; // which end is the community this post lives in
  homeExits: string[]; // only when home isn't on the built-in map: the subs mods linked it to
  by: string | null; // username of the player who proposed this journey
};

export type HomeSide = 'start' | 'end';

export type RunStatus = 'playing' | 'finished' | 'gaveup';

export type Run = {
  status: RunStatus;
  path: string[]; // every node visited, including start (backtracks removed)
  hops: number; // includes +1 penalty for each step back
  moves?: string; // one letter per move: c = got closer, s = sideways or further, b = stepped back
  startedAt: number;
  finishedAt?: number;
};

export type NodeView = {
  name: string;
  description: string;
  exits: string[];
};

export type LeaderboardRow = {
  rank: number;
  username: string;
  hops: number;
  timeMs: number;
  avatar: string | null; // Reddit avatar image, if they have one
};

export type PathStat = { path: string[]; hops: number; count: number };

export type Tally = { name: string; count: number };

/** What everyone else did. Only revealed after you've played. */
export type Crowd = {
  finishers: number;
  hopCounts: { hops: number; count: number }[]; // histogram of final scores (incl. step-back penalties)
  firstMoves: Tally[]; // every exit of the start, including ones nobody picked
  firstTotal: number; // everyone who made at least one move (finishers and quitters)
  hubs: Tally[]; // the subs finishers passed through most (not start or target)
  sameRoute: number | null; // other finishers on your exact route; null if you didn't finish
  topPct: number | null; // "top N%"; null if you didn't finish or you're alone
};

/** Your stamp collection: every community you've ever passed through. */
export type PassportSummary = {
  collected: number;
  total: number;
  fresh: string[]; // first stamped on this journey
};

export type PassportResponse = { collected: string[]; total: number };

export type Results = {
  run: Run;
  timeMs: number;
  rank: number | null; // null if gave up
  myAvatar: string | null; // your Reddit avatar, for your leaderboard row
  rival: LeaderboardRow | null; // the arrival just ahead of you (null if you lead or didn't arrive)
  passport: PassportSummary;
  players: number;
  top: LeaderboardRow[];
  mostCommon: PathStat | null;
  weirdest: PathStat | null;
  optimal: string[];
  crowd: Crowd;
};

export type InitResponse = {
  username: string | null;
  puzzle: Puzzle;
  streak: number;
  players: number;
  best: LeaderboardRow | null; // today's leader, for the feed card
  run: Run | null;
  node: NodeView | null; // current node if mid-run
  results: Results | null; // if already finished/gave up
  subreddit: string; // where the app is installed
  following: boolean; // tapped Follow on a results page before
};

// subscribed: false when Reddit won't let the app follow for the player; the client then opens the subreddit.
export type FollowResponse = { ok: true; subscribed: boolean };

export type StartResponse = { run: Run; node: NodeView };

export type HopRequest = { to: string };
export type HopResponse =
  | { status: 'playing'; run: Run; node: NodeView; newStamp: boolean }
  | { status: 'finished'; results: Results; streak: number };

export type BackResponse = { run: Run; node: NodeView };
export type GiveUpResponse = { results: Results };
export type LeaderboardResponse = { rows: LeaderboardRow[]; you: LeaderboardRow | null };
export type ShareResponse = { ok: true; commentUrl: string | null };

/** A glimpse of the community you just hopped into. */
export type Peek = {
  name: string;
  members: number | null;
  online: number | null;
  top: { title: string; score: number; comments: number } | null; // top post this week
};
export type PeekResponse = { peek: Peek | null };

/** Community icon URLs (Reddit-hosted), null when a sub has none. */
export type IconsResponse = { icons: Record<string, string | null> };

/** A player's suggestion for tomorrow's daily journey. */
export type Proposal = {
  key: string; // "start>target"
  start: string;
  target: string;
  hops: number; // shortest route, before any twist
  votes: number;
  by: string;
};

export type ProposalsResponse = {
  day: string; // the daily these proposals compete for (YYYY-MM-DD)
  number: number;
  home: string | null; // fixed end of tomorrow's journey, if mods set one
  homeSide: HomeSide | null;
  homeExits: string[]; // so the client can measure routes through an off-map home
  items: Proposal[];
  myVote: string | null;
  myProposal: string | null;
  canPropose: boolean; // false until you've finished or given up today's journey
};
export type ProposeRequest = { start: string; target: string };
export type VoteRequest = { key: string };

export type ErrorResponse ={ status: 'error'; message: string };
