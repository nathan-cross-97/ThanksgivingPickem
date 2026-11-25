#!/usr/bin/env node
/* Saves one point of history (points, projection, win odds per entrant) for the charts.
   Run by .github/workflows/snapshot.yml every few minutes. Usage: node scripts/snapshot.js <history.json> */
const fs = require("fs");
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "config.js"));
const core = require(path.join(__dirname, "..", "core.js"))(global.window.PICKEM_CONFIG);

const file = process.argv[2] || "history.json";
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

(async () => {
  let history = [];
  try { history = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { /* first run */ }

  const data = await core.compute();
  if (data.errors.length) { console.log("Skipping: a source failed:", data.errors.join("; ")); return; }
  if (!data.games.length || !data.active.length) { console.log("Skipping: no games or no lineups yet."); return; }

  const sig = data.games.map((g) => g.state).join(",");
  const anyLive = data.games.some((g) => g.state === "in");
  const allDone = data.games.every((g) => g.state === "post");
  const last = history[history.length - 1];
  const now = Date.now();
  // Save while a game is on, whenever a game starts or ends, and hourly before/between games.
  const due = !last || anyLive || last.sig !== sig || (!allDone && now - last.t > 55 * 60 * 1000);
  if (!due) { console.log("Nothing new to save."); return; }

  const e = {};
  for (const x of data.active) e[x.name] = [round(x.points, 2), round(x.projected, 2), round(x.pFirst, 3), round(x.pTop3, 3)];
  history.push({ t: now, sig, live: data.games.filter((g) => g.state === "in").map((g) => `${g.away.abbr}-${g.home.abbr}`), e });
  fs.writeFileSync(file, JSON.stringify(history));
  console.log(`Saved snapshot ${history.length} (${sig}) for ${data.active.length} lineups.`);
})().catch((err) => { console.error(err); process.exit(1); });
