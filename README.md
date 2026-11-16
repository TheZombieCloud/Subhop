# Subhop

A daily Reddit race game on Devvit Web. You get from one community to another by hopping through "members also hang out in" neighbours. Each community has six exits. Fewest hops wins, and time breaks ties.

## Layout

| Path | What it is |
| --- | --- |
| `src/shared/graph.json` | The map: `name: [description, [6 exits]]`. 500 communities built from real data (see below). |
| `scripts/build-puzzles.mjs` | Validates the graph, runs BFS over every pair and writes `src/shared/puzzles.json` (par 3–4, few optimal routes). Runs automatically before `build`. |
| `src/server/core/game.ts` | Game rules and Redis schema (documented at the top of the file). |
| `src/server/core/net.ts` | The map a puzzle is played on: home destination, twists, par under twists. |
| `src/server/core/peek.ts` | Live member count and top post for the sub you're in (cached 6h). |
| `src/server/routes/api.ts` | `/api/init`, `/api/start`, `/api/hop`, `/api/back`, `/api/giveup`, `/api/leaderboard`, `/api/share` |
| `src/server/routes/{menu,forms,scheduler,triggers}.ts` | Mod menu (home setup, daily post, test post), the home setup form, midnight-UTC cron and the install trigger. |
| `src/client/splash.tsx` | Inline feed card. |
| `src/client/game.tsx` | Intro, playing, results and leaderboard screens. |

**Devvit Journeys** (`src/server/core/journey.ts`, `src/client/journey.ts`) track each play: App.Ready when the game loads, Journey.Start on "Start the journey", Journey.Progress after every validated hop (how much closer you got, under the day's twist), Journey.Interaction for step back, share, leaderboard, stats, propose and vote, and Journey.End on arrival (score = hops) or give up. Progress and End are sent by the server, so they can't be faked from the browser.

The server validates every hop. The client only sends "I clicked X", so people can't cheat by editing requests.

## Look: the passport

Subhop is styled as a travel passport: cream paper, a navy cover, ticket stubs for exits, and an ink stamp for every community you pass through. The results page is your stamp collection, finished with an ARRIVED stamp. Type is Reddit's own family (Reddit Sans, Reddit Sans Condensed, Reddit Mono, all SIL OFL), bundled locally through `@fontsource`.

- **Stamps are the communities.** Each stamp prints the community's real icon in ink (fetched by `/api/icons`, cached 7 days; Reddit-hosted URLs only). A community with no icon, or one the webview won't load, gets its name set large instead (`src/client/passport.tsx`, `src/client/icons.ts`).
- **Districts.** Every sub belongs to one of 17 districts (`src/shared/districts.json`, checked by `npm run puzzles`). A district sets the ink colour (`src/client/ink.ts`) and the label on tickets.
- **Contrast.** Every ink and text colour passes WCAG AA (4.5:1) on all three paper tones.
- **Sharing.** "Post my result" comments three plain lines: the journey, hops against par with time and rank, then how it went ("Clean run, every hop got closer." or "2 wrong turns, stepped back once.") plus new stamps. It never names a community in between, so it can't spoil the route.
- **Passport collection.** Every community you pass through is stamped into your passport for good (`passport:{user}`, `src/server/core/passport.ts`). The first visit gets a "New stamp" mark during play, results show "+N new stamps · X of 500", and the passport page lists every community by district.
- **Rival line.** Results name the arrival one place ahead of you ("1 hop behind u/name").

## Daily variety

- **Home community.** Mods pick **Subhop: set up home community** and choose where their community sits: journeys end there, start there, alternate daily, or off. If it isn't on the map, they pick 2–6 subs their members also hang out in (pre-filled from the sidebar's "Related communities" list), and those become its doors. Applies from the next daily.
- **Players pick tomorrow.** After playing, anyone can propose tomorrow's journey (two subs 3–5 hops apart; the home end is fixed if mods set one) and vote on others' (one vote each, switchable). The most-voted valid proposal at midnight UTC becomes the next daily, credited "picked by u/name" in the title, intro and shared comments. With no votes, the daily falls back to the home journey or the pool. Code: `src/server/core/proposals.ts`, `src/client/proposals.tsx`; checks shared in `src/shared/rules.ts`.
- **Follow and streak flair.** The results page ends with a ticket to follow the subreddit (runs as the player, `SUBSCRIBE_TO_SUBREDDIT`; hidden once they've followed). Finishing a daily sets the player's user flair to "Subhop · N-day streak" in navy, but only over no flair or flair Subhop set itself, never over flair the member or a mod chose (`src/server/core/social.ts`).
- **Twist days (UTC).** Wednesday Border closed (a sub on the obvious route is closed), Friday Detour (must pass through a sub), Sunday No return (no stepping back). Par is recomputed with the twist applied. Test posts get a random twist.

## Run it

Requires **Node 24+**.

```sh
npm install
npm run login     # devvit login
npm run dev       # devvit playtest: opens a live post in your test subreddit
```

In the test subreddit, use the subreddit menu to pick **Subhop: post a test puzzle**. It creates a random puzzle with its own leaderboard.

After changing code, `devvit upload` stores a new version but doesn't update the test subreddit. Follow it with `npx devvit install subhopgame_dev`.

```sh
npm run deploy    # type-check + lint + devvit upload
npm run launch    # + devvit publish (submits for review)
```

## Recordings (review without playing)

```sh
npm run record                 # build the demo and record every scenario
npm run record -- detour home  # only scenarios whose name contains these words
```

This builds the real client against an in-memory mock backend (`demo/mock.ts`), which uses the shared rules in `src/shared/rules.ts`. It then plays scripted scenarios in a phone-sized headless Chrome and writes MP4s and stills to `recordings/`. Open `recordings/index.html` to watch them. Players, crowd stats and peeks are fake. Scenarios live in `scripts/record.mjs`. Needs Chrome or Edge and ffmpeg.

## Where the map comes from

The 500 communities and their exits come from real overlap data: the [Map of Reddit](https://github.com/anvaka/map-of-reddit-data) graph, which links subreddits by how many people comment in both. Communities are the biggest ones with a clear topic (no NSFW, memes-only, politics or drama subs), chosen by real subscriber count and balanced across districts.

- About 89% of exits are direct real links: each community's strongest neighbours on the map, with no community allowed to be an exit for more than 14 others.
- The rest are two-step real links (A's members hang out in X, whose members hang out in B), used only where a community has fewer than six direct links on the map.
- Hand tuning, kept small: each district has a gateway (r/Cooking, r/gaming, r/Fitness and so on) that keeps its 3 strongest real exits and gets 3 into its district's biggest communities, through real links; the general hubs (r/AskReddit, r/pics, r/todayilearned and so on) keep their 2 strongest real exits and get 4 out to gateways. Every community can reach every other.
- General hubs are only ever passed through: puzzles never start or end at one.

The data dates from around 2021, so communities created since (r/Eldenring, r/SteamDeck) aren't on the map.

## Editing the graph

Edit `src/shared/graph.json`, then run `npm run puzzles`. The script fails if any sub doesn't have exactly six exits, links to an unknown sub, or can't be reached. Puzzle #1 is pinned to r/batman → r/knitting (via cosplay and sewing).

Puzzles are also checked for fairness. The script simulates a player who sees only exit names and districts, never the map, and plays each candidate 24 times. A puzzle is kept only if at least 60% of those runs arrive within par + 2, so a hard day is hard because the route is clever, not because the map is a maze. `node scripts/map/unsupported.mjs <parsed.json>` lists exits with no support in the overlap data. Seven weak cross-topic ones were swapped for real links (listed in the script); the rest are intuitive and kept.
