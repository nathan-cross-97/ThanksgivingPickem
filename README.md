# Thanksgiving Pick'Em — live tracker

A static web page that shows everyone's picks, live scores, projections and win odds for the annual Thanksgiving pick'em.
There's no server and no API keys. The page fetches everything in the visitor's browser:

| What | Source |
| --- | --- |
| Entrants, picks, paid status, tiebreakers, payouts | The Google Sheet (`Scoresheet`, `Players to Choose From`, `Rules` tabs), read live |
| Live player stats | Sleeper `api.sleeper.app/stats/nfl/{season}/{week}` |
| Scoring rules | The Sleeper league "The Snake" (half PPR; INT −2; league D/ST tiers) |
| Projections | Sleeper `api.sleeper.app/projections/nfl/{season}/{week}` |
| History for the charts | `history.json` on the `data` branch, written by the snapshot workflow |
| Game clock and scores | ESPN scoreboard, with Sleeper's scores feed as a backup |

The page refreshes every 60 seconds.

## Charts over time
The page only knows the current moment, so a scheduled GitHub Action (`.github/workflows/snapshot.yml`) saves a snapshot of everyone's points, projection and win odds every few minutes during the games.
It runs `scripts/snapshot.js` and commits `history.json` to a `data` branch, which the page reads for the "The race" chart.
The workflow must be on the default branch (`main`) to run on its schedule. Update its cron dates each year.

## What's on the page
- **Games:** live score and clock for each game. The Broncos–Steelers game is marked as the tiebreaker game.
- **Pot:** number of entrants and paid entrants, plus the 1st/2nd/3rd payouts from the Rules tab.
- **Leaderboard:** points, projected final, win %, top-3 %, expected winnings, players still to play, and tiebreaker pick. Click a row to see the lineup.
- **Most picked:** how many people picked each player.

**Proj** is points so far plus the player's projection for the time left in their game. For example, a player projected for 18 with a quarter left adds 4.5.
**Win %, Top 3 and Exp $** come from 10,000 simulated finishes. Each player's remaining output varies around their projection, and the Broncos–Steelers total settles ties.

## Hosting (GitHub Pages)
1. Go to the repo's **Settings → Pages**.
2. Under **Build and deployment**, pick **Deploy from a branch**, then choose the branch and the `/ (root)` folder.
3. The site appears at `https://<user>.github.io/<repo>/`.

To run it locally, run `python3 -m http.server` in this folder and open http://localhost:8000.

## Next year
Edit `config.js`:
- `season` and `week`
- `espnDates`
- `tiebreakerGame`
- `lockTime`
- the sheet's `sheetId` and tab `gid`s, if it's a new sheet
- `sleeperLeagueId`, if the league changes

The sheet must stay shared as "anyone with the link can view".
