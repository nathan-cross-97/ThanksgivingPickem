/* Thanksgiving Pick'Em live tracker. No build step, no server: everything is fetched from the browser. */
(() => {
  const C = window.PICKEM_CONFIG;
  const SLOTS = ["QB", "RB", "WR", "TE", "D/ST", "K", "FLEX 1", "FLEX 2"];
  const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

  const TEAM_ABBR = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
    "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE",
    "Dallas Cowboys": "DAL", "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
    "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA",
    "Minnesota Vikings": "MIN", "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF",
    "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
  };
  const ESPN_FIX = { WSH: "WAS", JAC: "JAX" };

  // ---- state ----
  const state = {
    sort: "points",
    expanded: new Set(),
    projections: null, projectionsAt: 0,
    scoring: null,
    payouts: null,
    data: null,
  };

  // ---- utils ----
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 1) => (n == null || isNaN(n) ? "–" : n.toFixed(d));
  const pct = (p) => (p == null ? "–" : p === 0 ? "0%" : p < 0.005 ? "<1%" : p > 0.995 && p < 1 ? ">99%" : Math.round(p * 100) + "%");
  const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);

  function parseCSV(text) {
    const rows = []; let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const norm = (s) => String(s || "").toLowerCase().replace(/[.'’,-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  async function getSheet(gid, range) {
    const url = `https://docs.google.com/spreadsheets/d/${C.sheetId}/gviz/tq?tqx=out:csv&headers=0&gid=${gid}` + (range ? `&range=${range}` : "") + `&_=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Sheet ${r.status}`);
    return parseCSV(await r.text());
  }
  const sleeperURL = (kind) =>
    `https://api.sleeper.app/${kind}/nfl/${C.season}/${C.week}?season_type=regular&` + POSITIONS.map((p) => `position[]=${p}`).join("&");

  // ---- sources ----
  async function loadEntries() {
    const rows = await getSheet(C.gids.scoresheet, "A1:BZ20");
    const label = (r) => (r[1] || "").trim().toUpperCase();
    const qbRow = rows.findIndex((r) => label(r) === "QB");
    if (qbRow < 1) throw new Error("Couldn't find the QB row on the Scoresheet tab");
    const names = rows[qbRow - 1], paidRow = rows[qbRow - 2] || [];
    const rowFor = (lab) => rows.find((r) => label(r) === lab.toUpperCase()) || [];
    const slotRows = SLOTS.map(rowFor);
    const tbRow = rowFor("Tiebreaker"), validRow = rowFor("Valid?");
    const entries = [];
    for (let c = 2; c < names.length; c++) {
      const name = (names[c] || "").trim();
      if (!name) continue;
      const picks = SLOTS.map((slot, i) => ({ slot, label: (slotRows[i][c] || "").trim() }));
      const tb = parseFloat(tbRow[c]);
      entries.push({
        name, picks,
        tiebreaker: isNaN(tb) ? null : tb,
        paid: /yes/i.test(paidRow[c] || ""),
        valid: (validRow[c] || "").trim().toUpperCase(),
        hasPicks: picks.some((p) => p.label),
      });
    }
    return entries;
  }

  // Map "J. Gibbs" -> { full: "Jahmyr Gibbs", team: "DET" } using the Players to Choose From tab.
  async function loadPlayerGrid() {
    const rows = await getSheet(C.gids.playersToChooseFrom, "A1:AZ30");
    const hdrIdx = rows.findIndex((r) => r.filter((x) => TEAM_ABBR[x.trim()]).length >= 4);
    if (hdrIdx < 0) return {};
    const hdr = rows[hdrIdx];
    const cols = hdr.map((x, i) => [x.trim(), i]).filter(([x]) => TEAM_ABBR[x]);
    const half = Math.floor(cols.length / 2);
    const map = {};
    for (let k = 0; k < half; k++) {
      const [teamName, fullCol] = cols[k];
      const abbrCol = cols[k + half][1];
      for (let r = hdrIdx + 1; r < rows.length; r++) {
        const abbr = (rows[r][abbrCol] || "").trim(), full = (rows[r][fullCol] || "").trim();
        if (abbr && full) map[abbr] = { full, team: TEAM_ABBR[teamName] };
      }
    }
    return map;
  }

  async function loadPayouts(paidCount) {
    try {
      const rows = await getSheet(C.gids.rules, "A1:J30");
      const i = rows.findIndex((r) => r.some((x) => /% of total/i.test(x)));
      if (i >= 0) {
        const vals = [1, 2, 3].map((k) => {
          const cell = (rows[i + k] || []).find((x) => /^\$[\d,.]+$/.test(x.trim()));
          return cell ? parseFloat(cell.replace(/[$,]/g, "")) : NaN;
        });
        if (vals.every((v) => !isNaN(v) && v > 0)) return vals;
      }
    } catch (e) { /* fall back */ }
    const pot = paidCount * C.buyIn;
    return C.payoutSplit.map((s) => pot * s);
  }

  async function loadScoring() {
    try {
      const l = await getJSON(`https://api.sleeper.app/v1/league/${C.sleeperLeagueId}`);
      return l.scoring_settings || null;
    } catch (e) { return null; }
  }

  async function loadGames() {
    // ESPN rejects multi-day ranges for this endpoint, so ask for each day.
    const [from, to] = C.espnDates.split("-");
    const days = [];
    const day = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)));
    for (let i = 0; i < 7; i++) {
      const s = day.toISOString().slice(0, 10).replace(/-/g, "");
      days.push(s);
      if (s >= (to || from)) break;
      day.setUTCDate(day.getUTCDate() + 1);
    }
    const boards = await Promise.all(days.map((s) => getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${s}`)));
    const seen = new Set();
    const events = boards.flatMap((b) => b.events || []).filter((e) => !seen.has(e.id) && seen.add(e.id));
    if (!events.length) throw new Error("No ESPN games");
    const games = [];
    for (const ev of events) {
      const comp = ev.competitions[0];
      const st = ev.status || comp.status;
      const teams = comp.competitors.map((t) => ({
        abbr: ESPN_FIX[t.team.abbreviation] || t.team.abbreviation,
        home: t.homeAway === "home",
        score: parseInt(t.score || "0", 10),
        logo: t.team.logo,
      }));
      const away = teams.find((t) => !t.home), home = teams.find((t) => t.home);
      const state_ = st.type.state; // pre | in | post
      let remaining = 1;
      if (state_ === "post") remaining = 0;
      else if (state_ === "in") {
        const p = st.period || 1, clock = st.clock || 0;
        remaining = p > 4 ? 0 : Math.max(0, ((4 - p) * 900 + clock) / 3600);
      }
      const ou = comp.odds && comp.odds[0] && comp.odds[0].overUnder;
      games.push({
        id: ev.id, date: new Date(ev.date), state: state_, remaining,
        detail: st.type.shortDetail || st.type.detail || "",
        away, home, overUnder: ou ? parseFloat(ou) : null,
        possession: comp.situation && comp.situation.possession,
      });
    }
    return games;
  }

  // Backup game feed (Sleeper) in case ESPN is unreachable from the browser.
  async function loadGamesSleeper() {
    const d = await getJSON(`https://api.sleeper.app/scores/nfl/regular/${C.season}/${C.week}`);
    const [from, to] = C.espnDates.split("-").map((s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    return d.filter((g) => g.date >= from && g.date <= (to || from)).map((g) => {
      const m = g.metadata || {};
      const state_ = m.is_over || g.status === "complete" ? "post" : m.is_in_progress || g.status === "in_game" ? "in" : "pre";
      let remaining = state_ === "post" ? 0 : 1, detail = "";
      if (state_ === "in") {
        const q = parseInt(m.quarter_num, 10) || 1;
        const [mm, ss] = String(m.time_remaining || "15:00").split(":").map((x) => parseInt(x, 10) || 0);
        remaining = q > 4 || m.is_overtime ? 0 : Math.max(0, ((4 - q) * 900 + mm * 60 + ss) / 3600);
        detail = (m.is_overtime ? "OT" : `Q${q}`) + " " + (m.time_remaining || "");
      }
      return {
        id: g.game_id, date: new Date(g.start_time || m.date_time), state: state_, remaining, detail,
        away: { abbr: m.away_team, home: false, score: m.away_score || 0 },
        home: { abbr: m.home_team, home: true, score: m.home_score || 0 },
        overUnder: null,
      };
    }).sort((a, b) => a.date - b.date);
  }

  function score(stats) {
    if (!stats) return 0;
    const S = state.scoring;
    if (!S) return stats.pts_half_ppr || 0;
    let t = 0, any = false;
    for (const k in stats) if (k in S) { t += stats[k] * S[k]; any = true; }
    return any ? t : stats.pts_half_ppr || 0;
  }

  // ---- matching ----
  function buildIndex(projList) {
    const byKey = new Map(), byId = new Map(), byTeam = new Map();
    for (const r of projList) {
      const p = r.player || {};
      const team = r.team || p.team;
      if (!team) continue;
      const info = { id: r.player_id, name: `${p.first_name || ""} ${p.last_name || ""}`.trim(), first: p.first_name || "", last: p.last_name || "", pos: p.position, team, proj: r.stats || {} };
      byId.set(info.id, info);
      byKey.set(norm(info.name) + "|" + team, info);
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(info);
    }
    return { byKey, byId, byTeam };
  }

  function resolvePick(label, slot, grid, idx, teams) {
    if (!label) return null;
    if (TEAM_ABBR[label]) return idx.byId.get(TEAM_ABBR[label]) || { id: TEAM_ABBR[label], name: label, pos: "DEF", team: TEAM_ABBR[label], proj: {} };
    const g = grid[label];
    if (g) {
      const hit = idx.byKey.get(norm(g.full) + "|" + g.team);
      if (hit) return hit;
      const last = norm(g.full).split(" ").slice(1).join(" ");
      const cands = (idx.byTeam.get(g.team) || []).filter((p) => norm(p.last) === last && p.pos !== "DEF");
      if (cands.length) return cands.sort((a, b) => score(b.proj) - score(a.proj))[0];
    }
    // Fallback: "J. Gibbs" / "Jav. Williams" against the teams playing.
    const m = label.match(/^([A-Za-z.']+)\.?\s+(.+)$/);
    if (m) {
      const pre = norm(m[1]), last = norm(m[2]);
      const cands = [];
      for (const t of teams) for (const p of idx.byTeam.get(t) || []) if (norm(p.last) === last && norm(p.first).startsWith(pre)) cands.push(p);
      if (cands.length) return cands.sort((a, b) => score(b.proj) - score(a.proj))[0];
    }
    return { id: null, name: label, pos: slot, team: g ? g.team : null, proj: {}, unmatched: true };
  }

  // ---- simulation ----
  const CV = { QB: 0.45, RB: 0.6, WR: 0.7, TE: 0.75, K: 0.5, DEF: 0.9 };
  const FLOOR = { QB: 4, RB: 3, WR: 3, TE: 2.5, K: 3, DEF: 4 };
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function simulate(entries, players, tbGame, n) {
    const ids = [...players.keys()];
    const pIndex = new Map(ids.map((id, i) => [id, i]));
    const P = ids.map((id) => players.get(id));
    const E = entries.map((e) => ({ slots: e.lineup.filter((l) => l.player && l.player.key).map((l) => pIndex.get(l.player.key)), tb: e.tiebreaker }));
    const K = Math.min(3, E.length);
    const counts = E.map(() => new Float64Array(K));
    const tbNow = tbGame ? tbGame.away.score + tbGame.home.score : 0;
    const tbRemMean = tbGame ? Math.max(0, (tbGame.overUnder || 40) * tbGame.remaining) : 0;
    const tbSd = tbGame ? 10 * Math.sqrt(tbGame.remaining) : 0;
    const draw = new Float64Array(P.length);
    const totals = new Float64Array(E.length);
    const order = E.map((_, i) => i);
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < P.length; i++) {
        const p = P[i], f = p.remaining;
        if (f <= 0) { draw[i] = p.actual; continue; }
        const mean = p.projFull * f;
        const sd = Math.max(CV[p.pos] * p.projFull, FLOOR[p.pos] || 3) * Math.sqrt(f);
        draw[i] = p.actual + Math.max(-3, mean + sd * gauss());
      }
      const tbTotal = tbNow + Math.max(0, Math.round(tbRemMean + tbSd * gauss()));
      for (let e = 0; e < E.length; e++) { let t = 0; for (const k of E[e].slots) t += draw[k]; totals[e] = Math.round(t * 100) / 100; }
      order.sort((a, b) => totals[b] - totals[a] || tbDist(E[a].tb, tbTotal) - tbDist(E[b].tb, tbTotal));
      for (let k = 0; k < K; k++) counts[order[k]][k] += 1;
    }
    return counts.map((c) => Array.from(c, (x) => x / n));
  }
  const tbDist = (pick, actual) => (pick == null ? 1e9 : Math.abs(pick - actual));

  // ---- main refresh ----
  async function refresh() {
    $("#status").textContent = "Updating…";
    const errors = [];
    const now = Date.now();
    const needProj = !state.projections || now - state.projectionsAt > 10 * 60 * 1000;
    const [entries, grid, games, stats, proj, scoring] = await Promise.all([
      loadEntries().catch((e) => (errors.push("Picks sheet: " + e.message), null)),
      loadPlayerGrid().catch(() => ({})),
      loadGames().catch(() => loadGamesSleeper()).catch((e) => (errors.push("Game scores: " + e.message), [])),
      getJSON(sleeperURL("stats")).catch((e) => (errors.push("Sleeper stats: " + e.message), [])),
      needProj ? getJSON(sleeperURL("projections")).catch((e) => (errors.push("Sleeper projections: " + e.message), null)) : Promise.resolve(state.projections),
      state.scoring ? Promise.resolve(state.scoring) : loadScoring(),
    ]);
    if (proj) { state.projections = proj; if (needProj) state.projectionsAt = now; }
    state.scoring = scoring;
    if (!entries) { renderErrors(errors); $("#status").textContent = "Couldn't load picks"; return; }

    const paidCount = entries.filter((e) => e.paid).length;
    if (!state.payouts || state.payouts._paid !== paidCount) { state.payouts = await loadPayouts(paidCount); state.payouts._paid = paidCount; }

    const teamGame = new Map();
    for (const g of games) { teamGame.set(g.away.abbr, g); teamGame.set(g.home.abbr, g); }
    const teams = [...teamGame.keys()];
    const idx = buildIndex(state.projections || []);
    const statById = new Map((stats || []).map((r) => [r.player_id, r.stats || {}]));

    const players = new Map();
    const lineups = entries.map((e) => {
      const lineup = e.picks.map((pk) => {
        const info = resolvePick(pk.label, pk.slot, grid, idx, teams);
        if (!info) return { ...pk, player: null };
        const key = info.id || "?" + pk.label;
        if (!players.has(key)) {
          const g = teamGame.get(info.team);
          const remaining = g ? g.remaining : 1;
          const actual = info.id ? score(statById.get(info.id)) : 0;
          const projFull = score(info.proj);
          players.set(key, {
            key, ...info, game: g, remaining, actual, projFull,
            live: actual + projFull * remaining,
            pos: info.pos === "DEF" ? "DEF" : info.pos,
            owners: 0,
          });
        }
        const p = players.get(key);
        p.owners++;
        return { ...pk, player: p };
      });
      const points = lineup.reduce((s, l) => s + (l.player ? l.player.actual : 0), 0);
      const projected = lineup.reduce((s, l) => s + (l.player ? l.player.live : 0), 0);
      const left = lineup.filter((l) => l.player && l.player.remaining > 0).length;
      return { ...e, lineup, points, projected, left };
    });

    const active = lineups.filter((e) => e.hasPicks);
    const tbGame = games.find((g) => C.tiebreakerGame.includes(g.away.abbr) && C.tiebreakerGame.includes(g.home.abbr));
    const probs = active.length ? simulate(active, players, tbGame, C.simulations) : [];
    active.forEach((e, i) => {
      const pr = probs[i] || [];
      e.pFirst = pr[0] || 0;
      e.pTop3 = pr.reduce((a, b) => a + b, 0);
      e.ev = pr.reduce((s, p, k) => s + p * (state.payouts[k] || 0), 0);
    });

    if (!state.data && games.length && games.every((g) => g.state === "pre")) state.sort = "projected";
    state.data = { entries: lineups, active, games, players, tbGame, errors, updated: new Date(), paidCount };
    render();
    const anyLive = games.some((g) => g.state === "in");
    $("#status").textContent = (anyLive ? "Live · " : "") + "Updated " + state.data.updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("#status").classList.toggle("live", anyLive);
  }

  // ---- rendering ----
  const logoSlug = (abbr) => { const a = String(abbr).toLowerCase(); return a === "was" ? "wsh" : a; };
  const logo = (abbr) => (abbr ? `<img class="logo" src="https://a.espncdn.com/i/teamlogos/nfl/500/${esc(logoSlug(abbr))}.png" alt="" loading="lazy">` : `<span class="logo"></span>`);
  const kickoff = (d) => d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

  function gameChip(g) {
    if (!g) return `<span class="chip">–</span>`;
    if (g.state === "pre") return `<span class="chip pre">${esc(kickoff(g.date))}</span>`;
    if (g.state === "post") return `<span class="chip post">Final</span>`;
    return `<span class="chip in">${esc(g.detail)}</span>`;
  }

  function renderGames() {
    const { games, tbGame } = state.data;
    $("#games").innerHTML = games.map((g) => {
      const lead = g.state !== "pre" ? (g.away.score > g.home.score ? "away" : g.home.score > g.away.score ? "home" : "") : "";
      const row = (t, side) => `<div class="team ${lead === side ? "lead" : ""}">${logo(t.abbr)}<span>${esc(t.abbr)}</span><b>${g.state === "pre" ? "" : t.score}</b></div>`;
      const status = g.state === "pre" ? esc(kickoff(g.date)) : g.state === "post" ? "Final" : `<i class="dot"></i>${esc(g.detail)}`;
      return `<div class="game ${g.state}"><div class="gstatus">${status}</div>${row(g.away, "away")}${row(g.home, "home")}${g === tbGame ? `<div class="tbnote">Tiebreaker${g.overUnder ? ` · O/U ${g.overUnder}` : ""}</div>` : ""}</div>`;
    }).join("") || `<div class="muted">No games found.</div>`;
  }

  function sorted() {
    const a = [...state.data.active];
    const key = { points: (e) => e.points, projected: (e) => e.projected, win: (e) => e.pFirst }[state.sort];
    return a.sort((x, y) => key(y) - key(x) || y.projected - x.projected || x.name.localeCompare(y.name));
  }

  function renderBoard() {
    const rows = sorted();
    const maxPts = Math.max(1, ...rows.map((e) => Math.max(e.projected, e.points)));
    const started = state.data.games.some((g) => g.state !== "pre");
    let rank = 0, prev = null;
    $("#board").innerHTML = rows.map((e, i) => {
      const v = state.sort === "points" ? e.points : state.sort === "projected" ? e.projected : e.pFirst;
      if (v !== prev) rank = i + 1; prev = v;
      const open = state.expanded.has(e.name);
      const invalid = e.valid && e.valid !== "VALID";
      const big = started ? fmt(e.points) : fmt(e.projected);
      const small = started ? `proj ${fmt(e.projected)}` : "projected";
      return `<li class="entry ${open ? "open" : ""} r${Math.min(rank, 4)}">
        <button type="button" class="row" data-name="${esc(e.name)}" aria-expanded="${open}">
          <span class="rank">${rank}</span>
          <span class="who">
            <span class="nm">${esc(e.name)}${invalid ? ' <span class="tag bad">invalid</span>' : ""}${e.paid ? "" : ' <span class="tag">unpaid</span>'}</span>
            <span class="meta"><b>${pct(e.pFirst)}</b> to win · top 3 ${pct(e.pTop3)}${started ? ` · ${e.left} left` : ""}${e.tiebreaker != null ? ` · TB ${e.tiebreaker}` : ""}</span>
          </span>
          <span class="score"><b>${big}</b><small>${small}</small></span>
          <span class="bar"><span class="actual" style="width:${(e.points / maxPts) * 100}%"></span><span class="proj" style="width:${(Math.max(0, e.projected - e.points) / maxPts) * 100}%"></span></span>
        </button>${open ? lineupHTML(e) : ""}</li>`;
    }).join("");
    const waiting = state.data.entries.filter((e) => !e.hasPicks);
    $("#waiting").innerHTML = waiting.length ? `<summary>Waiting on picks from ${waiting.length}</summary><p>${waiting.map((e) => `<span class="tag">${esc(e.name)}</span>`).join(" ")}</p>` : "";
    $("#waiting").hidden = !waiting.length;
  }

  function lineupHTML(e) {
    const n = state.data.active.length;
    return `<ul class="lineup">${e.lineup.map((l) => {
      const p = l.player, slot = `<span class="slot">${esc(l.slot.replace("FLEX ", "FX"))}</span>`;
      if (!p) return `<li class="empty">${slot}<span class="logo"></span><span class="pl muted">No pick yet</span></li>`;
      return `<li class="${p.remaining === 0 ? "done" : p.game && p.game.state === "in" ? "playing" : ""}">${slot}${logo(p.team)}
        <span class="pl"><span>${esc(p.unmatched ? l.label : p.name)}${p.unmatched ? ' <span class="tag bad" title="Not found in Sleeper data">?</span>' : ""}</span><small>${gameChip(p.game)} · ${Math.round((p.owners / n) * 100)}% picked</small></span>
        <span class="score"><b>${fmt(p.actual)}</b><small>proj ${fmt(p.live)}</small></span></li>`;
    }).join("")}<li class="ev"><span>Exp. winnings <b>${e.ev ? money(e.ev) : "–"}</b></span><span>Tiebreaker <b>${e.tiebreaker ?? "–"}</b></span></li></ul>`;
  }

  function renderOwnership() {
    const n = state.data.active.length || 1;
    const list = [...state.data.players.values()].sort((a, b) => b.owners - a.owners || b.live - a.live);
    $("#owned").innerHTML = list.map((p) => `<li>${logo(p.team)}
      <span class="pl"><span>${esc(p.name)}</span><small>${esc(p.pos === "DEF" ? "D/ST" : p.pos)} · ${p.owners} of ${n}</small></span>
      <span class="own"><span style="width:${(p.owners / n) * 100}%"></span></span>
      <span class="score"><b>${fmt(p.actual)}</b><small>proj ${fmt(p.live)}</small></span></li>`).join("");
  }

  function renderPot() {
    const { paidCount, entries } = state.data;
    const pay = state.payouts || [];
    const pot = pay.reduce((a, b) => a + (b || 0), 0);
    $("#pot").innerHTML = `<div class="total"><small>Pot · ${paidCount} of ${entries.length} paid</small><b>$${Math.round(pot)}</b></div>` +
      ["1st", "2nd", "3rd"].map((l, i) => `<div class="p${i + 1}"><small>${l}</small><b>${pay[i] != null ? "$" + Math.round(pay[i]) : "–"}</b></div>`).join("");
  }

  function renderErrors(errs) {
    $("#errors").innerHTML = errs.map((e) => `<div>⚠ ${esc(e)}</div>`).join("");
  }

  function renderLock() {
    const lock = new Date(C.lockTime), ms = lock - Date.now();
    if (ms <= 0) { $("#lock").textContent = "Lineups locked"; return; }
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
    $("#lock").textContent = `Lineups lock in ${h}h ${m}m`;
  }

  function render() {
    renderErrors(state.data.errors);
    renderGames(); renderBoard(); renderOwnership(); renderPot(); renderLock();
    document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sort === state.sort));
  }

  // ---- wiring ----
  document.title = C.title;
  $("#title").textContent = C.title;
  document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { state.sort = b.dataset.sort; render(); }));
  $("#board").addEventListener("click", (ev) => {
    const b = ev.target.closest("button.row"); if (!b) return;
    const n = b.dataset.name; state.expanded.has(n) ? state.expanded.delete(n) : state.expanded.add(n); renderBoard();
  });
  $("#refresh").addEventListener("click", () => refresh());
  $("#expandAll").addEventListener("click", () => {
    const all = state.data.active.map((e) => e.name);
    if (state.expanded.size >= all.length) state.expanded.clear(); else all.forEach((n) => state.expanded.add(n));
    $("#expandAll").textContent = state.expanded.size ? "Hide lineups" : "Show all lineups";
    renderBoard();
  });

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, C.refreshSeconds * 1000);
  setInterval(() => state.data && renderLock(), 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.data && Date.now() - state.data.updated > 20000) refresh(); });
})();
