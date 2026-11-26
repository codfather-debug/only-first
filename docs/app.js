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
  const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

  const state = {
    config: {}, teams: {}, teamIdx: {}, games: [], updated: null,
    view: "latest", league: "all", mineOnly: false, mine: new Set(),
    daysShown: DAYS_PER_PAGE, seen: new Set(), firstLoad: true, mapTeam: {},
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
  const teamKey = (lg, abbr) => `${lg}:${abbr}`;
  const team = (lg, abbr) => state.teamIdx[teamKey(lg, abbr)] || { abbr, name: abbr, short: abbr, color: "666666", alt: "aaaaaa", logo: "" };
  const isMine = (g) => state.mine.has(teamKey(g.league, g.home)) || state.mine.has(teamKey(g.league, g.away));
  const hex = (c) => `#${/^[0-9a-f]{6}$/i.test(c || "") ? c : "666666"}`;
  const headshot = (lg, id, w = 224, h = 164) => id
    ? `https://a.espncdn.com/combiner/i?img=/i/headshots/${lg}/players/full/${encodeURIComponent(id)}.png&w=${w}&h=${h}&scale=crop&cquality=60`
    : "";
  const dayStr = (yyyymmdd) => new Date(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8))
    .toLocaleDateString(undefined, { month: "short", day: "numeric" });

  function luminance(c) {
    const n = parseInt(hex(c).slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const inkOn = (c) => (luminance(c) > 0.42 ? "#12151c" : "#ffffff");
  function teamVars(t) {
    let c1 = hex(t.color), c2 = hex(t.alt);
    if (c1.toLowerCase() === c2.toLowerCase()) c2 = luminance(c1) > 0.4 ? "#12151c" : "#ffffff";
    return `--c1:${c1};--c2:${c2};--on:${inkOn(c1)};--tc:${c1}`;
  }

  function dayLabel(yyyymmdd) {
    const d = new Date(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    const long = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    if (diff === 0) return ["Today", long];
    if (diff === 1) return ["Yesterday", long];
    if (diff === -1) return ["Tomorrow", long];
    return [d.toLocaleDateString(undefined, { weekday: "long" }), d.toLocaleDateString(undefined, { month: "long", day: "numeric" })];
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
    if (state.config.data_url && !LOCAL) urls.push(`${state.config.data_url}${state.config.data_url.includes("?") ? "&" : "?"}t=${Date.now()}`);
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

  function filtered() {
    return state.games.filter((g) =>
      (state.league === "all" || g.league === state.league) && (!state.mineOnly || isMine(g)));
  }

  // ---------------------------------------------------------------- latest: cards
  function winnerOf(g) {
    if (!g.final || g.home_score == null || g.home_score === g.away_score) return null;
    return g.home_score > g.away_score ? g.home : g.away;
  }

  function facts(g) {
    const out = [];
    const w = winnerOf(g);
    const score = g.final && g.home_score != null ? `${Math.max(g.home_score, g.away_score)}–${Math.min(g.home_score, g.away_score)}` : "";
    if (g.first && w) {
      out.push(g.first.team === w
        ? `<span class="won">✓ Scored first and won</span>`
        : `<span class="lost">✗ Scored first, lost</span>`);
      out.push(`<span>${esc(w)} ${score}</span>`);
    } else if (g.final && g.home_score != null) {
      out.push(`<span>Final: ${g.home_score === g.away_score ? `tie ${score}` : `${esc(w)} ${score}`}</span>`);
    }
    if (g.tip && g.tip.team) {
      const t = team(g.league, g.tip.team);
      out.push(`<span class="tip" title="${esc(g.tip.text)}">Won the tip: ${t.logo ? `<img src="${esc(t.logo)}" alt="">` : ""}${esc(g.tip.team)}</span>`);
    }
    return out.length ? `<div class="facts">${out.join("")}</div>` : "";
  }

  function card(g) {
    const f = g.first;
    const key = `${g.league}:${g.id}`;
    const isNew = !state.firstLoad && f && !state.seen.has(key);
    if (f) state.seen.add(key);
    const po = g.playoffs ? `<span class="badge">Playoffs</span>` : "";

    if (f) {
      const t = team(g.league, f.team);
      const photo = headshot(g.league, f.scorer_id);
      const img = photo
        ? `<img class="shot" src="${esc(photo)}" data-fallback="${esc(t.logo)}" alt="" width="112" height="82" loading="lazy">`
        : `<img class="shot logo-fallback" src="${esc(t.logo)}" alt="" width="64" height="64" loading="lazy">`;
      const map = window.OFMaps.mini(g.league, f, hex(t.color));
      const assists = f.assists?.length ? `<p class="assist">Assist: ${f.assists.map(esc).join(", ")}</p>` : "";
      return `<article class="card${isNew ? " is-new" : ""}" style="${teamVars(t)}" title="${esc(f.description)}">
        <div class="hero">
          ${t.logo ? `<img class="wm" src="${esc(t.logo)}" alt="" loading="lazy">` : ""}
          <div class="hero-top"><span class="lg">${LNAME[g.league]}</span><span>${esc(g.name)}</span>${po}
            <span class="when">${esc(f.period)} ${esc(f.clock)}</span></div>
          <div class="who">${img}<h3><small>${esc(t.name)}</small>${esc(f.scorer)}</h3></div>
        </div>
        <div class="body"><div><p class="how">${esc(f.how)}</p>${assists}${facts(g)}</div>${map}</div>
      </article>`;
    }

    const home = team(g.league, g.home), away = team(g.league, g.away);
    let msg, when;
    if (g.state === "in") { msg = `Waiting for the ${WHAT[g.league]}`; when = `<span class="live" style="color:#fff"><span class="live-dot"></span>Live</span>`; }
    else if (g.state === "pre") { msg = `${{ nba: "Tip-off", nhl: "Puck drop", nfl: "Kickoff" }[g.league]} at ${startTime(g.start)}`; when = "Upcoming"; }
    else { msg = g.league === "nfl" ? "No touchdowns this game" : g.league === "nhl" ? "Scoreless, decided in a shootout" : "No score recorded"; when = "Final"; }
    const style = `--c1:${hex(away.color)};--c2:${hex(home.color)};--on:#fff`;
    return `<article class="card pending" style="${style}">
      <div class="hero">
        <div class="hero-top"><span class="lg">${LNAME[g.league]}</span><span>${esc(g.name)}</span>${po}<span class="when">${when}</span></div>
        <div class="vs">${away.logo ? `<img src="${esc(away.logo)}" alt="${esc(away.name)}">` : ""}<span>at</span>${home.logo ? `<img src="${esc(home.logo)}" alt="${esc(home.name)}">` : ""}</div>
      </div>
      <div class="body"><div><p class="waiting">${esc(msg)}</p>${facts(g)}</div></div>
    </article>`;
  }

  function renderLatest() {
    const el = $("#view-latest");
    const games = filtered();
    if (!games.length) {
      el.innerHTML = `<p class="empty">${state.mineOnly && !state.mine.size
        ? `Pick your teams to see only their games. <a href="#teams">Pick teams</a>`
        : "No games here yet."}</p>`;
      return;
    }
    const byDay = new Map();
    for (const g of games) { if (!byDay.has(g.date)) byDay.set(g.date, []); byDay.get(g.date).push(g); }
    const days = [...byDay.keys()].sort().reverse();
    const order = { in: 0, post: 1, pre: 2 };
    const html = days.slice(0, state.daysShown).map((d) => {
      const list = byDay.get(d).sort((a, b) => order[a.state] - order[b.state] ||
        (a.state === "pre" ? (a.start || "").localeCompare(b.start || "") : (b.start || "").localeCompare(a.start || "")));
      const [big, small] = dayLabel(d);
      const n = list.filter((g) => g.first).length;
      return `<div class="day"><h2>${big}</h2><span class="date">${small}</span>
          <span class="tally">${n} of ${list.length} games decided</span></div>
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
    return `<li>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<span class="t-name">${esc(label)}</span><code>${esc(topic)}</code>
      <a class="btn" href="${esc(ntfyServer())}/${esc(topic)}" target="_blank" rel="noopener">Subscribe</a>
      <button class="btn ghost" data-copy="${esc(topic)}">Copy</button></li>`;
  }

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function homeScreenPanel() {
    if (standalone()) return "";
    const how = isIOS()
      ? `In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.`
      : state.installPrompt
        ? `<button class="btn" data-install>Install Only First</button>`
        : `In your browser menu, choose <b>Install app</b> or <b>Add to Home screen</b>.`;
    return `<div class="panel home-tip">${window.OFBrand.mark(56)}
      <div><h2>Put Only First on your home screen</h2><p style="margin:0;color:var(--text-2)">It opens full screen like an app. ${how}</p></div></div>`;
  }

  function renderTeams() {
    const el = $("#view-teams");
    const leagues = state.league === "all" ? LEAGUES : [state.league];
    const pickers = leagues.map((lg) => `
      <div class="panel"><h2>${EMOJI[lg]} ${LNAME[lg]}</h2>
        <p>Tap the teams you follow.</p>
        <div class="team-grid">${(state.teams[lg] || []).map((t) => {
          const on = state.mine.has(teamKey(lg, t.abbr));
          return `<button class="team-btn" aria-pressed="${on}" data-team="${teamKey(lg, t.abbr)}" style="--tc:${hex(t.color)}">
            <img src="${esc(t.logo)}" alt="" loading="lazy" width="26" height="26"><span>${esc(t.short)}</span></button>`;
        }).join("")}</div></div>`).join("");

    const mine = [...state.mine].map((k) => k.split(":")).filter(([lg]) => leagues.includes(lg));
    const rows = mine.map(([lg, abbr]) => { const t = team(lg, abbr); return topicRow(`${t.name} (${LNAME[lg]})`, topicFor(lg, abbr), t.logo); }).join("");
    const all = leagues.map((lg) => topicRow(`Every ${LNAME[lg]} game`, topicFor(lg))).join("");

    el.innerHTML = `
      ${homeScreenPanel()}
      <div class="panel">
        <h2>Get alerts on your phone</h2>
        <p>Free push notifications through <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a>. No account or email needed.</p>
        <ol class="steps">
          <li>Install <b>ntfy</b>: <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a> or
            <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a>.</li>
          <li>In the app, tap <b>+</b> and paste a topic below (use <b>Copy</b>). On a computer, <b>Subscribe</b> opens it in your browser.</li>
          <li>You'll get one alert per game, the moment the ${state.league === "all" ? "first score" : WHAT[state.league]} happens.</li>
        </ol>
        ${rows ? `<h3>Your teams</h3><ul class="topics">${rows}</ul><br>` : `<p><i>Pick teams below to get a topic for each one.</i></p>`}
        <h3>Every game</h3><ul class="topics">${all}</ul>
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
        <span><span class="bar" style="width:${(100 * v) / max}%"></span></span>
        <span class="val">${pctLabel(v, total)}</span>
      </div>`).join("")}</div>`;
  }

  function mapPanel(lg, games) {
    const sel = state.mapTeam[lg] || "";
    const shown = sel ? games.filter((g) => g.first.team === sel) : games;
    const color = sel ? hex(team(lg, sel).color) : "var(--accent)";
    const options = (state.teams[lg] || []).map((t) =>
      `<option value="${esc(t.abbr)}"${t.abbr === sel ? " selected" : ""}>${esc(t.name)}</option>`).join("");
    const tipText = (g) => `${g.first.scorer} (${g.first.team}), ${g.first.how}. ${g.name}, ${dayStr(g.date)}`;
    const title = { nba: "Where the first points come from", nhl: "Where the first goals come from", nfl: "Where the first touchdowns start" }[lg];
    const note = {
      nba: "Each dot is one game's first basket, seen from above with the hoop at the top. Free throws cluster at the line.",
      nhl: "Each dot is one game's first goal, drawn in the attacking zone with the net at the top.",
      nfl: "Each line is one game's first touchdown, from the snap to the end zone. Dashed lines are passes.",
    }[lg];
    return `<div class="panel">
      <div class="map-tools"><h3 style="margin:0">${title}</h3>
        <select data-mapteam="${lg}" aria-label="Show one team"><option value="">All teams (${games.length})</option>${options}</select></div>
      <div class="mapwrap">${window.OFMaps.season(lg, shown, color, tipText)}</div>
      <p class="map-note">${note} ${sel ? `${shown.length} games.` : ""}</p>
    </div>`;
  }

  function leagueStats(lg) {
    const games = state.games.filter((g) => g.league === lg && g.first);
    if (!games.length) return `<div class="league-block"><h2>${EMOJI[lg]} ${LNAME[lg]}</h2><p class="empty">No games yet.</p></div>`;
    const finals = games.filter((g) => winnerOf(g));
    const winsAfter = finals.filter((g) => g.first.team === winnerOf(g)).length;
    const homeFirst = games.filter((g) => g.first.team === g.home).length;
    const cats = count(games, (g) => category(lg, g.first.how));
    const tips = games.filter((g) => g.tip && g.tip.team);
    const tipThenFirst = tips.filter((g) => g.tip.team === g.first.team).length;

    const leaders = count(games, (g) => `${g.first.scorer}|${g.first.team}|${g.first.scorer_id || ""}`).slice(0, 12);
    const leaderRows = leaders.map(([k, v], i) => {
      const [name, abbr, id] = k.split("|"); const t = team(lg, abbr);
      const face = id ? `<img class="pface" src="${esc(headshot(lg, id, 60, 44))}" alt="" loading="lazy">` : "";
      return `<tr${state.mine.has(teamKey(lg, abbr)) ? ' class="mine"' : ""}><td class="rank">${i + 1}</td><td>${face}${esc(name)}</td>
        <td><span class="tteam"><img src="${esc(t.logo)}" alt="">${esc(abbr)}</span></td><td class="n">${v}</td></tr>`;
    }).join("");

    const rows = (state.teams[lg] || []).map((t) => {
      const played = games.filter((g) => g.home === t.abbr || g.away === t.abbr);
      const first = played.filter((g) => g.first.team === t.abbr);
      const fFinals = first.filter((g) => winnerOf(g));
      const fWon = fFinals.filter((g) => winnerOf(g) === t.abbr).length;
      const tipped = played.filter((g) => g.tip && g.tip.team);
      const tipsWon = tipped.filter((g) => g.tip.team === t.abbr).length;
      return { t, gp: played.length, first: first.length, p: played.length ? first.length / played.length : 0, fWon, fFinals: fFinals.length, tipsWon, tipped: tipped.length };
    }).filter((r) => r.gp).sort((a, b) => b.p - a.p || b.first - a.first);
    const tipCol = lg === "nba";
    const teamRows = rows.map((r) => `<tr${state.mine.has(teamKey(lg, r.t.abbr)) ? ' class="mine"' : ""}>
      <td><span class="tteam"><img src="${esc(r.t.logo)}" alt="">${esc(r.t.short)}</span></td>
      <td class="n">${r.first}/${r.gp}</td><td class="n"><b>${Math.round(r.p * 100)}%</b></td>
      <td class="n">${r.fFinals ? `${r.fWon}–${r.fFinals - r.fWon}` : "–"}</td>
      ${tipCol ? `<td class="n">${r.tipped ? `${pct(r.tipsWon, r.tipped)}%` : "–"}</td>` : ""}</tr>`).join("");

    const extra = lg === "nhl"
      ? `<div class="panel"><h3>Game situation</h3>${bars(count(games, (g) => strength(g.first.how)), games.length, "goal")}</div>`
      : lg === "nfl"
        ? `<div class="panel"><h3>Which quarter</h3>${bars(count(games, (g) => g.first.period || "?").sort(), games.length, "game")}</div>`
        : `<div class="panel"><h3>Does winning the tip matter?</h3>
            ${bars([["Tip winner scored first", tipThenFirst], ["Other team scored first", tips.length - tipThenFirst]], tips.length, "game")}
            <h3 style="margin-top:16px">Home or away</h3>
            ${bars([["Home team", homeFirst], ["Away team", games.length - homeFirst]], games.length, "game")}</div>`;

    const tipTile = lg === "nba" && tips.length
      ? `<div class="tile"><div class="k">Won the tip, scored first</div><div class="v">${pct(tipThenFirst, tips.length)}%</div><div class="s">${tipThenFirst} of ${tips.length} games</div></div>`
      : "";

    return `<div class="league-block"><h2>${EMOJI[lg]} ${LNAME[lg]}</h2>
      <div class="tiles">
        <div class="tile"><div class="k">Scored first, then won</div><div class="v">${pct(winsAfter, finals.length)}%</div><div class="s">${winsAfter} of ${finals.length} finished games</div></div>
        ${tipTile}
        <div class="tile"><div class="k">Most common way</div><div class="v">${esc(cats[0][0])}</div><div class="s">${pct(cats[0][1], games.length)}% of ${WHATS[lg]}</div></div>
        <div class="tile"><div class="k">Games tracked</div><div class="v">${games.length}</div><div class="s">this season</div></div>
      </div>
      <div class="cols">
        ${mapPanel(lg, games)}
        <div class="stack"><div class="panel"><h3>How the ${WHAT[lg]} happened</h3>${bars(cats, games.length, "game")}</div>
        ${extra}</div>
        <div class="panel"><h3>Most ${WHATS[lg]}</h3><table><thead><tr><th></th><th>Player</th><th>Team</th><th class="n">Firsts</th></tr></thead><tbody>${leaderRows}</tbody></table></div>
        <div class="panel"><h3>Which teams score first</h3><div class="scroll"><table><thead><tr><th>Team</th><th class="n">First</th><th class="n">Rate</th><th class="n" title="Record in games where they scored first">Record after</th>${tipCol ? `<th class="n" title="Opening tips won">Tips won</th>` : ""}</tr></thead><tbody>${teamRows}</tbody></table></div></div>
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
      if (a.dataset.view === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.querySelectorAll(".chips button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.league === state.league)));
    $("#mine-toggle").hidden = state.view !== "latest";
    $("#mine-only").checked = state.mineOnly;
    ({ latest: renderLatest, teams: renderTeams, stats: renderStats })[state.view]();
    if (state.updated) {
      const mins = Math.max(0, Math.round((Date.now() - new Date(state.updated)) / 60000));
      $("#updated").textContent = `Last checked ${mins < 1 ? "just now" : mins < 120 ? `${mins} min ago` : `${Math.round(mins / 60)} hours ago`}.`;
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
      if (e.target.closest("[data-install]")) { install(); return; }
      const c = e.target.closest("[data-copy]");
      if (c) {
        try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = "Copied"; }
        catch { prompt("Copy this topic:", c.dataset.copy); }
        setTimeout(() => { c.textContent = "Copy"; }, 1500);
      }
    });
    $("#view-stats").addEventListener("change", (e) => {
      const s = e.target.closest("[data-mapteam]"); if (!s) return;
      state.mapTeam[s.dataset.mapteam] = s.value; renderStats();
    });
    // Headshot missing -> fall back to the team logo (once).
    document.addEventListener("error", (e) => {
      const img = e.target;
      if (img.tagName === "IMG" && img.classList.contains("shot") && img.dataset.fallback && !img.classList.contains("logo-fallback")) {
        img.classList.add("logo-fallback"); img.src = img.dataset.fallback;
      }
    }, true);
    // Hover tooltips for bars and map marks.
    const tip = $("#tip");
    document.addEventListener("pointermove", (e) => {
      const r = e.target.closest?.("[data-tip]");
      if (!r) { tip.hidden = true; return; }
      tip.textContent = r.dataset.tip; tip.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${e.clientY + 16}px`;
    });
    window.addEventListener("hashchange", route);
    $("#install").addEventListener("click", install);
  }

  // ---------------------------------------------------------------- install as an app (PWA)
  async function install() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    $("#install").classList.remove("show");
    if (state.view === "teams") renderTeams();
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); state.installPrompt = e;
    $("#install").classList.add("show");
    if (state.view === "teams") renderTeams();
  });
  if ("serviceWorker" in navigator && !LOCAL) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  async function refresh() {
    try { await loadGames(); $("#status").textContent = ""; render(); }
    catch (e) { console.error(e); if (!state.games.length) $("#status").textContent = "Scores didn't load. Check your connection; the page retries every minute."; }
  }

  async function init() {
    state.league = store.get("league", "all");
    state.mineOnly = store.get("mineOnly", false);
    state.mine = new Set(store.get("mine", []));
    wire();
    $("#status").textContent = "Loading scores…";
    try { await loadStatic(); } catch (e) { $("#status").textContent = "The team list didn't load. Reload the page to try again."; return; }
    await refresh();
    for (const g of state.games) if (g.first) state.seen.add(`${g.league}:${g.id}`);
    route();
    setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  init();
})();
