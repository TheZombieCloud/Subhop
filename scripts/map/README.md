# Rebuilding the map

The map in `src/shared/graph.json` was built from the Map of Reddit data. Only needed if you want to rebuild it.

1. Download `graph/reddit-graph.dot` (about 18 MB) from https://github.com/anvaka/map-of-reddit-data into a folder outside the repo.
2. `node scripts/map/parse.mjs <reddit-graph.dot> <work>/parsed.json`
3. Restore the pre-500 map as the base (the kept communities and their districts), then:
   `node scripts/map/build.mjs <work>/parsed.json scripts/map/picks.txt <base graph.json> <base districts.json> <work>/out 500 14`
   picks.txt lists candidate communities per district; the script ranks them by real size and drops any with fewer than 3 real links to the rest.
4. `node scripts/map/tune.mjs <work>/parsed.json <work>/out <work>/tuned` wires general hubs and district gateways (see the main README).
5. Fill in descriptions from scripts/map/descs.json, copy the result into src/shared/, then `npm run puzzles`.

`analyze.mjs <graph.json>` prints distances and puzzle counts; `sample.mjs <graph.json> <districts.json>` prints sample routes.
