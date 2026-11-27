/* Only First — static site. Reads config.json, teams.json and firsts.json. */
(() => {
  "use strict";

  const { t } = window.OFi18n;
  const ALL_LEAGUES = ["nba", "nhl", "nfl"];
  const EMOJI = { nba: "🏀", nhl: "🏒", nfl: "🏈" };
  const REFRESH_MS = 60_000;
  const VIEWS = ["latest", "teams", "matchup", "stats"];
  const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

  const state = {
    config: {}, teams: {}, teamIdx: {}, games: [], updated: null,
    view: "latest", league: "all", mineOnly: false, mine: new Set(),
    day: "", seen: new Set(), firstLoad: true, mapTeam: {}, matchup: {}, muSplit: false, statsLeague: "nba", introDone: false,
    sports: new Set(ALL_LEAGUES), theme: "auto",
  };

  // ---------------------------------------------------------------- storage (best effort)
  const store = {
    get(k, d) { try { const v = localStorage.getItem("of:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("of:" + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
  };

  // ---------------------------------------------------------------- utils
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lname = (lg) => window.OFi18n.league(lg);
  const locale = () => window.OFi18n.locale();
  const leagues = () => ALL_LEAGUES.filter((lg) => state.sports.has(lg));
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const pctLabel = (a, b) => (a && pct(a, b) === 0 ? "<1%" : `${pct(a, b)}%`);
  const teamKey = (lg, abbr) => `${lg}:${abbr}`;
  const team = (lg, abbr) => state.teamIdx[teamKey(lg, abbr)] || { abbr, name: abbr, short: abbr, color: "666666", alt: "aaaaaa", logo: "" };
  const isMine = (g) => state.mine.has(teamKey(g.league, g.home)) || state.mine.has(teamKey(g.league, g.away));
  const hex = (c) => `#${/^[0-9a-f]{6}$/i.test(c || "") ? c : "666666"}`;
  const headshot = (lg, id, w = 224, h = 164) => id
    ? `https://a.espncdn.com/combiner/i?img=/i/headshots/${lg}/players/full/${encodeURIComponent(id)}.png&w=${w}&h=${h}&scale=crop&cquality=60`
    : "";
  const ymd = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  const dayStr = (s) => ymd(s).toLocaleDateString(locale(), { month: "short", day: "numeric" });

  function luminance(c) {
    const n = parseInt(hex(c).slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const inkOn = (c) => (luminance(c) > 0.42 ? "#12151c" : "#ffffff");
  function teamVars(tm) {
    let c1 = hex(tm.color), c2 = hex(tm.alt);
    if (c1.toLowerCase() === c2.toLowerCase()) c2 = luminance(c1) > 0.4 ? "#12151c" : "#ffffff";
    return `--c1:${c1};--c2:${c2};--on:${inkOn(c1)};--tc:${c1}`;
  }

  const localYmd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  function dayLabel(s) {
    const d = ymd(s);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    const long = cap(d.toLocaleDateString(locale(), { weekday: "long", month: "long", day: "numeric" }));
    if (diff === 0) return [t("day.today"), long];
    if (diff === 1) return [t("day.yesterday"), long];
    if (diff === -1) return [t("day.tomorrow"), long];
    return [cap(d.toLocaleDateString(locale(), { weekday: "long" })), d.toLocaleDateString(locale(), { month: "long", day: "numeric" })];
  }
  function periodLabel(lg, p) {
    const s = String(p || "");
    if (lg === "nba") return s.replace(/^(\d)(?:st|nd|rd|th) Quarter$/, (m, n) => (window.OFi18n.lang === "fr" ? `${n}e qt` : `Q${n}`));
    if (lg === "nhl" && window.OFi18n.lang !== "en") {
      const m = s.match(/^(\d)(?:st|nd|rd|th)$/);
      if (m) return window.OFi18n.lang === "fr" ? `${m[1]}${m[1] === "1" ? "re" : "e"} pér.` : `${m[1]}.º periodo`;
    }
    return s;
  }
  const startTime = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });

  // ---------------------------------------------------------------- how it happened (translated)
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
  const catLabel = (c) => t(`cat.${c}`);

  /** The feed's "how" text is English; in other languages, rebuild it from its parts. */
  function howText(lg, how) {
    if (window.OFi18n.lang === "en") return how;
    const lang = window.OFi18n.lang;
    const cat = catLabel(category(lg, how));
    if (lg === "nba") {
      const ft = how.match(/from (\d+) ft/);
      if (!ft) return cat;
      return lang === "fr" ? `${cat} de ${ft[1]} pieds` : `${cat} desde ${ft[1]} pies`;
    }
    if (lg === "nhl") {
      const parts = [cat, catLabel(strength(how)).toLowerCase()];
      if (/empty net/i.test(how)) parts.push(catLabel("Empty net").toLowerCase());
      return parts.join(", ");
    }
    const c = category(lg, how);
    let s = c === "Passing" ? (lang === "fr" ? "Touché sur passe" : "Touchdown de pase")
      : c === "Rushing" ? (lang === "fr" ? "Touché au sol" : "Touchdown por tierra")
        : `${lang === "fr" ? "Touché" : "Touchdown"} (${catLabel(c).toLowerCase()})`;
    const yd = how.match(/(\d+) yds?/);
    if (yd) s += lang === "fr" ? `, ${yd[1]} verges` : `, ${yd[1]} yardas`;
    const by = how.match(/ from (.+)$/);
    if (by && c === "Passing") s += lang === "fr" ? `, passe de ${by[1]}` : `, pase de ${by[1]}`;
    return s;
  }

  // ---------------------------------------------------------------- data
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  async function loadStatic() {
    state.config = await getJSON("config.json").catch(() => ({}));
    state.teams = await getJSON("teams.json");
    for (const lg of ALL_LEAGUES) for (const tm of state.teams[lg] || []) state.teamIdx[teamKey(lg, tm.abbr)] = tm;
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
        countSeasons(state.games);
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // Season runs Aug-Jul for all three leagues. g.nth: how many of the season's games, up to and
  // including this one, its scorer scored first in (the same count the alerts give).
  const seasonOf = (day) => (+day.slice(4, 6) >= 8 ? +day.slice(0, 4) : +day.slice(0, 4) - 1);
  function countSeasons(games) {
    const seen = new Map();
    for (const g of [...games].reverse()) {  // oldest first
      if (!g.first || !g.date) continue;
      const who = g.first.scorer_id || `${g.first.scorer}|${g.first.team}`;
      const k = `${g.league}|${seasonOf(g.date)}|${who}`;
      g.nth = (seen.get(k) || 0) + 1;
      seen.set(k, g.nth);
    }
  }
  function ordinal(n) {
    const lang = window.OFi18n.lang;
    if (lang === "es") return `${n}.ª`;
    if (lang === "fr") return n === 1 ? "1re" : `${n}e`;
    return n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  }

  function filtered() {
    return state.games.filter((g) => state.sports.has(g.league) &&
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
        ? `<span class="won">${esc(t("fact.wonFirst"))}</span>`
        : `<span class="lost">${esc(t("fact.lostFirst"))}</span>`);
      out.push(`<span>${esc(w)} ${score}</span>`);
    } else if (g.final && g.home_score != null) {
      out.push(`<span>${esc(t("fact.final", { result: g.home_score === g.away_score ? t("fact.tie", { score }) : `${w} ${score}` }))}</span>`);
    }
    if (g.tip && g.tip.team) {
      const tm = team(g.league, g.tip.team);
      out.push(`<span class="tip" title="${esc(g.tip.text)}">${esc(t("fact.tip"))} ${tm.logo ? `<img src="${esc(tm.logo)}" alt="">` : ""}${esc(g.tip.team)}</span>`);
    }
    return out.length ? `<div class="facts">${out.join("")}</div>` : "";
  }

  function mapCaption(lg, f) {
    const s = f.spot || {};
    if (lg === "nba") return s.ft ? t("map.ftLine") : s.x != null ? t("map.ftOut", { n: Math.round(Math.hypot(s.x - 25, s.y)) }) : "";
    if (lg === "nhl") return s.x != null ? t("map.net", { n: Math.round(Math.hypot(89 - s.x, s.y)) }) : "";
    if (s.yards == null) return "";
    const kind = /pass/i.test(f.how) ? "pass" : /return|recovery/i.test(f.how) ? "return" : "run";
    return t(`map.${kind}`, { n: s.yards }) + (s.lane ? `, ${t(`lane.${s.lane}`)}` : "");
  }

  function card(g) {
    const f = g.first;
    const key = `${g.league}:${g.id}`;
    const isNew = !state.firstLoad && f && !state.seen.has(key);
    if (f) state.seen.add(key);
    const po = g.playoffs ? `<span class="badge">${esc(t("card.playoffs"))}</span>` : "";

    if (f) {
      const tm = team(g.league, f.team);
      const photo = headshot(g.league, f.scorer_id);
      const img = photo
        ? `<img class="shot" src="${esc(photo)}" data-fallback="${esc(tm.logo)}" alt="" width="112" height="82" loading="lazy">`
        : `<img class="shot logo-fallback" src="${esc(tm.logo)}" alt="" width="64" height="64" loading="lazy">`;
      const svg = window.OFMaps.mini(g.league, f, hex(tm.color));
      const map = svg ? `<figure class="mapfig">${svg}<figcaption>${esc(mapCaption(g.league, f))}</figcaption></figure>` : "";
      const assistKey = g.league === "nhl" && f.assists.length > 1 ? "card.assist.nhl" : "card.assist";
      const assists = f.assists?.length ? `<p class="assist">${esc(t(assistKey, { names: f.assists.join(", ") }))}</p>` : "";
      const season = g.nth ? `<p class="season">${esc(t(`card.season.${g.league}`, { nth: ordinal(g.nth) }))}</p>` : "";
      return `<article class="card${isNew ? " is-new" : ""}" id="g-${g.league}-${esc(g.id)}" style="${teamVars(tm)}">
        <div class="hero">
          ${tm.logo ? `<img class="wm" src="${esc(tm.logo)}" alt="" loading="lazy">` : ""}
          <div class="hero-top"><span class="lg">${esc(lname(g.league))}</span><span>${esc(g.name)}</span>${po}
            <span class="when">${esc(periodLabel(g.league, f.period))} ${esc(f.clock)}</span></div>
          <div class="who">${img}<h3><small>${esc(tm.name)}</small>${esc(f.scorer)}</h3></div>
        </div>
        <div class="body"><div><p class="how">${esc(howText(g.league, f.how))}</p>${assists}${season}${facts(g)}</div>${map}</div>
        <div class="card-actions">
          <details class="play-text"><summary>${esc(t("card.playbyplay"))}</summary><p lang="en">${esc(f.description)}</p></details>
          <button class="share" data-share="${g.league}:${esc(g.id)}" aria-label="${esc(t("card.shareLabel", { name: f.scorer }))}">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(t("card.share"))}</button>
        </div>
      </article>`;
    }

    const home = team(g.league, g.home), away = team(g.league, g.away);
    let msg, when;
    if (g.state === "in") { msg = t(`live.msg.${g.league}`); when = `<span class="live-pill"><span class="live-dot"></span>${esc(t("live.label"))}</span>`; }
    else if (g.state === "pre") { msg = t(`pre.${g.league}`, { time: startTime(g.start) }); when = esc(t("pre.upcoming")); }
    else { msg = t(`none.${g.league}`); when = esc(t("final.label")); }
    const style = `--c1:${hex(away.color)};--c2:${hex(home.color)};--on:#fff`;
    return `<article class="card pending${g.state === "in" ? " is-live" : ""}" style="${style}">
      <div class="hero">
        <div class="hero-top"><span class="lg">${esc(lname(g.league))}</span><span>${esc(g.name)}</span>${po}<span class="when">${when}</span></div>
        <div class="vs">${away.logo ? `<img src="${esc(away.logo)}" alt="${esc(away.name)}">` : ""}<span>${esc(t("vs.at"))}</span>${home.logo ? `<img src="${esc(home.logo)}" alt="${esc(home.name)}">` : ""}</div>
      </div>
      <div class="body"><div><p class="waiting">${esc(msg)}</p>${facts(g)}</div></div>
      <div class="card-actions"><span></span><a class="share" href="#matchup=${g.league}-${esc(g.away)}-${esc(g.home)}">${esc(t("mu.open"))} →</a></div>
    </article>`;
  }

  function renderLatest() {
    const el = $("#view-latest");
    const games = filtered();
    if (!games.length) {
      el.innerHTML = `<p class="empty">${state.mineOnly && !state.mine.size
        ? `${esc(t("empty.pick"))} <a href="#teams">${esc(t("empty.pickLink"))}</a>`
        : esc(t("empty.none"))}</p>`;
      return;
    }
    const byDay = new Map();
    for (const g of games) { if (!byDay.has(g.date)) byDay.set(g.date, []); byDay.get(g.date).push(g); }
    const days = [...byDay.keys()].sort().reverse();
    const order = { in: 0, post: 1, pre: 2 };
    const intro = state.introDone ? "" : `<div class="intro">
        <p><b>${esc(t("intro.title"))}</b> ${esc(t("intro.body"))}</p>
        <div class="intro-actions"><a class="btn" href="#teams">${esc(t("intro.pick"))}</a><button class="btn ghost" data-dismiss-intro>${esc(t("intro.ok"))}</button></div></div>`;
    // One day at a time: Today, Yesterday, or a picked date ("" means today).
    const today = localYmd(new Date()), yesterday = localYmd(new Date(Date.now() - 86400000));
    const day = state.day || today;
    const iso = (x) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
    const picked = day !== today && day !== yesterday;
    const bar = `<div class="chips day-tabs" role="group" aria-label="${esc(t("day.choose"))}">
        <button data-day="${today}" aria-pressed="${day === today}">${esc(t("day.today"))}</button>
        <button data-day="${yesterday}" aria-pressed="${day === yesterday}">${esc(t("day.yesterday"))}</button>
        <label class="date-chip${picked ? " on" : ""}"><input type="date" id="day-pick" aria-label="${esc(t("day.pick"))}" value="${iso(day)}" min="${iso(days[days.length - 1])}" max="${iso(days[0] > today ? days[0] : today)}"></label>
      </div>`;
    const html = (byDay.has(day) ? [day] : []).map((d, i) => {
      const list = byDay.get(d).sort((a, b) => order[a.state] - order[b.state] ||
        (a.state === "pre" ? (a.start || "").localeCompare(b.start || "") : (b.start || "").localeCompare(a.start || "")));
      const [big, small] = dayLabel(d);
      const n = list.filter((g) => g.first).length;
      const fresh = i === 0 && state.updated ? `<span class="fresh">${esc(freshness())}</span>` : "";
      return `<div class="day"><h2>${esc(big)}</h2><span class="date">${esc(small)}</span>
          <span class="tally">${esc(t("day.tally", { n, total: list.length }))}</span>${fresh}</div>
        <div class="grid">${list.map(card).join("")}</div>`;
    }).join("");
    const none = byDay.has(day) ? "" : `<p class="empty">${esc(t("empty.day"))}</p>`;
    el.innerHTML = intro + bar + html + none;
    el.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => { state.day = b.dataset.day === today ? "" : b.dataset.day; renderLatest(); }));
    $("#day-pick")?.addEventListener("change", (e) => {
      if (!e.target.value) return;
      const v = e.target.value.replaceAll("-", "");
      state.day = v === today ? "" : v; renderLatest();
    });
  }

  function freshness() {
    const mins = Math.max(0, Math.round((Date.now() - new Date(state.updated)) / 60000));
    return mins < 1 ? t("fresh.now") : mins < 120 ? t("fresh.min", { n: mins }) : t("fresh.hours", { n: Math.round(mins / 60) });
  }

  function skeleton() {
    const one = `<div class="card skeleton"><div class="hero"></div><div class="body"><div><p class="sk w70"></p><p class="sk w40"></p></div></div></div>`;
    $("#view-latest").hidden = false;
    $("#view-latest").innerHTML = `<div class="day"><h2 class="sk-h"></h2></div><div class="grid">${one.repeat(6)}</div>`;
  }

  // ---------------------------------------------------------------- teams view
  function topicFor(lg, abbr) {
    const p = state.config.ntfy_prefix || "onlyfirst";
    return abbr ? `${p}-${lg}-${abbr.toLowerCase()}` : `${p}-${lg}`;
  }
  const ntfyServer = () => (state.config.ntfy_server || "https://ntfy.sh").replace(/\/$/, "");

  function topicRow(label, topic, logo = "") {
    return `<li>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<span class="t-name">${esc(label)}</span><code>${esc(topic)}</code>
      <a class="btn" href="${esc(ntfyServer())}/${esc(topic)}" target="_blank" rel="noopener">${esc(t("btn.subscribe"))}</a>
      <button class="btn ghost" data-copy="${esc(topic)}">${esc(t("btn.copy"))}</button></li>`;
  }

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function homeScreenPanel() {
    if (standalone()) return "";
    // home.* strings contain trusted <b> markup from i18n.js, never data.
    const how = isIOS() ? t("home.ios")
      : state.installPrompt ? `<button class="btn" data-install>${esc(t("home.install"))}</button>` : t("home.other");
    return `<div class="panel home-tip"><img src="icons/icon-192.png" width="56" height="56" alt="">
      <div><h2>${esc(t("home.title"))}</h2><p style="margin:0;color:var(--text-2)">${esc(t("home.body"))} ${how}</p></div></div>`;
  }

  function renderTeams() {
    const el = $("#view-teams");
    const shown = state.league === "all" ? leagues() : [state.league];
    const pickers = shown.map((lg) => `
      <div class="panel"><h2>${EMOJI[lg]} ${esc(t("teams.title", { league: lname(lg) }))}</h2>
        <p>${esc(t("teams.help"))}</p>
        <div class="team-grid">${(state.teams[lg] || []).map((tm) => {
          const on = state.mine.has(teamKey(lg, tm.abbr));
          return `<button class="team-btn" aria-pressed="${on}" data-team="${teamKey(lg, tm.abbr)}" style="--tc:${hex(tm.color)}">
            <img src="${esc(tm.logo)}" alt="" loading="lazy" width="26" height="26"><span>${esc(tm.short)}</span></button>`;
        }).join("")}</div></div>`).join("");

    const mine = [...state.mine].map((k) => k.split(":")).filter(([lg]) => shown.includes(lg));
    const rows = mine.map(([lg, abbr]) => { const tm = team(lg, abbr); return topicRow(`${tm.name} (${lname(lg)})`, topicFor(lg, abbr), tm.logo); }).join("");
    const all = shown.map((lg) => topicRow(t("alerts.everyLeague", { league: lname(lg) }), topicFor(lg))).join("");
    const n = [...state.mine].filter((k) => state.sports.has(k.split(":")[0])).length;
    // teams.follow* and alerts.step* strings contain trusted <b> markup from i18n.js.
    const following = n
      ? `<div class="intro"><p>${n === 1 ? t("teams.follow1") : t("teams.followN", { n })} ${esc(t("teams.followCta"))}</p>
          <div class="intro-actions"><button class="btn" data-goto-alerts>${esc(t("teams.setup"))}</button></div></div>`
      : "";
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
    el.innerHTML = `
      ${following}
      ${pickers}
      <div class="panel" id="alerts">
        <h2>${esc(t("alerts.title"))}</h2>
        <p>${t("alerts.intro", { ntfy: link("https://ntfy.sh", "ntfy") })} ${esc(t("alerts.note"))}</p>
        <ol class="steps">
          <li>${t("alerts.step1", { ios: link("https://apps.apple.com/app/ntfy/id1625396347", "iPhone"), android: link("https://play.google.com/store/apps/details?id=io.heckel.ntfy", "Android") })}</li>
          <li>${t("alerts.step2")}</li>
          <li>${esc(t("alerts.step3"))}</li>
        </ol>
        ${rows ? `<h3>${esc(t("alerts.yours"))}</h3><ul class="topics">${rows}</ul><br>` : `<p><i>${esc(t("alerts.pickAbove"))}</i></p>`}
        <h3>${esc(t("alerts.every"))}</h3><ul class="topics">${all}</ul>
      </div>
      ${homeScreenPanel()}`;
  }

  // ---------------------------------------------------------------- stats view
  function count(list, fn) {
    const m = new Map();
    for (const x of list) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }
  function bars(entries, total) {
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return `<div class="bars">${entries.map(([k, v]) => `
      <div class="bar-row" data-tip="${esc(t("bar.tip", { label: k, n: v, total, pct: pct(v, total) }))}">
        <span class="lbl">${esc(k)}</span>
        <span><span class="bar" style="width:${(100 * v) / max}%"></span></span>
        <span class="val">${pctLabel(v, total)}</span>
      </div>`).join("")}</div>`;
  }

  function mapPanel(lg, games) {
    const sel = state.mapTeam[lg] || "";
    const shown = sel ? games.filter((g) => g.first.team === sel) : games;
    const color = sel ? hex(team(lg, sel).color) : "var(--accent)";
    const options = (state.teams[lg] || []).map((tm) =>
      `<option value="${esc(tm.abbr)}"${tm.abbr === sel ? " selected" : ""}>${esc(tm.name)}</option>`).join("");
    const tipText = (g) => `${g.first.scorer} (${g.first.team}), ${howText(lg, g.first.how)}. ${g.name}, ${dayStr(g.date)}`;
    return `<div class="panel">
      <div class="map-tools"><h3 style="margin:0">${esc(t(`map.title.${lg}`))}</h3>
        <select data-mapteam="${lg}" aria-label="${esc(t("map.oneTeam"))}"><option value="">${esc(t("map.allTeams", { n: games.length }))}</option>${options}</select></div>
      <div class="mapwrap">${window.OFMaps.season(lg, shown, color, tipText)}</div>
      <p class="map-note">${esc(t(`map.note.${lg}`))} ${sel ? esc(t("map.count", { n: shown.length })) : ""}</p>
    </div>`;
  }

  function leagueStats(lg) {
    const games = state.games.filter((g) => g.league === lg && g.first);
    if (!games.length) return `<div class="league-block"><h2>${EMOJI[lg]} ${esc(lname(lg))}</h2><p class="empty">${esc(t("stats.noGames"))}</p></div>`;
    const finals = games.filter((g) => winnerOf(g));
    const winsAfter = finals.filter((g) => g.first.team === winnerOf(g)).length;
    const homeFirst = games.filter((g) => g.first.team === g.home).length;
    const cats = count(games, (g) => catLabel(category(lg, g.first.how)));
    const tips = games.filter((g) => g.tip && g.tip.team);
    const tipThenFirst = tips.filter((g) => g.tip.team === g.first.team).length;

    const sel = state.mapTeam[lg] || "";
    const selTeam = sel ? team(lg, sel) : null;
    const leaderGames = sel ? games.filter((g) => g.first.team === sel) : games;
    const leaders = count(leaderGames, (g) => `${g.first.scorer}|${g.first.team}|${g.first.scorer_id || ""}`).slice(0, 12);
    const leaderRows = leaders.map(([k, v], i) => {
      const [name, abbr, id] = k.split("|"); const tm = team(lg, abbr);
      const face = id ? `<img class="pface" src="${esc(headshot(lg, id, 60, 44))}" alt="" loading="lazy">` : "";
      return `<tr${state.mine.has(teamKey(lg, abbr)) ? ' class="mine"' : ""}><td class="rank">${i + 1}</td><td>${face}${esc(name)}</td>
        <td><span class="tteam"><img src="${esc(tm.logo)}" alt="">${esc(abbr)}</span></td><td class="n">${v}</td></tr>`;
    }).join("") || `<tr><td colspan="4" class="empty">${esc(t("stats.noGames"))}</td></tr>`;
    const leadersTitle = t(`leaders.title.${lg}`) + (selTeam ? ` · ${selTeam.short}` : "");

    const rows = (state.teams[lg] || []).map((tm) => {
      const played = games.filter((g) => g.home === tm.abbr || g.away === tm.abbr);
      const first = played.filter((g) => g.first.team === tm.abbr);
      const fFinals = first.filter((g) => winnerOf(g));
      const fWon = fFinals.filter((g) => winnerOf(g) === tm.abbr).length;
      const tipped = played.filter((g) => g.tip && g.tip.team);
      const tipsWon = tipped.filter((g) => g.tip.team === tm.abbr).length;
      return { tm, gp: played.length, first: first.length, p: played.length ? first.length / played.length : 0, fWon, fFinals: fFinals.length, tipsWon, tipped: tipped.length };
    }).filter((r) => r.gp).sort((a, b) => b.p - a.p || b.first - a.first);
    const tipCol = lg === "nba";
    const teamRows = rows.map((r) => {
      const cls = [state.mine.has(teamKey(lg, r.tm.abbr)) && "mine", r.tm.abbr === sel && "sel"].filter(Boolean).join(" ");
      return `<tr class="pick ${cls}" data-pickteam="${esc(r.tm.abbr)}" data-league="${lg}">
      <td><button type="button" class="tteam pickbtn" aria-pressed="${r.tm.abbr === sel}"><img src="${esc(r.tm.logo)}" alt="">${esc(r.tm.short)}</button></td>
      <td class="n">${r.first}/${r.gp}</td><td class="n"><b>${Math.round(r.p * 100)}%</b></td>
      <td class="n">${r.fFinals ? `${r.fWon}–${r.fFinals - r.fWon}` : "–"}</td>
      ${tipCol ? `<td class="n">${r.tipped ? `${pct(r.tipsWon, r.tipped)}%` : "–"}</td>` : ""}</tr>`;
    }).join("");

    const extra = lg === "nhl"
      ? `<div class="panel"><h3>${esc(t("nhl.situation"))}</h3>${bars(count(games, (g) => catLabel(strength(g.first.how))), games.length)}</div>`
      : lg === "nfl"
        ? `<div class="panel"><h3>${esc(t("nfl.quarter"))}</h3>${bars(count(games, (g) => g.first.period || "?").sort(), games.length)}</div>`
        : `<div class="panel"><h3>${esc(t("nba.tipMatter"))}</h3>
            ${bars([[t("nba.tipFirst"), tipThenFirst], [t("nba.otherFirst"), tips.length - tipThenFirst]], tips.length)}
            <h3 style="margin-top:16px">${esc(t("homeaway"))}</h3>
            ${bars([[t("side.home"), homeFirst], [t("side.away"), games.length - homeFirst]], games.length)}</div>`;

    const tile = (k, v, s) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`;
    const tipTile = lg === "nba" && tips.length ? tile(t("tile.tip"), `${pct(tipThenFirst, tips.length)}%`, t("tile.ofGames", { n: tipThenFirst, total: tips.length })) : "";

    return `<div class="league-block"><h2>${EMOJI[lg]} ${esc(lname(lg))}</h2>
      <div class="tiles">
        ${tile(t("tile.firstWon"), `${pct(winsAfter, finals.length)}%`, t("tile.ofFinished", { n: winsAfter, total: finals.length }))}
        ${tipTile}
        ${tile(t("tile.common"), cats[0][0], t("tile.pctGames", { pct: pct(cats[0][1], games.length) }))}
        ${tile(t("tile.tracked"), String(games.length), t("tile.season"))}
      </div>
      <div class="cols">
        ${mapPanel(lg, games)}
        <div class="stack"><div class="panel"><h3>${esc(t(`how.title.${lg}`))}</h3>${bars(cats, games.length)}</div>
        ${extra}</div>
        <div class="panel"><h3>${esc(leadersTitle)}</h3><table><thead><tr><th></th><th>${esc(t("th.player"))}</th><th>${esc(t("th.team"))}</th><th class="n">${esc(t("th.firsts"))}</th></tr></thead><tbody>${leaderRows}</tbody></table></div>
        <div class="panel"><h3>${esc(t("teamsFirst.title"))}</h3><div class="scroll"><table><thead><tr><th>${esc(t("th.team"))}</th><th class="n">${esc(t("th.first"))}</th><th class="n">${esc(t("th.rate"))}</th><th class="n" title="${esc(t("th.recordTip"))}">${esc(t("th.record"))}</th>${tipCol ? `<th class="n" title="${esc(t("th.tipsTip"))}">${esc(t("th.tips"))}</th>` : ""}</tr></thead><tbody>${teamRows}</tbody></table></div></div>
      </div></div>`;
  }

  // ---------------------------------------------------------------- matchup view
  // Two teams side by side: how often each scores first, who does it, and how their meetings went.
  // "split" keeps only the away team's road games and the home team's home games.
  const playsIn = (g, abbr, side) => (side ? g[side] === abbr : g.home === abbr || g.away === abbr);

  function slate(lg) {
    // Today's games in this league, or the next day that has some, or failing that the latest day.
    const today = localYmd(new Date());
    const lgGames = state.games.filter((g) => g.league === lg);
    const days = [...new Set(lgGames.map((g) => g.date))].sort();
    const day = days.find((d) => d >= today) || days[days.length - 1];
    const order = { in: 0, pre: 1, post: 2 };
    const list = lgGames.filter((g) => g.date === day)
      .sort((a, b) => order[a.state] - order[b.state] || (a.start || "").localeCompare(b.start || ""));
    return { day, list };
  }

  function matchupFor(lg) {
    const m = state.matchup[lg];
    if (m && state.teamIdx[teamKey(lg, m.away)] && state.teamIdx[teamKey(lg, m.home)]) return m;
    const g = slate(lg).list[0];
    const tms = state.teams[lg] || [];
    return g ? { away: g.away, home: g.home } : { away: tms[0]?.abbr, home: tms[1]?.abbr };
  }

  function sideCard(lg, games, abbr, side, split) {
    const tm = team(lg, abbr);
    const played = games.filter((g) => playsIn(g, abbr, split ? side : null));
    const first = played.filter((g) => g.first.team === abbr);
    const fFinals = first.filter((g) => winnerOf(g));
    const fWon = fFinals.filter((g) => winnerOf(g) === abbr).length;
    const tipped = played.filter((g) => g.tip && g.tip.team);
    const tipsWon = tipped.filter((g) => g.tip.team === abbr).length;
    const tile = (k, v, s) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`;
    const scorers = count(first, (g) => `${g.first.scorer}|${g.first.scorer_id || ""}`).slice(0, 6).map(([k, v]) => {
      const [name, id] = k.split("|");
      const face = id ? `<img class="pface" src="${esc(headshot(lg, id, 60, 44))}" alt="" loading="lazy">` : "";
      return `<tr><td>${face}${esc(name)}</td><td class="n">${v}</td><td class="n">${pctLabel(v, first.length)}</td></tr>`;
    }).join("");
    const recent = played.slice(0, 5).map((g) => {
      const home = g.home === abbr, opp = team(lg, home ? g.away : g.home), by = team(lg, g.first.team);
      const mine = g.first.team === abbr;
      return `<li class="${mine ? "yes" : "no"}"><a href="#game=${lg}-${esc(g.id)}">
        <span class="d">${esc(dayStr(g.date))}</span>
        <span class="tteam">${home ? "vs" : "@"} <img src="${esc(opp.logo)}" alt="">${esc(opp.abbr)}</span>
        <span class="by"><img src="${esc(by.logo)}" alt="">${esc(g.first.scorer)}</span>
        <span class="mark" aria-hidden="true">${mine ? "✓" : "✗"}</span></a></li>`;
    }).join("");
    return { played: played.length, first: first.length, html: `<div class="panel mu-side" style="${teamVars(tm)}">
      <div class="mu-head"><img src="${esc(tm.logo)}" alt=""><div><small>${esc(t(`side.${side}`))}</small><h2>${esc(tm.name)}</h2></div></div>
      ${played.length ? `<div class="tiles">
        ${tile(t("mu.rate"), `${pct(first.length, played.length)}%`, t("tile.ofGames", { n: first.length, total: played.length }))}
        ${tile(t("mu.after"), fFinals.length ? `${fWon}–${fFinals.length - fWon}` : "–", t("tile.ofFinished", { n: fFinals.length, total: played.filter((g) => g.final).length }))}
        ${lg === "nba" && tipped.length ? tile(t("mu.tips"), `${pct(tipsWon, tipped.length)}%`, t("tile.ofGames", { n: tipsWon, total: tipped.length })) : ""}
      </div>
      <h3>${esc(t("mu.scorers"))}</h3>
      ${scorers ? `<table><thead><tr><th>${esc(t("th.player"))}</th><th class="n">${esc(t("th.firsts"))}</th><th class="n"></th></tr></thead><tbody>${scorers}</tbody></table>` : `<p class="empty">${esc(t("mu.none"))}</p>`}
      <h3 style="margin-top:16px">${esc(t("mu.recent"))}</h3><ul class="mu-recent">${recent}</ul>`
      : `<p class="empty">${esc(t("mu.noGames"))}</p>`}
    </div>` };
  }

  // Position groups: NBA guard/forward/center; NHL as given; NFL offense by position, the rest together.
  function posGroup(lg, p) {
    p = String(p || "").toUpperCase();
    if (!p) return "";
    if (lg === "nba") return p === "C" ? "C" : /^(PG|SG|G)/.test(p) ? "G" : /^(SF|PF|F)/.test(p) ? "F" : p[0];
    if (lg === "nfl") return p === "FB" ? "RB" : ["RB", "WR", "TE", "QB"].includes(p) ? p : "DST";
    return p;
  }
  const posName = (lg, grp) => t(`pos.${lg}.${grp}`);

  // Who scores first: (1) the team with the better first-score rate in this spot (away team's road
  // games vs home team's home games), (2) that team's most frequent first scorers, (3) which
  // positions score first against the other team, used to choose the best fit among those scorers.
  function pickPanel(lg, games, A, H) {
    const rate = (tm, side) => {
      const gs = games.filter((g) => g[side] === tm.abbr);
      return { n: gs.length, first: gs.filter((g) => g.first.team === tm.abbr).length };
    };
    const ra = rate(A, "away"), rh = rate(H, "home");
    const row = (tm, r, key) => `<div class="mu-rate${r.n ? "" : " none"}"><span class="tteam"><img src="${esc(tm.logo)}" alt="">${esc(t(key, { team: tm.short }))}</span>
        <span class="bar" style="width:${pct(r.first, r.n)}%;background:${hex(tm.color)}"></span>
        <span class="val">${r.n ? `${pct(r.first, r.n)}% <small>${r.first}/${r.n}</small>` : "–"}</span></div>`;
    const step = (n, title, body) => `<li><span class="step">${n}</span><div><h4>${esc(title)}</h4>${body}</div></li>`;
    const pa = ra.n ? ra.first / ra.n : null, ph = rh.n ? rh.first / rh.n : null;
    const pick = pa == null || ph == null || pa === ph ? null : pa > ph ? A : H;
    const steps = [step(1, t("mu.step.team"), row(A, ra, "mu.road") + row(H, rh, "mu.atHome") +
      `<p class="mu-verdict">${esc(pa == null || ph == null ? t("mu.noPick") : pick ? t("mu.pick", { team: pick.name }) : t("mu.even"))}</p>`)];
    if (pick) {
      const opp = pick === A ? H : A;
      // (3) positions of the scorers when the opponent's opponent scored first
      const against = games.filter((g) => (g.home === opp.abbr || g.away === opp.abbr) && g.first.team !== opp.abbr);
      const withPos = against.filter((g) => posGroup(lg, g.first.pos));
      const share = new Map(count(withPos, (g) => posGroup(lg, g.first.pos)));
      // (2) the pick's first scorers, best fit first: most firsts, weighted by how often their position scores against the opponent
      const mine = games.filter((g) => g.first.team === pick.abbr);
      const players = count(mine, (g) => g.first.scorer_id || g.first.scorer).map(([k, n]) => {
        const g = mine.find((x) => (x.first.scorer_id || x.first.scorer) === k);
        const grp = posGroup(lg, g.first.pos);
        return { name: g.first.scorer, id: g.first.scorer_id, grp, n, fit: n * (withPos.length ? (share.get(grp) || 0) / withPos.length + 0.05 : 1) };
      });
      const best = withPos.length >= 3 ? [...players].sort((x, y) => y.fit - x.fit || y.n - x.n)[0] : null;
      const plist = players.slice(0, 3).map((p) => `<li${best && p === best ? ' class="best"' : ""}>
          ${p.id ? `<img class="pface" src="${esc(headshot(lg, p.id, 60, 44))}" alt="" loading="lazy">` : ""}<span>${esc(p.name)}</span>
          ${p.grp ? `<span class="ptag">${esc(p.grp)}</span>` : ""}<span class="val">${esc(t("mu.ofFirsts", { n: p.n, team: pick.abbr, total: mine.length }))}</span></li>`).join("");
      steps.push(step(2, t("mu.step.player"), plist ? `<ul class="mu-players">${plist}</ul>` : `<p class="empty">${esc(t("mu.none"))}</p>`));
      const pending = against.length - withPos.length > against.length / 4 ? `<p class="map-note">${esc(t("mu.posPending"))}</p>` : "";
      const posBody = withPos.length
        ? bars([...share.entries()].map(([grp, n]) => [posName(lg, grp), n]), withPos.length) +
          `<p class="map-note">${esc(t("mu.posNote", { n: withPos.length, team: opp.short }))}</p>` + pending +
          (best ? `<p class="mu-verdict">${esc(t("mu.bestFit", { name: best.name }))}${best.grp ? ` <small>${esc(t("mu.bestFitWhy", { pos: posName(lg, best.grp), pct: pct(share.get(best.grp) || 0, withPos.length), team: opp.short }))}</small>` : ""}</p>` : "")
        : `<p class="empty">${esc(t("mu.posPending"))}</p>`;
      steps.push(step(3, t("mu.step.pos", { team: opp.short }), posBody));
    }
    return `<div class="panel"><h3>${esc(t("mu.lean"))}</h3><ol class="mu-steps">${steps.join("")}</ol>
      <p class="map-note">${esc(t("mu.how"))}</p></div>`;
  }

  function renderMatchup() {
    const el = $("#view-matchup");
    const lg = statsLeague();
    const games = state.games.filter((g) => g.league === lg && g.first);
    const { away, home } = matchupFor(lg);
    const split = state.muSplit;
    const A = team(lg, away), H = team(lg, home);
    const { day, list } = slate(lg);
    const quick = list.length ? `<div class="mu-slate"><span class="lbl">${esc(dayLabel(day)[0])}</span><div class="chips">${list.map((g) =>
      `<button data-mu="${esc(g.away)}|${esc(g.home)}" aria-pressed="${g.away === away && g.home === home}">${esc(g.away)} @ ${esc(g.home)}</button>`).join("")}</div></div>` : "";
    const opts = (sel) => (state.teams[lg] || []).map((tm) => `<option value="${esc(tm.abbr)}"${tm.abbr === sel ? " selected" : ""}>${esc(tm.name)}</option>`).join("");
    const pickers = `<div class="mu-pick">
        <label><span>${esc(t("side.away"))}</span><select data-muside="away">${opts(away)}</select></label>
        <button type="button" class="mu-swap" data-muswap aria-label="${esc(t("mu.swap"))}" title="${esc(t("mu.swap"))}">⇄</button>
        <label><span>${esc(t("side.home"))}</span><select data-muside="home">${opts(home)}</select></label>
      </div>
      <div class="seg mu-seg" role="radiogroup" aria-label="${esc(t("homeaway"))}">
        <button type="button" role="radio" aria-checked="${!split}" data-musplit="0">${esc(t("mu.allGames"))}</button>
        <button type="button" role="radio" aria-checked="${split}" data-musplit="1">${esc(t("mu.split", { away: A.short, home: H.short }))}</button>
      </div>
      ${split ? `<p class="map-note">${esc(t("mu.splitHelp", { away: A.short, home: H.short }))}</p>` : ""}`;
    if (away === home) {
      el.innerHTML = `${quick}<div class="panel"><h3>${esc(t("mu.pickTeams"))}</h3>${pickers}<p class="empty">${esc(t("mu.same"))}</p></div>`;
      return;
    }
    const a = sideCard(lg, games, away, "away", split), h = sideCard(lg, games, home, "home", split);
    const lean = pickPanel(lg, games, A, H);
    const met = games.filter((g) => playsIn(g, away) && playsIn(g, home) && (!split || (g.away === away && g.home === home)));
    const h2h = `<div class="panel"><h3>${esc(t("mu.h2h"))}</h3>${met.length ? `<ul class="mu-recent">${met.map((g) => {
      const by = team(lg, g.first.team);
      return `<li><a href="#game=${lg}-${esc(g.id)}"><span class="d">${esc(dayStr(g.date))}</span><span>${esc(g.away)} @ ${esc(g.home)}</span>
        <span class="by"><img src="${esc(by.logo)}" alt="">${esc(g.first.scorer)}</span><span class="mark">${esc(periodLabel(lg, g.first.period))} ${esc(g.first.clock)}</span></a></li>`;
    }).join("")}</ul>` : `<p class="empty">${esc(t("mu.noH2h"))}</p>`}</div>`;
    el.innerHTML = `${quick}<div class="panel"><h3>${esc(t("mu.pickTeams"))}</h3>${pickers}</div>
      ${lean}<div class="cols mu-cols">${a.html}${h.html}</div>${h2h}`;
  }

  function setMatchup(lg, away, home) {
    state.matchup[lg] = { away, home }; store.set("matchup", state.matchup); renderMatchup();
  }

  const statsLeague = () => {
    const lg = state.league === "all" ? state.statsLeague : state.league;
    return state.sports.has(lg) ? lg : leagues()[0];
  };
  function renderStats() {
    $("#view-stats").innerHTML = leagueStats(statsLeague());
  }

  // ---------------------------------------------------------------- settings: sports, language, theme
  function applyTheme() {
    const root = document.documentElement;
    if (state.theme === "auto") delete root.dataset.theme; else root.dataset.theme = state.theme;
  }

  function applyStaticText() {
    document.documentElement.lang = window.OFi18n.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nLabel)); });
    document.querySelectorAll(".chips button[data-league]").forEach((b) => {
      const lg = b.dataset.league;
      if (lg !== "all") b.querySelector(".lname").textContent = lname(lg);
    });
  }

  function renderSettings() {
    const seg = (name, options, current) => `<div class="seg" role="radiogroup" aria-label="${esc(t(`settings.${name}`))}">${options.map(([v, label]) =>
      `<button type="button" role="radio" aria-checked="${v === current}" data-set-${name}="${v}">${esc(label)}</button>`).join("")}</div>`;
    $("#settings-body").innerHTML = `
      <h2 id="settings-title">${esc(t("settings.title"))}</h2>
      <section>
        <h3>${esc(t("settings.sports"))}</h3>
        <p class="hint">${esc(t("settings.sportsHelp"))}</p>
        <div class="switches">${ALL_LEAGUES.map((lg) => `
          <label class="switch"><span>${EMOJI[lg]} ${esc(t(`sport.${lg}`))} <small>${esc(lname(lg))}</small></span>
            <input type="checkbox" role="switch" data-sport="${lg}"${state.sports.has(lg) ? " checked" : ""}${state.sports.size === 1 && state.sports.has(lg) ? ' aria-describedby="last-one"' : ""}></label>`).join("")}
        </div>
        <p class="hint" id="last-one"${state.sports.size === 1 ? "" : " hidden"}>${esc(t("settings.lastOne"))}</p>
      </section>
      <section>
        <h3>${esc(t("settings.language"))}</h3>
        ${seg("language", window.OFi18n.languages.map((l) => [l.code, l.name]), window.OFi18n.lang)}
        <p class="hint">${esc(t("settings.langNote"))}</p>
      </section>
      <section>
        <h3>${esc(t("settings.theme"))}</h3>
        ${seg("theme", [["auto", t("theme.auto")], ["light", t("theme.light")], ["dark", t("theme.dark")]], state.theme)}
      </section>
      <form method="dialog"><button class="btn done">${esc(t("settings.done"))}</button></form>`;
  }

  function openSettings() {
    renderSettings();
    const dlg = $("#settings");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  function wireSettings() {
    $("#settings-btn").addEventListener("click", openSettings);
    const dlg = $("#settings");
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) { dlg.close(); return; } // tap outside the sheet
      const lang = e.target.closest("[data-set-language]");
      if (lang) { window.OFi18n.set(lang.dataset.setLanguage); applyStaticText(); renderSettings(); render(); return; }
      const th = e.target.closest("[data-set-theme]");
      if (th) { state.theme = th.dataset.setTheme; store.set("theme", state.theme); applyTheme(); renderSettings(); }
    });
    dlg.addEventListener("change", (e) => {
      const box = e.target.closest("[data-sport]"); if (!box) return;
      const lg = box.dataset.sport;
      if (!box.checked && state.sports.size === 1) { box.checked = true; $("#last-one").hidden = false; return; }
      box.checked ? state.sports.add(lg) : state.sports.delete(lg);
      store.set("sports", [...state.sports]);
      if (state.league !== "all" && !state.sports.has(state.league)) { state.league = "all"; store.set("league", "all"); }
      renderSettings(); render();
    });
  }

  // ---------------------------------------------------------------- shell
  function render() {
    for (const v of VIEWS) $(`#view-${v}`).hidden = v !== state.view;
    document.querySelectorAll(".tabs a").forEach((a) => {
      if (a.dataset.view === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const perLeague = state.view === "stats" || state.view === "matchup";
    const active = perLeague ? statsLeague() : state.league;
    const single = state.sports.size === 1;
    document.querySelectorAll(".chips button[data-league]").forEach((b) => {
      const lg = b.dataset.league;
      b.setAttribute("aria-pressed", String(lg === active || (single && lg === "all")));
      b.hidden = lg === "all" ? (perLeague || single) : (!state.sports.has(lg) || single);
    });
    const mineBtn = $("#mine-only");
    mineBtn.hidden = state.view !== "latest";
    mineBtn.setAttribute("aria-pressed", String(state.mineOnly));
    ({ latest: renderLatest, teams: renderTeams, matchup: renderMatchup, stats: renderStats })[state.view]();
    if (state.updated) $("#updated").textContent = `${freshness()}.`;
    state.firstLoad = false;
  }

  function route() {
    const v = location.hash.replace("#", "");
    if (v.startsWith("game=")) { focusGame(v.slice(5)); return; }
    if (v.startsWith("matchup=")) { openMatchup(v.slice(8)); return; }
    state.view = VIEWS.includes(v) ? v : "latest";
    render();
  }

  function wire() {
    document.querySelector(".chips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-league]"); if (!b) return;
      if ((state.view === "stats" || state.view === "matchup") && b.dataset.league !== "all") { state.statsLeague = b.dataset.league; store.set("statsLeague", state.statsLeague); }
      state.league = b.dataset.league; store.set("league", state.league); render();
    });
    $("#mine-only").addEventListener("click", () => {
      state.mineOnly = !state.mineOnly; store.set("mineOnly", state.mineOnly);
      if (state.mineOnly && !state.mine.size) { location.hash = "#teams"; return; }
      render();
    });
    $("#view-teams").addEventListener("click", async (e) => {
      const tb = e.target.closest("[data-team]");
      if (tb) {
        const k = tb.dataset.team;
        state.mine.has(k) ? state.mine.delete(k) : state.mine.add(k);
        store.set("mine", [...state.mine]);
        const y = window.scrollY; renderTeams(); window.scrollTo(0, y);
        return;
      }
      if (e.target.closest("[data-install]")) { install(); return; }
      if (e.target.closest("[data-goto-alerts]")) { $("#alerts").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      const c = e.target.closest("[data-copy]");
      if (c) {
        try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = t("btn.copied"); }
        catch { prompt(t("copy.prompt"), c.dataset.copy); }
        setTimeout(() => { c.textContent = t("btn.copy"); }, 1500);
      }
    });
    $("#view-stats").addEventListener("click", (e) => {
      const row = e.target.closest("[data-pickteam]"); if (!row) return;
      const lg = row.dataset.league, abbr = row.dataset.pickteam;
      state.mapTeam[lg] = state.mapTeam[lg] === abbr ? "" : abbr;  // clicking the selected team again shows all
      renderStats();
    });
    const mu = $("#view-matchup");
    mu.addEventListener("click", (e) => {
      const lg = statsLeague(), m = matchupFor(lg);
      const q = e.target.closest("[data-mu]");
      if (q) { const [away, home] = q.dataset.mu.split("|"); setMatchup(lg, away, home); return; }
      if (e.target.closest("[data-muswap]")) { setMatchup(lg, m.home, m.away); return; }
      const sp = e.target.closest("[data-musplit]");
      if (sp) { state.muSplit = sp.dataset.musplit === "1"; store.set("muSplit", state.muSplit); renderMatchup(); }
    });
    mu.addEventListener("change", (e) => {
      const s = e.target.closest("[data-muside]"); if (!s) return;
      const lg = statsLeague(), m = { ...matchupFor(lg), [s.dataset.muside]: s.value };
      setMatchup(lg, m.away, m.home);
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
    const showTip = (e) => {
      const r = e.target.closest?.("[data-tip]");
      if (!r) { tip.hidden = true; return false; }
      tip.textContent = r.dataset.tip; tip.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      const y = e.clientY + 16 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 12 : e.clientY + 16;
      tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${y}px`;
      return true;
    };
    document.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") showTip(e); });
    // Touch: tap a dot or bar to see its details; tap elsewhere to hide.
    document.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      clearTimeout(showTip.t);
      if (showTip(e)) showTip.t = setTimeout(() => { tip.hidden = true; }, 3500);
    });
    window.addEventListener("hashchange", route);
    $("#install").addEventListener("click", install);
    $("#view-latest").addEventListener("click", (e) => {
      const b = e.target.closest("[data-share]"); if (b) shareGame(b);
      if (e.target.closest("[data-dismiss-intro]")) { state.introDone = true; store.set("introDone", true); renderLatest(); }
    });
    wireSettings();
  }

  // ---------------------------------------------------------------- share a first score
  const siteUrl = () => (state.config.site_url || location.href.split("#")[0]);
  async function shareGame(btn) {
    const g = state.games.find((x) => `${x.league}:${x.id}` === btn.dataset.share);
    if (!g || !g.first) return;
    const tm = team(g.league, g.first.team);
    const w = winnerOf(g);
    const score = `${Math.max(g.home_score, g.away_score)}–${Math.min(g.home_score, g.away_score)}`;
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = t("card.making");
    try {
      const how = await window.OFShare.share({
        game: g, team: tm, first: g.first, periodText: periodLabel(g.league, g.first.period),
        howText: howText(g.league, g.first.how),
        kicker: t(`share.kicker.${g.league}`, { team: tm.name }),
        assistText: g.first.assists?.length ? t(g.league === "nhl" && g.first.assists.length > 1 ? "card.assist.nhl" : "card.assist", { names: g.first.assists.join(", ") }) : "",
        leagueName: lname(g.league),
        seasonText: g.nth ? t(`card.season.${g.league}`, { nth: ordinal(g.nth) }) : "",
        photo: headshot(g.league, g.first.scorer_id, 700, 510), logo: tm.logo,
        color: hex(tm.color), alt: hex(tm.alt), ink: inkOn(tm.color),
        url: siteUrl(), link: `${siteUrl()}#game=${g.league}-${g.id}`,
        dateText: ymd(g.date).toLocaleDateString(locale(), { weekday: "short", month: "long", day: "numeric" }),
        result: w ? { won: w === g.first.team, text: w === g.first.team ? t("share.won", { score }) : t("share.lost", { team: w }) } : null,
      });
      toast(how === "downloaded" ? t("toast.saved") : how === "shared" ? t("toast.shared") : "");
    } catch (e) { console.error(e); toast(t("toast.fail")); }
    finally { btn.disabled = false; btn.innerHTML = label; }
  }

  function toast(msg) {
    if (!msg) return;
    const el = $("#toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // Deep link: #game=nba-401910036 opens that card (turning its sport back on if needed).
  function focusGame(ref) {
    const [lg, id] = ref.split("-");
    const g = state.games.find((x) => x.league === lg && x.id === id);
    if (!g) return;
    if (!state.sports.has(lg)) { state.sports.add(lg); store.set("sports", [...state.sports]); }
    state.league = "all"; state.mineOnly = false;
    state.day = g.date === localYmd(new Date()) ? "" : g.date;
    state.view = "latest"; render();
    const el = document.getElementById(`g-${lg}-${id}`);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("is-new"); }
  }

  // Deep link: #matchup=nfl-KC-BUF opens that matchup (away first).
  function openMatchup(ref) {
    const [lg, away, home] = ref.split("-");
    if (!ALL_LEAGUES.includes(lg) || !state.teamIdx[teamKey(lg, away)] || !state.teamIdx[teamKey(lg, home)]) { location.hash = "#matchup"; return; }
    if (!state.sports.has(lg)) { state.sports.add(lg); store.set("sports", [...state.sports]); }
    state.statsLeague = lg; store.set("statsLeague", lg);
    if (state.league !== "all") { state.league = lg; store.set("league", lg); }
    state.matchup[lg] = { away, home }; store.set("matchup", state.matchup);
    history.replaceState(null, "", "#matchup");
    state.view = "matchup"; render(); window.scrollTo(0, 0);
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
    catch (e) { console.error(e); if (!state.games.length) $("#status").textContent = t("status.loadFail"); }
  }

  async function init() {
    state.league = store.get("league", "all");
    state.mineOnly = store.get("mineOnly", false);
    state.mine = new Set(store.get("mine", []));
    state.statsLeague = store.get("statsLeague", "nba");
    state.introDone = store.get("introDone", false);
    state.matchup = store.get("matchup", {}) || {};
    state.muSplit = store.get("muSplit", false) === true;
    const sports = store.get("sports", ALL_LEAGUES).filter((lg) => ALL_LEAGUES.includes(lg));
    state.sports = new Set(sports.length ? sports : ALL_LEAGUES);
    state.theme = store.get("theme", "auto");
    if (state.league !== "all" && !state.sports.has(state.league)) state.league = "all";
    applyTheme();
    applyStaticText();
    wire();
    if (!location.hash || location.hash === "#latest") skeleton();
    try { await loadStatic(); } catch (e) { $("#status").textContent = t("status.teamsFail"); return; }
    await refresh();
    if (!state.games.length) $("#view-latest").innerHTML = "";
    for (const g of state.games) if (g.first) state.seen.add(`${g.league}:${g.id}`);
    route();
    setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  init();
})();
