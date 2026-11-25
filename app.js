/* Thanksgiving Pick'Em live tracker: page state and rendering. Data logic lives in core.js. */
(() => {
  const C = window.PICKEM_CONFIG;
  const { compute, esc, fmt, pct, money, getJSON } = window.PickemCore;
  const $ = (s) => document.querySelector(s);

  const state = { sort: "points", expanded: new Set(), pos: "QB", data: null, payouts: null, history: null, metric: "win", picked: null };

  async function refresh() {
    $("#status").textContent = "Updating…";
    let data;
    try { data = await compute(); }
    catch (e) { renderErrors([e.message]); $("#status").textContent = "Couldn't load picks"; return; }
    const games = data.games;
    if (!state.data && games.length && games.every((g) => g.state === "pre")) state.sort = "projected";
    state.data = data;
    state.payouts = data.payouts;
    render();
    const anyLive = games.some((g) => g.state === "in");
    $("#status").textContent = (anyLive ? "Live · " : "") + "Updated " + state.data.updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("#status").classList.toggle("live", anyLive);
    loadHistory();
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

  function renderPositions() {
    const n = state.data.active.length || 1;
    const started = state.data.games.some((g) => g.state !== "pre");
    const list = [...state.data.pool.values()].filter((p) => p.pos === state.pos && !p.unmatched)
      .sort((a, b) => b.live - a.live || b.actual - a.actual || a.name.localeCompare(b.name));
    $("#bypos").innerHTML = list.map((p, i) => `<li class="${p.remaining === 0 ? "done" : ""}"><span class="slot">${i + 1}</span>${logo(p.team)}
      <span class="pl"><span>${esc(p.name)}</span><small>${gameChip(p.game)} · ${p.owners ? `${p.owners} of ${n} picked` : "not picked"}</small></span>
      <span class="own"><span style="width:${(p.owners / n) * 100}%"></span></span>
      <span class="score"><b>${fmt(p.live)}</b><small>${started ? `${fmt(p.actual)} so far` : "projected"}</small></span></li>`).join("") || `<li class="muted">No players found.</li>`;
    document.querySelectorAll("[data-pos]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.pos === state.pos));
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
    renderGames(); renderBoard(); renderPositions(); renderOwnership(); renderPot(); renderLock();
    document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sort === state.sort));
  }

  // ---- history chart ----
  const SERIES = ["#338ced", "#e76624", "#00a888", "#d28e05"]; // validated on the card surface; assigned in pick order
  const METRICS = {
    win: { idx: 2, label: "Win %", fmt: (v) => pct(v), tick: (v) => Math.round(v * 100) + "%", zero: true },
    projected: { idx: 1, label: "Projected", fmt: (v) => fmt(v), tick: (v) => String(Math.round(v)), zero: false },
    points: { idx: 0, label: "Points", fmt: (v) => fmt(v), tick: (v) => String(Math.round(v)), zero: true },
  };
  let historyAt = 0;

  async function loadHistory() {
    if (!C.historyUrl || Date.now() - historyAt < 4 * 60 * 1000) { renderChart(); return; }
    historyAt = Date.now();
    try { const h = await getJSON(C.historyUrl + "?_=" + Date.now()); if (Array.isArray(h)) state.history = h; } catch (e) { /* no history yet */ }
    renderChart();
  }

  // Saved snapshots plus the live numbers on screen right now.
  function chartPoints() {
    const pts = (state.history || []).slice();
    const d = state.data;
    if (d && d.active.length) {
      const e = {};
      for (const x of d.active) e[x.name] = [x.points, x.projected, x.pFirst, x.pTop3];
      const now = { t: Date.now(), live: d.games.filter((g) => g.state === "in").map((g) => `${g.away.abbr}-${g.home.abbr}`), e };
      if (pts.length) pts.push(now);
    }
    return pts;
  }

  function niceStep(span, n) {
    const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
  }

  function renderChart() {
    const box = $("#chart"), pts = chartPoints(), m = METRICS[state.metric];
    document.querySelectorAll("[data-metric]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.metric === state.metric));
    if (!state.data) return;
    const names = state.data.active.map((e) => e.name);
    if (pts.length < 3) {
      box.innerHTML = `<p class="empty">The chart starts filling in at kickoff. A snapshot of everyone's points, projection and win odds is saved every few minutes during the games.</p>`;
      $("#chips").innerHTML = ""; return;
    }
    if (!state.picked) state.picked = [...state.data.active].sort((a, b) => b.pFirst - a.pFirst).slice(0, 4).map((e) => e.name);
    state.picked = state.picked.filter((n) => names.includes(n));
    const colorOf = (n) => { const i = state.picked.indexOf(n); return i < 0 ? null : SERIES[i]; };

    const W = Math.max(300, box.clientWidth || 340), H = 250, L = 34, R = 78, T = 10, B = 26;
    const val = (p, n) => (p.e[n] ? p.e[n][m.idx] : null);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) for (const n of names) { const v = val(p, n); if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (m.zero) lo = 0;
    if (hi - lo < 1e-9) hi = lo + (state.metric === "win" ? 0.1 : 10);
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = (i) => L + (i / (pts.length - 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const path = (n) => { let d = "", pen = false; pts.forEach((p, i) => { const v = val(p, n); if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; }); return d; };

    let grid = "";
    for (let v = lo; v <= hi + step / 2; v += step) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${m.tick(v)}</text>`;
    // Mark where each game kicked off.
    const seen = new Set(); let marks = "", lastX = -99;
    pts.forEach((p, i) => (p.live || []).forEach((g) => {
      if (seen.has(g)) return; seen.add(g);
      const gx = x(i);
      marks += `<line class="kick" x1="${gx}" x2="${gx}" y1="${T}" y2="${H - B}"/>`;
      if (gx - lastX > 52) { marks += `<text class="tick" x="${gx}" y="${H - 8}" text-anchor="${gx > W - R - 30 ? "end" : "start"}">${esc(g)}</text>`; lastX = gx; }
    }));

    const last = pts[pts.length - 1];
    const bg = names.filter((n) => !colorOf(n)).map((n) => `<path class="ctx" d="${path(n)}"/>`).join("");
    const ends = state.picked.map((n) => ({ n, v: val(last, n), c: colorOf(n) })).filter((e) => e.v != null).sort((a, b) => b.v - a.v);
    let prevY = -99;
    for (const e of ends) { e.ly = Math.max(y(e.v), prevY + 13); prevY = e.ly; }
    const fg = state.picked.map((n) => `<path class="ser" stroke="${colorOf(n)}" d="${path(n)}"/>`).join("") +
      ends.map((e) => `<circle class="end" cx="${x(pts.length - 1)}" cy="${y(e.v)}" r="4" fill="${e.c}"/><circle cx="${W - R + 12}" cy="${e.ly}" r="3" fill="${e.c}"/><text class="lbl" x="${W - R + 19}" y="${e.ly + 4}">${esc(e.n.length > 8 ? e.n.slice(0, 7) + "…" : e.n)}</text>`).join("");

    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${m.label} over time for each entrant">${grid}${marks}${bg}${fg}<line class="cross" y1="${T}" y2="${H - B}" hidden/><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg><div class="tip" hidden></div>`;

    const svg = box.querySelector("svg"), cross = box.querySelector(".cross"), tip = box.querySelector(".tip");
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1))));
      const p = pts[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.removeAttribute("hidden");
      const rows = state.picked.map((n) => ({ n, v: val(p, n), c: colorOf(n) })).filter((e) => e.v != null).sort((a, b) => b.v - a.v);
      tip.innerHTML = `<small>${esc(new Date(p.t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</small>` + rows.map((e) => `<div><i style="background:${e.c}"></i><span>${esc(e.n)}</span><b>${m.fmt(e.v)}</b></div>`).join("");
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), W - tip.offsetWidth) + "px";
    };
    const hide = () => { cross.setAttribute("hidden", ""); tip.hidden = true; };
    svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show); svg.addEventListener("pointerleave", hide);

    $("#chips").innerHTML = [...state.data.active].sort((a, b) => b.pFirst - a.pFirst).map((e) => {
      const c = colorOf(e.name);
      return `<button type="button" class="chipbtn" data-name="${esc(e.name)}" aria-pressed="${!!c}"><i style="background:${c || "transparent"}"></i>${esc(e.name)}</button>`;
    }).join("");
  }

  // ---- wiring ----
  document.title = C.title;
  $("#title").textContent = C.title;
  document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { state.sort = b.dataset.sort; render(); }));
  $("#board").addEventListener("click", (ev) => {
    const b = ev.target.closest("button.row"); if (!b) return;
    const n = b.dataset.name; state.expanded.has(n) ? state.expanded.delete(n) : state.expanded.add(n); renderBoard();
  });
  document.querySelectorAll("[data-pos]").forEach((b) => b.addEventListener("click", () => { state.pos = b.dataset.pos; if (state.data) renderPositions(); }));
  document.querySelectorAll("[data-metric]").forEach((el) => el.addEventListener("click", () => { state.metric = el.dataset.metric; renderChart(); }));
  $("#chips").addEventListener("click", (ev) => {
    const el = ev.target.closest(".chipbtn"); if (!el) return;
    const n = el.dataset.name, i = state.picked.indexOf(n);
    if (i >= 0) state.picked.splice(i, 1); else { if (state.picked.length >= 4) state.picked.shift(); state.picked.push(n); }
    renderChart();
  });
  let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(renderChart, 150); });
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
