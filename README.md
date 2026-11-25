# Subhop

A daily puzzle where the player must find the shortest path between two subreddits.

## How it works

Each day there is a new puzzle released, typically with a start point and an end point (e.g. r/batman to r/knitting). Each puzzle is marked easy, medium or hard, and the puzzles get harder through the week. The player must then find the shortest path between the two points. The subreddits that a player can travel to from any given subreddit are the 6 exit points for that subreddit, which are the 6 subreddits that the same people comment in.

After each hop the game shows whether the player is warmer or colder. The player collects a stamp for each subreddit that the player travels through, and there is a passport page that shows all 500 stamps. Each puzzle has a leaderboard (fewest hops first, then fastest time). Once the player has completed the puzzle the player can vote for the next days puzzle or propose one.

On some days there is an extra rule:

- Wednesday: one subreddit on the route is closed
- Friday: the player must pass through a given subreddit first
- Sunday: the player cannot step back

## For moderators

When the app is installed it posts the first puzzle, and after that it posts a new puzzle each day at midnight UTC. No setup is needed.

These are the menu items (in the subreddit menu unless stated):

- **Subhop: set up home community** sets your own subreddit as the start point or end point of the daily puzzles. If your subreddit is not one of the 500 on the map, you choose 2 to 6 related subreddits to connect it to.
- **Subhop: post today's puzzle** posts the daily puzzle by hand.
- **Subhop: re-roll today's puzzle** replaces the daily puzzle with a new one (only for a day nobody has played).
- **Subhop: stats for this puzzle** (in the post menu) shows how many players started, finished and gave up, as well as where they gave up.
- **Subhop: add results threads to past posts** adds the stickied "Results thread" comment to Subhop posts made before the app started adding it. It can be run more than once.
- **Subhop: post a test puzzle** posts a random puzzle with its own leaderboard.

## What the app does as the player

- It posts the players result as a comment from the players own account, only when the player presses the button for it. The comment is a reply to a single stickied "Results thread" comment that the app makes on each puzzle post, so results stay out of the way of the discussion. The path is not included so the puzzle is not spoiled for other players. The player can delete the comment like any other comment.
- It follows the subreddit for the player, only when the player presses the follow button.
- It sets the players user flair to their streak (e.g. "Subhop · 3-day streak"). It does not replace a flair that the player or a moderator chose.

## Data

The app stores each players runs, scores, stamps and streak under their username. Any player can remove all of it with **Subhop: delete my data** in the subreddit menu.

## Where the map comes from

The map is powered by anvaka's [Map of Reddit](https://github.com/anvaka/map-of-reddit-data), which is a dataset of subreddits linked by shared commenters. It is limited to 500 subreddits with 6 exits each, and 2,640 of the 3,000 exits are direct links from the dataset. The data is from around 2021, so newer subreddits are not on the map.

Notes on the code are in DEVELOPMENT.md.
