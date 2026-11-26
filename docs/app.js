/* Only First — static site. Reads config.json, teams.json and firsts.json. */
(() => {
  "use strict";

  const LEAGUES = ["nba", "nhl", "nfl"];
  const LNAME = { nba: "NBA", nhl: "NHL", nfl: "NFL" };
  const EMOJI = { nba: "🏀", nhl: "🏒", nfl: "🏈" };
  const WHAT = { nba: "first points", nhl: "first goal", nfl: "first touchdown" };
  const WHATS = { nba: "first points", nhl: "first goals", nfl: "first touchdowns" };
  const DAYS_PER_PAGE = 4;
  const REFRESH_MS = 60_000;

  const state = {
    config: {}, teams: {}, teamIdx: {}, games: [], updated: null,
    view: "latest", league: "all", mineOnly: false, mine: new Set(),
    daysShown: DAYS_PER_PAGE, seen: new Set(), firstLoad: true,
  };

  // ---------------------------------------------------------------- storage (best effort)
  const store = {
    get(k, d) { try { const v = localStorage.getItem("of:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("of:" + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
  };

  // ---------------------------------------------------------------- utils
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const pctLabel = (a, b) => (a && pct(a, b) === 0 ? "<1%" : `${pct(a, b)}%`);
  const team = (lg, abbr) => state.teamIdx[`${lg}:${abbr}`] || { abbr, name: abbr, short: abbr, color: "888888", logo: "" };
  const teamKey = (lg, abbr) => `${lg}:${abbr}`;
  const isMine = (g) => state.mine.has(teamKey(g.league, g.home)) || state.mine.has(teamKey(g.league, g.away));
  const logoImg = (t, cls = "logo") => t.logo
    ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" width="40" height="40">`
    : `<span class="${cls} ph"></span>`;

  function dayLabel(yyyymmdd) {
    const d = new Date(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    const long = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (diff === 0) return ["Today", long];
    if (diff === 1) return ["Yesterday", long];
    if (diff === -1) return ["Tomorrow", long];
    return [d.toLocaleDateString(undefined, { weekday: "long" }), d.toLocaleDateString(undefined, { month: "short", day: "numeric" })];
  }
  const startTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  // ---------------------------------------------------------------- data
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  async function loadStatic() {
    state.config = await getJSON("config.json").catch(() => ({}));
    state.teams = await getJSON("teams.json");
    for (const lg of LEAGUES) for (const t of state.teams[lg] || []) state.teamIdx[teamKey(lg, t.abbr)] = t;
  }

  async function loadGames() {
    const urls = [];
    if (state.config.data_url) urls.push(`${state.config.data_url}${state.config.data_url.includes("?") ? "&" : "?"}t=${Date.now()}`);
    urls.push(`data/firsts.json?t=${Date.now()}`);
    let lastErr;
    for (const u of urls) {
      try {
        const d = await getJSON(u);
        state.updated = d.updated;
        state.games = Object.values(d.games).sort((a, b) => (b.start || "").localeCompare(a.start || ""));
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // ---------------------------------------------------------------- filtering
  function filtered({ mineAware = true } = {}) {
    return state.games.filter((g) =>
      (state.league === "all" || g.league === state.league) &&
      (!mineAware || !state.mineOnly || isMine(g)));
  }

  // ---------------------------------------------------------------- latest view
  function result(g) {
    if (!g.final || g.home_score == null) return "";
    const f = g.first;
    const hs = g.home_score, as = g.away_score;
    if (hs === as) return `<div class="card-foot">Final ${as}–${hs}, tie</div>`;
    const winner = hs > as ? g.home : g.away;
    const score = `${Math.max(hs, as)}–${Math.min(hs, as)}`;
    if (!f) return `<div class="card-foot">Final: ${esc(winner)} won ${score}</div>`;
    const won = f.team === winner;
    return `<div class="card-foot"><span class="${won ? "won" : "lost"}">${won ? "✓ Scored first and won" : "✗ Scored first, lost"}</span>
      <span>· ${esc(winner)} ${score}</span></div>`;
  }

  function card(g) {
    const f = g.first;
    const lgTag = `<span class="lg">${LNAME[g.league]}</span>`;
    const po = g.playoffs ? `<span class="badge">Playoffs</span>` : "";
    const key = `${g.league}:${g.id}`;
    const isNew = !state.firstLoad && f && !state.seen.has(key);
    if (f) state.seen.add(key);
    if (f) {
      const t = team(g.league, f.team);
      const assists = f.assists?.length ? ` · assist ${f.assists.map(esc).join(", ")}` : "";
      return `<article class="card${isNew ? " is-new" : ""}" style="--team:#${esc(t.color)}" title="${esc(f.description)}">
        <div class="card-top">${lgTag}<span class="matchup">${esc(g.name)}</span>${po}
          <span class="when">${esc(f.period)} · ${esc(f.clock)}</span></div>
        <div class="scorer">${logoImg(t)}<div><h3>${esc(f.scorer)}</h3>
          <p class="how">${esc(f.how)}${assists}</p></div></div>
        ${result(g)}
      </article>`;
    }
    let msg, when;
    if (g.state === "in") { msg = `Waiting for the ${WHAT[g.league]}…`; when = `<span class="live"><span class="live-dot"></span> LIVE</span>`; }
    else if (g.state === "pre") { msg = `Not started`; when = startTime(g.start); }
    else { msg = g.league === "nfl" ? "No touchdowns" : g.league === "nhl" ? "Scoreless, decided in a shootout" : "No score recorded"; when = "Final"; }
    const home = team(g.league, g.home), away = team(g.league, g.away);
    return `<article class="card pending">
      <div class="card-top">${lgTag}<span class="matchup">${esc(g.name)}</span>${po}<span class="when">${when}</span></div>
      <div class="scorer">${logoImg(away)}${logoImg(home)}<div><h3>${esc(msg)}</h3></div></div>
      ${result(g)}
    </article>`;
  }

  function renderLatest() {
    const el = $("#view-latest");
    const games = filtered();
    if (!games.length) {
      el.innerHTML = `<p class="empty">${state.mineOnly && !state.mine.size
        ? `You haven't picked any teams yet. <a href="#teams">Pick your teams</a>.`
        : "No games here yet."}</p>`;
      return;
    }
    const byDay = new Map();
    for (const g of games) { if (!byDay.has(g.date)) byDay.set(g.date, []); byDay.get(g.date).push(g); }
    // Today first, then upcoming (tomorrow), then the past.
    const days = [...byDay.keys()].sort().reverse();
    const order = { in: 0, post: 1, pre: 2 };
    const html = days.slice(0, state.daysShown).map((d) => {
      const list = byDay.get(d).sort((a, b) => order[a.state] - order[b.state] ||
        (a.state === "pre" ? (a.start || "").localeCompare(b.start || "") : (b.start || "").localeCompare(a.start || "")));
      const [big, small] = dayLabel(d);
      const n = list.filter((g) => g.first).length;
      return `<div class="day"><h2>${big}</h2><span>${small} · ${n} of ${list.length} decided</span></div>
        <div class="grid">${list.map(card).join("")}</div>`;
    }).join("");
    const more = days.length > state.daysShown ? `<button class="more" id="more">Show earlier days</button>` : "";
    el.innerHTML = html + more;
    $("#more")?.addEventListener("click", () => { state.daysShown += DAYS_PER_PAGE; renderLatest(); });
  }

  // ---------------------------------------------------------------- teams view
  function topicFor(lg, abbr) {
    const p = state.config.ntfy_prefix || "onlyfirst";
    return abbr ? `${p}-${lg}-${abbr.toLowerCase()}` : `${p}-${lg}`;
  }
  const ntfyServer = () => (state.config.ntfy_server || "https://ntfy.sh").replace(/\/$/, "");

  function topicRow(label, topic, logo = "") {
    return `<li>${logo}<span class="t-name">${esc(label)}</span><code>${esc(topic)}</code>
      <a class="btn" href="${esc(ntfyServer())}/${esc(topic)}" target="_blank" rel="noopener">Subscribe</a>
      <button class="btn ghost" data-copy="${esc(topic)}">Copy</button></li>`;
  }

  function renderTeams() {
    const el = $("#view-teams");
    const leagues = state.league === "all" ? LEAGUES : [state.league];
    const pickers = leagues.map((lg) => `
      <div class="panel"><h2>${EMOJI[lg]} ${LNAME[lg]}</h2>
        <p>Tap the teams you follow.</p>
        <div class="team-grid">${(state.teams[lg] || []).map((t) => {
          const on = state.mine.has(teamKey(lg, t.abbr));
          return `<button class="team-btn" aria-pressed="${on}" data-team="${teamKey(lg, t.abbr)}">
            <img src="${esc(t.logo)}" alt="" loading="lazy" width="24" height="24"><span>${esc(t.short)}</span></button>`;
        }).join("")}</div></div>`).join("");

    const mine = [...state.mine].map((k) => k.split(":")).filter(([lg]) => leagues.includes(lg));
    const rows = mine.map(([lg, abbr]) => {
      const t = team(lg, abbr);
      return topicRow(`${t.name} (${LNAME[lg]})`, topicFor(lg, abbr), `<img src="${esc(t.logo)}" alt="" width="22" height="22" style="width:22px;height:22px;object-fit:contain">`);
    }).join("");
    const all = leagues.map((lg) => topicRow(`Every ${LNAME[lg]} game`, topicFor(lg))).join("");

    el.innerHTML = `
      <div class="panel">
        <h2>Get alerts on your phone</h2>
        <p>Free push notifications through <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a>. No account, no email.</p>
        <ol class="steps">
          <li>Install <b>ntfy</b>: <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a> ·
            <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a></li>
          <li>In the app, tap <b>+</b> and paste a topic below (use <b>Copy</b>). On a computer, <b>Subscribe</b> opens it in the browser.</li>
          <li>You'll get one alert per game the moment the ${state.league === "all" ? "first score" : WHAT[state.league]} happens.</li>
        </ol>
        ${rows ? `<h3>Your teams</h3><ul class="topics">${rows}</ul><br>` : `<p><i>Pick teams below to get a topic for each.</i></p>`}
        <h3>Everything</h3><ul class="topics">${all}</ul>
      </div>
      ${pickers}`;
  }

  // ---------------------------------------------------------------- stats view
  function category(lg, how) {
    const h = (how || "").toLowerCase();
    if (lg === "nba") {
      if (h.includes("free throw")) return "Free throw";
      if (h.includes("3-pointer") || h.includes("three")) return "3-pointer";
      if (h.includes("dunk")) return "Dunk";
      if (h.includes("layup") || h.includes("finger roll")) return "Layup";
      if (h.includes("hook")) return "Hook shot";
      if (h.includes("tip")) return "Tip-in";
      return "Jump shot";
    }
    if (lg === "nhl") { const c = (how || "").split(",")[0]; return c && c !== "Goal" ? c : "Other"; }
    return (how || "Touchdown").split(",")[0].replace(/ Touchdown$/, "");
  }
  function strength(how) {
    const h = (how || "").toLowerCase();
    if (h.includes("power play")) return "Power play";
    if (h.includes("short")) return "Shorthanded";
    if (h.includes("empty net")) return "Empty net";
    return "Even strength";
  }

  function count(list, fn) {
    const m = new Map();
    for (const x of list) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function bars(entries, total, unit) {
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return `<div class="bars">${entries.map(([k, v]) => `
      <div class="bar-row" data-tip="${esc(`${k}: ${v} ${unit}${v === 1 ? "" : "s"} (${pct(v, total)}%)`)}">
        <span class="lbl">${esc(k)}</span>
        <span class="bar-track"><span class="bar" style="width:${(100 * v) / max}%;display:block"></span></span>
        <span class="val">${pctLabel(v, total)}</span>
      </div>`).join("")}</div>`;
  }

  function leagueStats(lg) {
    const games = state.games.filter((g) => g.league === lg && g.first);
    if (!games.length) return `<div class="league-block"><h2>${EMOJI[lg]} ${LNAME[lg]}</h2><p class="empty">No games yet.</p></div>`;
    const finals = games.filter((g) => g.final && g.home_score != null && g.home_score !== g.away_score);
    const winsAfter = finals.filter((g) => g.first.team === (g.home_score > g.away_score ? g.home : g.away)).length;
    const homeFirst = games.filter((g) => g.first.team === g.home).length;
    const cats = count(games, (g) => category(lg, g.first.how));

    // leaders
    const leaders = count(games, (g) => `${g.first.scorer}|${g.first.team}`).slice(0, 12);
    const leaderRows = leaders.map(([k, v], i) => {
      const [name, abbr] = k.split("|"); const t = team(lg, abbr);
      const mine = state.mine.has(teamKey(lg, abbr)) ? " class=\"mine\"" : "";
      return `<tr${mine}><td class="rank">${i + 1}</td><td>${esc(name)}</td>
        <td><span class="tteam"><img src="${esc(t.logo)}" alt="">${esc(abbr)}</span></td><td class="n">${v}</td></tr>`;
    }).join("");

    // teams
    const rows = (state.teams[lg] || []).map((t) => {
      const played = games.filter((g) => g.home === t.abbr || g.away === t.abbr);
      const first = played.filter((g) => g.first.team === t.abbr);
      const fFinals = first.filter((g) => g.final && g.home_score != null && g.home_score !== g.away_score);
      const fWon = fFinals.filter((g) => (g.home_score > g.away_score ? g.home : g.away) === t.abbr).length;
      return { t, gp: played.length, first: first.length, p: played.length ? first.length / played.length : 0, fWon, fFinals: fFinals.length };
    }).filter((r) => r.gp).sort((a, b) => b.p - a.p || b.first - a.first);
    const teamRows = rows.map((r) => `<tr${state.mine.has(teamKey(lg, r.t.abbr)) ? ' class="mine"' : ""}>
      <td><span class="tteam"><img src="${esc(r.t.logo)}" alt="">${esc(r.t.short)}</span></td>
      <td class="n">${r.first}/${r.gp}</td><td class="n"><b>${Math.round(r.p * 100)}%</b></td>
      <td class="n">${r.fFinals ? `${r.fWon}–${r.fFinals - r.fWon}` : "–"}</td></tr>`).join("");

    const extra = lg === "nhl"
      ? `<div class="panel"><h3>Game situation</h3>${bars(count(games, (g) => strength(g.first.how)), games.length, "goal")}</div>`
      : lg === "nfl"
        ? `<div class="panel"><h3>Which quarter</h3>${bars(count(games, (g) => g.first.period || "?").sort(), games.length, "game")}</div>`
        : `<div class="panel"><h3>Home vs away</h3>${bars([["Home team", homeFirst], ["Away team", games.length - homeFirst]], games.length, "game")}</div>`;

    return `<div class="league-block"><h2>${EMOJI[lg]} ${LNAME[lg]}</h2>
      <div class="tiles">
        <div class="tile"><div class="k">Games tracked</div><div class="v">${games.length}</div><div class="s">this season</div></div>
        <div class="tile"><div class="k">Scored first, then won</div><div class="v">${pct(winsAfter, finals.length)}%</div><div class="s">${winsAfter} of ${finals.length} finished games</div></div>
        <div class="tile"><div class="k">Most common way</div><div class="v">${esc(cats[0][0])}</div><div class="s">${pct(cats[0][1], games.length)}% of ${WHATS[lg]}</div></div>
      </div>
      <div class="cols">
        <div class="panel"><h3>How the ${WHAT[lg]} happened</h3>${bars(cats, games.length, "game")}</div>
        ${extra}
        <div class="panel"><h3>Most ${WHATS[lg]}</h3><table><thead><tr><th></th><th>Player</th><th>Team</th><th class="n">Firsts</th></tr></thead><tbody>${leaderRows}</tbody></table></div>
        <div class="panel"><h3>Teams: who scores first</h3><div class="scroll"><table><thead><tr><th>Team</th><th class="n">First</th><th class="n">%</th><th class="n" title="Record in games where they scored first">W–L after</th></tr></thead><tbody>${teamRows}</tbody></table></div></div>
      </div></div>`;
  }

  function renderStats() {
    const leagues = state.league === "all" ? LEAGUES : [state.league];
    $("#view-stats").innerHTML = leagues.map(leagueStats).join("");
  }

  // ---------------------------------------------------------------- shell
  function render() {
    for (const v of ["latest", "teams", "stats"]) $(`#view-${v}`).hidden = v !== state.view;
    document.querySelectorAll(".tabs a").forEach((a) => {
      if (a.dataset.view === state.view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.querySelectorAll(".chips button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.league === state.league)));
    const mineToggle = $("#mine-toggle");
    mineToggle.hidden = state.view !== "latest";
    $("#mine-only").checked = state.mineOnly;
    ({ latest: renderLatest, teams: renderTeams, stats: renderStats })[state.view]();
    if (state.updated) {
      const mins = Math.max(0, Math.round((Date.now() - new Date(state.updated)) / 60000));
      $("#updated").textContent = `Last checked ${mins < 1 ? "just now" : `${mins} min ago`}.`;
    }
    state.firstLoad = false;
  }

  function route() {
    const v = location.hash.replace("#", "");
    state.view = ["latest", "teams", "stats"].includes(v) ? v : "latest";
    render();
  }

  function wire() {
    document.querySelector(".chips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-league]"); if (!b) return;
      state.league = b.dataset.league; store.set("league", state.league); state.daysShown = DAYS_PER_PAGE; render();
    });
    $("#mine-only").addEventListener("change", (e) => { state.mineOnly = e.target.checked; store.set("mineOnly", state.mineOnly); render(); });
    $("#view-teams").addEventListener("click", async (e) => {
      const t = e.target.closest("[data-team]");
      if (t) {
        const k = t.dataset.team;
        state.mine.has(k) ? state.mine.delete(k) : state.mine.add(k);
        store.set("mine", [...state.mine]);
        const y = window.scrollY; renderTeams(); window.scrollTo(0, y);
        return;
      }
      const c = e.target.closest("[data-copy]");
      if (c) {
        try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = "Copied"; }
        catch { prompt("Copy this topic:", c.dataset.copy); }
        setTimeout(() => { c.textContent = "Copy"; }, 1500);
      }
    });
    // hover tooltips for bars
    const tip = $("#tip");
    document.addEventListener("pointermove", (e) => {
      const r = e.target.closest?.("[data-tip]");
      if (!r) { tip.hidden = true; return; }
      tip.textContent = r.dataset.tip; tip.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 16}px`;
    });
    window.addEventListener("hashchange", route);
  }

  async function refresh() {
    try { await loadGames(); $("#status").textContent = ""; render(); }
    catch (e) { console.error(e); if (!state.games.length) $("#status").textContent = "Couldn't load scores. Try again in a minute."; }
  }

  async function init() {
    state.league = store.get("league", "all");
    state.mineOnly = store.get("mineOnly", false);
    state.mine = new Set(store.get("mine", []));
    wire();
    $("#status").textContent = "Loading…";
    try { await loadStatic(); } catch (e) { $("#status").textContent = "Couldn't load team list."; return; }
    await refresh();
    for (const g of state.games) if (g.first) state.seen.add(`${g.league}:${g.id}`);
    route();
    setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  init();
})();
