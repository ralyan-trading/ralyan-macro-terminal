/* Rezan Macro Terminal v2 - client app. Static/daily data from DATA (data.json, rebuilt by build.py); live data from keyless CORS APIs.
   Nothing here is invented: if a feed fails the last good value is kept and marked stale, or "n/a" is shown. */
(function () {
"use strict";
const D = DATA, SRC = D.live_sources, INTERVAL = 300000;
const CCYS = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];
const PRIORITY = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"]; // market convention for base currency
const COT_CODES = { XAU: "088691", XAG: "084691", USD: "098662", EUR: "099741", GBP: "096742", JPY: "097741", CHF: "092741", CAD: "090741", AUD: "232741", NZD: "112741" };
const COT_NAMES = { XAU: "GOLD (COMEX)", XAG: "SILVER (COMEX)", USD: "USD INDEX (ICE)", EUR: "EURO FX", GBP: "BRITISH POUND", JPY: "JAPANESE YEN", CHF: "SWISS FRANC", CAD: "CANADIAN DOLLAR", AUD: "AUSTRALIAN DOLLAR", NZD: "NZ DOLLAR" };
const CNBC_SYMS = ["XAU=", "XAG=", "@GC.1", ".DXY", "US3M", "US2Y", "US10Y", "US30Y", "@CL.1", "@LCO.1", ".SPX", ".NDX", ".VIX", "EUR=", "GBP=", "JPY=", "CHF=", "CAD=", "AUD=", "NZD=", "SEK=", "BTC.CB="];
// CNBC FX symbols: EUR=,GBP=,AUD=,NZD= are XXX/USD; JPY=,CHF=,CAD=,SEK= are USD/XXX
const FXMAP = { EUR: ["EUR=", 1], GBP: ["GBP=", 1], AUD: ["AUD=", 1], NZD: ["NZD=", 1], JPY: ["JPY=", 0], CHF: ["CHF=", 0], CAD: ["CAD=", 0], SEK: ["SEK=", 0] };
const KRMAP = { ZEURZUSD: ["EUR", 1], ZGBPZUSD: ["GBP", 1], AUDUSD: ["AUD", 1], ZUSDZJPY: ["JPY", 0], ZUSDZCAD: ["CAD", 0], USDCHF: ["CHF", 0] };

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const hms = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
const hm = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
const fx = (x, d = 2) => (x == null || !isFinite(x) ? "n/a" : Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (x, d = 2) => (x == null || !isFinite(x) ? "n/a" : (x > 0 ? "+" : "") + Number(x).toFixed(d));
const cls = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "fl");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const isoDay = (d) => d.toISOString().slice(0, 10);
const num = (s) => { if (s == null) return null; if (String(s).trim() === "UNCH") return 0; const v = parseFloat(String(s).replace(/[,%+]/g, "")); return isFinite(v) ? v : null; };
const dur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s % 60)}`; };

const st = { gold: null, silver: null, paxg: null, btc: null, q: null, kr: null, tsy: null, xau: { H: null, D: null }, px: { H: null, D: null },
  fx: null, fxLatest: null, cot: null, news: null, feeds: {}, tab: "all",
  chartTf: localStorage.getItem("rezan_tf") || "4H", chartSrc: localStorage.getItem("rezan_src") || "XAU", smcOn: localStorage.getItem("rezan_smc") !== "0", swingLen: +(localStorage.getItem("rezan_sl") || 5),
  last: {}, smc: {} };

/* ------------------------------------------------------------ module registry */
const MODULES = [
  { id: "fund", grp: "DECISION", title: "GOLD FUNDAMENTALS · TODAY", tag: "live", tabs: "gold macro", span: "s2", feeds: ["gold", "quotes", "tsy"] },
  { id: "conf", grp: "DECISION", title: "CONFLUENCE · TECHNICAL + FUNDAMENTAL", tag: "live", tabs: "gold", span: "s2", feeds: ["xauD", "xauH", "gold", "fx", "cot"] },
  { id: "brief", grp: "DECISION", title: "DAILY BRIEF (RULE-BASED)", tag: "live", tabs: "gold fx", span: "s2", feeds: ["gold", "quotes", "fx", "cot"] },
  { id: "score", grp: "DECISION", title: "GOLD SCORECARD · XAU/USD", tag: "live", tabs: "gold", span: "s2", feeds: ["xauD", "fx", "cot", "tsy"] },
  { id: "chart", grp: "CHARTS", title: "GOLD CHART · SMC OVERLAY", tag: "live", tabs: "gold", span: "s4", feeds: ["xauH", "xauD"] },
  { id: "playbook", grp: "DECISION", title: "TRADE PLAYBOOK (EDUCATIONAL)", tag: "live", tabs: "gold fx", span: "s2", feeds: ["fx", "quotes", "cot"] },
  { id: "strength", grp: "FX", title: "CURRENCY STRENGTH · 8 MAJORS", tag: "live", tabs: "fx", span: "s2", feeds: ["quotes", "fx", "cot"] },
  { id: "heatmap", grp: "FX", title: "28-PAIR HEATMAP", tag: "live", tabs: "fx", span: "s2", feeds: ["quotes", "fx", "cot"] },
  { id: "markets", grp: "RATES & MACRO", title: "CROSS-ASSET MONITOR", tag: "live", tabs: "macro gold fx", span: "s2", feeds: ["quotes", "btc"] },
  { id: "cot", grp: "POSITIONING", title: "COT POSITIONING · CFTC NON-COMMERCIAL", tag: "live", tabs: "gold fx flow", span: "s4", feeds: ["cot"] },
  { id: "corr", grp: "FX", title: "INTERMARKET CORRELATION · 60D", tag: "live", tabs: "gold fx", span: "s2", feeds: ["fx", "xauD"] },
  { id: "rates", grp: "RATES & MACRO", title: "YIELDS & POLICY RATES", tag: "live", tabs: "macro gold fx", span: "s2", feeds: ["tsy", "quotes"] },
  { id: "regime", grp: "RATES & MACRO", title: "MACRO REGIME (US)", tag: "daily", tabs: "macro gold", span: "", daily: () => (D.us_actuals ? "BLS " + D.us_actuals.fetched_at : D.us_data.asof) },
  { id: "fed", grp: "RATES & MACRO", title: "FED WATCH", tag: "daily", tabs: "macro gold", span: "", daily: () => D.policy.asof },
  { id: "surprise", grp: "RATES & MACRO", title: "US DATA SURPRISES", tag: "daily", tabs: "macro gold", span: "s2", daily: () => (D.us_actuals ? "BLS " + D.us_actuals.fetched_at : D.us_data.asof) },
  { id: "calendar", grp: "CALENDAR & NEWS", title: "ECONOMIC CALENDAR", tag: "daily", tabs: "macro fx gold", span: "s2", daily: () => "FF " + (D.ff_calendar.fetched_at || "n/a") },
  { id: "news", grp: "CALENDAR & NEWS", title: "NEWS WIRE", tag: "live", tabs: "flow gold fx", span: "s2", feeds: ["news"] },
  { id: "sessions", grp: "CALENDAR & NEWS", title: "SESSION CLOCK", tag: "live", tabs: "fx gold", span: "", clock: true },
  { id: "flows", grp: "POSITIONING", title: "GOLD FLOWS & RISK", tag: "daily", tabs: "gold flow", span: "", daily: () => D.flows.asof },
  { id: "alerts", grp: "TOOLS", title: "ALERTS & SOUND", tag: "live", tabs: "tools", span: "" },
  { id: "feeds", grp: "TOOLS", title: "DATA FEEDS STATUS", tag: "live", tabs: "tools", span: "s2" },
  { id: "rules", grp: "TOOLS", title: "SCORING RULES (TRANSPARENT)", tag: "daily", tabs: "tools gold fx", span: "s2" },
  { id: "na_options", grp: "NOT AVAILABLE", title: "OPTIONS FLOW", tag: "na", tabs: "flow", span: "" },
  { id: "na_retail", grp: "NOT AVAILABLE", title: "RETAIL SENTIMENT", tag: "na", tabs: "flow", span: "" },
  { id: "na_liq", grp: "NOT AVAILABLE", title: "LIQUIDITY MAP", tag: "na", tabs: "flow", span: "" },
  { id: "na_smart", grp: "NOT AVAILABLE", title: "SMART MONEY / DARK POOL", tag: "na", tabs: "flow", span: "" }
];
const TABS = [["all", "ALL"], ["gold", "GOLD"], ["fx", "FX"], ["macro", "MACRO"], ["flow", "FLOW & NEWS"], ["tools", "TOOLS"]];

function setTheme(t) { document.body.classList.toggle("theme-light", t === "light"); try { localStorage.setItem("rezan_theme", t); } catch (e) {} $("themebtn").textContent = t === "light" ? "☾ DARK" : "☀ LIGHT"; }
function buildShell() {
  $("disc").textContent = D.meta.disclaimer;
  $("srcs").innerHTML = "SOURCES: " + D.sources.map((s, i) => `<a href="${esc(s[1])}" target="_blank" rel="noopener">[${i + 1}] ${esc(s[0])}</a>`).join(" ");
  $("tabs").innerHTML = TABS.map(([k, v]) => `<button class="btn ghost sm ${k === "all" ? "on" : ""}" data-tab="${k}">${v}</button>`).join("");
  const groups = [...new Set(MODULES.map((m) => m.grp))];
  $("nav").innerHTML = groups.map((g) => {
    const items = MODULES.filter((m) => m.grp === g);
    return `<div class="grp"><div class="gh"><span><span class="car">▾</span> ${esc(g)}</span><span>${items.length}</span></div><div class="items">` +
      items.map((m) => `<a class="it" href="#m_${m.id}" data-id="${m.id}"><span>${esc(m.title.split(" · ")[0].replace(" (RULE-BASED)", "").replace(" (EDUCATIONAL)", "").replace(" (TRANSPARENT)", ""))}</span><span class="tag ${m.tag}">${m.tag === "na" ? "N/A" : m.tag.toUpperCase()}</span></a>`).join("") + "</div></div>";
  }).join("");
  $("grid").innerHTML = MODULES.map((m, i) => `<section class="card ${m.span}" id="m_${m.id}" data-tabs="${m.tabs}"><div class="ch"><span class="num0">${pad(i + 1)}</span><span class="ttl">${esc(m.title)}</span><span class="r"><span class="fr" id="f_${m.id}"></span><span class="tag ${m.tag}">${m.tag === "na" ? "N/A" : m.tag === "live" ? "LIVE" : "DAILY"}</span></span></div><div class="cb" id="b_${m.id}"><span class="dim">Loading...</span></div></section>`).join("");
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; st.tab = b.dataset.tab;
    [...$("tabs").children].forEach((x) => x.classList.toggle("on", x === b)); applyTab(); });
  $("nav").addEventListener("click", (e) => {
    const gh = e.target.closest(".gh"); if (gh) { gh.parentElement.classList.toggle("closed"); return; }
    const it = e.target.closest(".it"); if (!it) return; e.preventDefault();
    const card = $("m_" + it.dataset.id); card.classList.remove("hide");
    document.querySelectorAll(".it").forEach((x) => x.classList.toggle("act", x === it));
    card.scrollIntoView({ behavior: "smooth", block: "start" }); card.classList.add("flash"); setTimeout(() => card.classList.remove("flash"), 1200);
    if (window.innerWidth <= 760) document.body.classList.remove("side-on");
  });
  $("filter").addEventListener("input", () => { const q = $("filter").value.trim().toLowerCase();
    document.querySelectorAll(".it").forEach((it) => { it.style.display = !q || it.textContent.toLowerCase().includes(q) ? "" : "none"; });
    document.querySelectorAll(".grp").forEach((g) => { const any = [...g.querySelectorAll(".it")].some((i) => i.style.display !== "none"); g.style.display = any ? "" : "none"; if (q) g.classList.remove("closed"); });
  });
  $("burger").addEventListener("click", () => { if (window.innerWidth <= 760) document.body.classList.toggle("side-on"); else document.body.classList.toggle("side-off"); });
  $("refbtn").addEventListener("click", () => { refresh(true); schedule(); });
  $("themebtn").addEventListener("click", () => setTheme(document.body.classList.contains("theme-light") ? "dark" : "light"));
  setTheme(localStorage.getItem("rezan_theme") || "dark");
  // build-age banner: daily file older than 3 days
  const b = D.meta.built_at ? (Date.now() - Date.parse(D.meta.built_at)) / 864e5 : null;
  if (b != null && b > 3) { $("banner").innerHTML = `⚠ Daily data file is ${Math.floor(b)} days old (built ${esc(D.meta.built_at)}). Live feeds still update; run build.py to refresh yields/calendar/BLS.`; $("banner").style.display = "block"; }
}
function applyTab() { document.querySelectorAll(".card").forEach((c) => c.classList.toggle("hide", st.tab !== "all" && !c.dataset.tabs.split(" ").includes(st.tab))); }

/* ------------------------------------------------------------ fetch helpers */
async function getRaw(url, ms = 15000, asText = false) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); return asText ? await r.text() : await r.json(); }
  catch (e) { throw new Error(e.name === "AbortError" ? "timeout " + ms / 1000 + "s" : e.message); }
  finally { clearTimeout(t); }
}
const getJSON = (u, ms) => getRaw(u, ms, false);
function feed(key, label, ok, info) { const p = st.feeds[key] || {}; st.feeds[key] = { label, ok, info: info || "", at: new Date(), okAt: ok ? new Date() : p.okAt || null }; }

async function fGold() { const j = await getJSON(SRC.gold); if (!(j.price > 0)) throw new Error("bad price"); st.gold = { px: +j.price, at: j.updatedAt }; return "updated " + (j.updatedAtReadable || j.updatedAt || ""); }
async function fSilver() { const j = await getJSON(SRC.silver); if (!(j.price > 0)) throw new Error("bad price"); st.silver = { px: +j.price, at: j.updatedAt }; }
async function fPaxg() { const j = await getJSON(SRC.paxg_spot); const p = +j.data.amount; if (!(p > 0)) throw new Error("bad price"); st.paxg = p; }
async function fBtc() { const j = await getJSON(SRC.btc); const p = +j.price; if (!(p > 0)) throw new Error("bad price"); st.btc = { px: p, at: j.time }; }
async function fQuotes() {
  const u = SRC.cnbc_quote + "?symbols=" + encodeURIComponent(CNBC_SYMS.join("|")) + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1";
  const j = await getJSON(u); const arr = j && j.FormattedQuoteResult && j.FormattedQuoteResult.FormattedQuote;
  if (!Array.isArray(arr) || !arr.length) throw new Error("empty");
  const q = {}; arr.forEach((x) => { const last = num(x.last); if (last == null) return;
    const ch = num(x.change), chp = num(x.change_pct); q[x.symbol] = { last, ch, chp, prev: ch != null ? last - ch : null, time: x.last_time, name: x.name, status: x.curmktstatus }; });
  if (!q["XAU="] && !q[".DXY"]) throw new Error("no core symbols"); st.q = q; return `${Object.keys(q).length}/${CNBC_SYMS.length} symbols · unofficial feed`;
}
async function fKraken() {
  const j = await getJSON(SRC.kraken + "?pair=EURUSD,GBPUSD,USDJPY,USDCAD,AUDUSD,USDCHF"); if (j.error && j.error.length) throw new Error(j.error.join(","));
  const out = {}; Object.entries(j.result || {}).forEach(([k, v]) => { const m = KRMAP[k]; if (!m) return; const mid = (+v.a[0] + +v.b[0]) / 2, o = +v.o;
    out[m[0]] = { v: m[1] ? 1 / mid : mid, p: o > 0 ? (m[1] ? 1 / o : o) : null }; });
  if (Object.keys(out).length < 4) throw new Error("few pairs"); st.kr = { r: out, at: new Date() }; return Object.keys(out).length + " pairs intraday (no NZD)";
}
const pxBars = (j) => ((j && j.barData && j.barData.priceBars) || []).map((b) => ({ t: +b.tradeTimeinMills, o: +b.open, h: +b.high, l: +b.low, c: +b.close })).filter((b) => b.t && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0).sort((a, b) => a.t - b.t);
function agg(C, hours) { if (!C) return null; const out = [], ms = hours * 3600e3; let cur = null;
  C.forEach((k) => { const b = Math.floor(k.t / ms) * ms; if (!cur || cur.t !== b) { cur && out.push(cur); cur = { t: b, o: k.o, h: k.h, l: k.l, c: k.c }; } else { cur.h = Math.max(cur.h, k.h); cur.l = Math.min(cur.l, k.l); cur.c = k.c; } });
  cur && out.push(cur); return out; }
const cnbcTs = (d) => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "00";
async function fXauH() { // 1H bars for ~60 days (zero-range weekend/closed ticks dropped); fallback: 5-day 5-min bars aggregated
  try { const u = `${SRC.cnbc_chart.replace("/charts/", "/bars/")}XAU=/1H/${cnbcTs(new Date(Date.now() - 60 * 864e5))}/${cnbcTs(new Date(Date.now() + 864e5))}/adjusted/UTC.json`;
    const C = pxBars(await getJSON(u)).filter((k) => k.h > k.l); if (C.length < 100) throw new Error("few 1H bars"); st.xau.H = C; return `${C.length} H1 bars (~60 days)`; }
  catch (e) { const C = pxBars(await getJSON(SRC.cnbc_chart + "5D.json?symbol=XAU=")).filter((k) => k.h > k.l); if (C.length < 50) throw new Error("few bars"); st.xau.H = agg(C, 1); return `${st.xau.H.length} H1 bars from 5-day 5-min data (1H history failed: ${e.message})`; } }
async function fXauD() { const C = pxBars(await getJSON(SRC.cnbc_chart + "1Y.json?symbol=XAU=")).filter((k) => k.h > k.l); if (C.length < 60) throw new Error("few bars"); st.xau.D = C; st.last.xauD = Date.now(); return `${C.length} daily bars`; }
async function coinbase(gran, start, end) { const q = "?granularity=" + gran + (start ? `&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}` : "");
  const j = await getJSON(SRC.paxg_candles + q); if (!Array.isArray(j)) throw new Error("bad candles"); return j.map((r) => ({ t: r[0] * 1000, l: r[1], h: r[2], o: r[3], c: r[4] })); }
async function fPxH() { const now = Date.now(), h = 3600e3; const [a, b] = await Promise.all([coinbase(3600, now - 300 * h, now), coinbase(3600, now - 600 * h, now - 300 * h)]);
  const m = new Map(); [...b, ...a].forEach((k) => m.set(k.t, k)); st.px.H = [...m.values()].sort((x, y) => x.t - y.t); if (st.px.H.length < 50) throw new Error("few bars"); return st.px.H.length + " H1 bars (2 pages)"; }
async function fPxD() { st.px.D = (await coinbase(86400)).sort((a, b) => a.t - b.t); if (st.px.D.length < 50) throw new Error("few bars"); }
async function fFX() {
  const start = isoDay(new Date(Date.now() - 400 * 864e5));
  try {
    const j = await getJSON(`${SRC.fx_series}${start}..?base=USD&symbols=EUR,GBP,JPY,CHF,CAD,AUD,NZD,SEK,CNY`);
    const dates = Object.keys(j.rates).sort(); if (dates.length < 30) throw new Error("short series");
    st.fx = { dates, r: dates.map((d) => Object.assign({ USD: 1 }, j.rates[d])), src: "ECB reference rates (Frankfurter)" };
    st.last.fx = Date.now(); return "ECB series to " + dates[dates.length - 1];
  } catch (e) {
    const j = await getJSON(SRC.fx_fallback); st.fxLatest = Object.assign({ USD: 1 }, j.rates); return "fallback latest only (open.er-api)";
  }
}
async function fCOT() {
  const since = isoDay(new Date(Date.now() - 380 * 864e5));
  const codes = Object.values(COT_CODES).map((c) => `'${c}'`).join(",");
  const p = new URLSearchParams({
    "$select": "cftc_contract_market_code,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all,change_in_noncomm_long_all,change_in_noncomm_short_all,open_interest_all",
    "$where": `cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd >= '${since}T00:00:00.000'`,
    "$order": "report_date_as_yyyy_mm_dd ASC", "$limit": "2000" });
  const rows = await getJSON(SRC.cot + "?" + p.toString(), 20000);
  if (!Array.isArray(rows) || !rows.length) throw new Error("no COT rows");
  st.cot = rows; st.last.cot = Date.now(); return "report " + rows[rows.length - 1].report_date_as_yyyy_mm_dd.slice(0, 10);
}
async function fNews() { const j = await getJSON(SRC.news); if (j.status !== "ok") throw new Error("rss " + j.status); st.news = j.items || []; }
function tsyParse(xml, keys) { const out = []; (xml.match(/<m:properties>[\s\S]*?<\/m:properties>/g) || []).forEach((e) => { const r = {}; (e.match(/<d:\w+[^>]*>[^<]*</g) || []).forEach((f) => { const m = f.match(/<d:(\w+)[^>]*>([^<]*)</); r[m[1]] = m[2]; });
  if (r.NEW_DATE) out.push(r); }); return out.sort((a, b) => (a.NEW_DATE < b.NEW_DATE ? -1 : 1)); }
async function fTsy() {
  const now = new Date(), ym = (d) => d.getUTCFullYear() + pad(d.getUTCMonth() + 1), prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const one = async (kind, m) => tsyParse(await getRaw(`${SRC.treasury}?data=${kind}&field_tdr_date_value_month=${m}`, 45000, true));
  let [nom, real] = await Promise.all([one("daily_treasury_yield_curve", ym(now)), one("daily_treasury_real_yield_curve", ym(now))]);
  if (nom.length < 8 || real.length < 8) { const [n2, r2] = await Promise.all([one("daily_treasury_yield_curve", ym(prev)), one("daily_treasury_real_yield_curve", ym(prev))]); nom = n2.concat(nom); real = r2.concat(real); }
  if (nom.length < 6) throw new Error("few rows");
  const wk = (pts) => { const d0 = Date.parse(pts[pts.length - 1][0]) - 7 * 864e5; const ref = pts.filter((p) => Date.parse(p[0]) <= d0); return ref.length ? Math.round((pts[pts.length - 1][1] - ref[ref.length - 1][1]) * 100) : null; };
  const ser = (rows, k) => rows.filter((r) => r[k]).map((r) => [r.NEW_DATE.slice(0, 10), +r[k]]);
  const row = (name, rows, k) => { const p = ser(rows, k); return { name, value: p[p.length - 1][1], chg_bp: wk(p) }; };
  const rm = Object.fromEntries(ser(real, "TC_10YEAR")); const be = ser(nom, "BC_10YEAR").filter((p) => rm[p[0]] != null).map((p) => [p[0], +(p[1] - rm[p[0]]).toFixed(2)]);
  const rows = [row("US 3M", nom, "BC_3MONTH"), row("US 2Y", nom, "BC_2YEAR"), row("US 10Y", nom, "BC_10YEAR"), row("US 30Y", nom, "BC_30YEAR"), row("US 10Y real (TIPS)", real, "TC_10YEAR"), { name: "US 10Y breakeven", value: be[be.length - 1][1], chg_bp: wk(be) }];
  const asof = nom[nom.length - 1].NEW_DATE.slice(0, 10); st.tsy = { rows, asof }; st.last.tsy = Date.now(); return "curve as of " + asof;
}
const ratesNow = () => (st.tsy ? { rows: st.tsy.rows, asof: st.tsy.asof + " close", source: "U.S. Treasury yield curve XML (fetched live)" } : D.us_rates);
const goldPx = () => (st.gold ? { px: st.gold.px, src: "gold-api.com" } : st.q && st.q["XAU="] ? { px: st.q["XAU="].last, src: "CNBC XAU=" } : null);
const goldRef = () => (st.q && st.q["XAU="] && st.q["XAU="].prev ? { v: st.q["XAU="].prev, lbl: "prev close" } : { v: D.gold_static.fri_close, lbl: "Fri close" });

/* ------------------------------------------------------------ live FX rates (USD base: units of CCY per 1 USD) */
function liveFX() {
  const r = { USD: 1 }, p = { USD: 1 }; let src = null, n = 0;
  if (st.q) { Object.entries(FXMAP).forEach(([c, [s, inv]]) => { const x = st.q[s]; if (!x) return; r[c] = inv ? 1 / x.last : x.last; if (x.prev) p[c] = inv ? 1 / x.prev : x.prev; n++; }); if (n) src = "CNBC quotes"; }
  if (st.kr) Object.entries(st.kr.r).forEach(([c, v]) => { if (r[c] == null) { r[c] = v.v; if (v.p) p[c] = v.p; src = src ? src + " + Kraken" : "Kraken"; } });
  const lastFix = st.fx ? st.fx.r[st.fx.r.length - 1] : st.fxLatest; let filled = [];
  ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "SEK"].forEach((c) => { if (r[c] == null && lastFix && lastFix[c]) { r[c] = lastFix[c]; p[c] = lastFix[c]; filled.push(c); } });
  if (!src) return null; return { r, p, src: src + (filled.length ? ` (${filled.join(",")} from last ECB fix)` : ""), filled };
}
function fxSeries() { // ECB daily fixes + one live point appended (if available)
  const L = liveFX(); if (!st.fx) return null; const r = st.fx.r.slice(), dates = st.fx.dates.slice();
  if (L) { r.push(Object.assign({}, r[r.length - 1], L.r)); dates.push("live"); }
  return { r, dates, live: !!L, src: st.fx.src + (L ? " + live point (" + L.src + ")" : "") };
}

/* ------------------------------------------------------------ analytics */
const sma = (arr, n) => (arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null);
function dxyOf(r) { if (!r || !r.EUR || !r.SEK) return null;
  return 50.14348112 * Math.pow(1 / r.EUR, -0.576) * Math.pow(r.JPY, 0.136) * Math.pow(1 / r.GBP, -0.119) * Math.pow(r.CAD, 0.091) * Math.pow(r.SEK, 0.042) * Math.pow(r.CHF, 0.036); }
function strengthIdx(r, c) { let s = 0; CCYS.forEach((o) => { if (o !== c) s += Math.log(r[o]) - Math.log(r[c]); }); return s / 7; }
function cotStats() {
  if (!st.cot) return null; const out = {};
  Object.entries(COT_CODES).forEach(([k, code]) => {
    const rows = st.cot.filter((r) => r.cftc_contract_market_code === code); if (!rows.length) return;
    const nets = rows.map((r) => +r.noncomm_positions_long_all - +r.noncomm_positions_short_all);
    const last = rows[rows.length - 1], L = +last.noncomm_positions_long_all, S = +last.noncomm_positions_short_all, net = L - S;
    const win = nets.slice(-52); const pct = (win.filter((x) => x <= net).length / win.length) * 100;
    const chg = (+last.change_in_noncomm_long_all || 0) - (+last.change_in_noncomm_short_all || 0);
    let flag = "NEUTRAL"; if (pct >= 90) flag = "EXTREME LONG"; else if (pct >= 80) flag = "CROWDED LONG"; else if (pct <= 10) flag = "EXTREME SHORT"; else if (pct <= 20) flag = "CROWDED SHORT";
    out[k] = { net, L, S, pctLong: (L / (L + S)) * 100, chg, pct, flag, n: win.length, date: last.report_date_as_yyyy_mm_dd.slice(0, 10), oi: +last.open_interest_all, hist: win };
  });
  return out;
}
const goldDaily = () => (st.xau.D ? { C: st.xau.D, src: "XAU spot (CNBC)" } : st.px.D ? { C: st.px.D, src: "PAXG (Coinbase)" } : null);

const GOLD_RULES = [
  { k: "trend", name: "Technical trend", src: "LIVE", max: 2, rule: "Gold daily close (XAU spot; PAXG fallback) vs SMA20: above +1 / below -1; vs SMA50: above +1 / below -1." },
  { k: "usd", name: "US dollar (DXY proxy)", src: "LIVE", max: 2, rule: "DXY proxy (ICE formula on ECB fixes + live quote) change over 20 fixes: < -1% +2, < -0.25% +1, > +1% -2, > +0.25% -1, else 0." },
  { k: "real", name: "Real yields", src: "LIVE", max: 2, rule: "10Y TIPS (Treasury real curve) level > 2.5% -1, < 1.5% +1; weekly change <= -10bp +1, >= +10bp -1." },
  { k: "fed", name: "Fed policy", src: "DAILY", max: 2, rule: "Last move hike -1 / cut +1; next-meeting OR December hike probability > 50% -1." },
  { k: "infl", name: "Inflation surprise", src: "DAILY", max: 2, rule: "Headline & core CPI y/y vs forecast: each beat -1 (hawkish), each miss +1. n/a if forecast unknown." },
  { k: "growth", name: "Growth / jobs surprise", src: "DAILY", max: 2, rule: "NFP vs forecast: miss +1 / beat -1; unemployment vs forecast: higher +1 / lower -1." },
  { k: "pos", name: "Positioning (COT)", src: "LIVE", max: 2, rule: "Non-commercial net 52-week percentile >= 80 -1 (crowded), <= 20 +1; weekly net change > 0 +1, < 0 -1." },
  { k: "flows", name: "Physical flows", src: "DAILY", max: 2, rule: "Latest monthly global gold ETF flow > 0 +1 (< 0 -1); latest central-bank net buying > 0 +1 (< 0 -1)." },
  { k: "risk", name: "Risk sentiment", src: "DAILY", max: 1, rule: "US high-yield spread weekly change >= +5bp +1 (risk-off), <= -5bp -1." }
];
function goldScore() {
  const res = []; const add = (k, score, input) => { const r = GOLD_RULES.find((x) => x.k === k); res.push(Object.assign({}, r, { score, input, na: score == null })); };
  const gd = goldDaily();
  if (gd && gd.C.length >= 50) { const c = gd.C.map((x) => x.c); const gp = goldPx(); if (gp && st.xau.D) c[c.length - 1] = gp.px; const last = c[c.length - 1], s20 = sma(c, 20), s50 = sma(c, 50);
    add("trend", (last > s20 ? 1 : -1) + (last > s50 ? 1 : -1), `${gd.src} ${fx(last)} · SMA20 ${fx(s20)} · SMA50 ${fx(s50)}`); } else add("trend", null, "candles unavailable");
  const S = fxSeries();
  if (S && S.r.length > 21) { const a = dxyOf(S.r[S.r.length - 21]), b = dxyOf(S.r[S.r.length - 1]), ch = (b / a - 1) * 100;
    add("usd", ch < -1 ? 2 : ch < -0.25 ? 1 : ch > 1 ? -2 : ch > 0.25 ? -1 : 0, `DXY proxy ${fx(b)} · 20-fix ${sgn(ch)}%`); } else add("usd", null, "FX series unavailable");
  const RN = ratesNow(); const real = RN.rows.find((r) => /real/i.test(r.name));
  if (real && real.chg_bp != null) add("real", (real.value > 2.5 ? -1 : real.value < 1.5 ? 1 : 0) + (real.chg_bp <= -10 ? 1 : real.chg_bp >= 10 ? -1 : 0), `10Y real ${real.value}% · ${sgn(real.chg_bp, 0)}bp w/w (${RN.asof})`); else add("real", null, "n/a");
  const f = D.fed; const pHike = Math.max(f.next_hike_prob || 0, f.dec_hike_prob || 0);
  add("fed", (f.last_move_dir > 0 ? -1 : f.last_move_dir < 0 ? 1 : 0) + (pHike > 50 ? -1 : 0), `Last move ${f.last_move_dir > 0 ? "hike" : f.last_move_dir < 0 ? "cut" : "hold"} · Oct hike ${f.next_hike_prob}% · Dec hike ${f.dec_hike_prob}%`);
  const row = (n) => D.us_data.rows.find((r) => r.name.startsWith(n));
  const cpi = row("CPI y/y"), core = row("Core CPI y/y"); const sv = (r) => (r.actual > r.forecast ? -1 : r.actual < r.forecast ? 1 : 0);
  if (cpi && core && cpi.forecast != null && core.forecast != null) add("infl", sv(cpi) + sv(core), `CPI ${cpi.actual} vs ${cpi.forecast} · core ${core.actual} vs ${core.forecast}`); else add("infl", null, "forecast n/a");
  const nfp = row("Nonfarm"), ur = row("Unemployment");
  if (nfp && ur && nfp.forecast != null && ur.forecast != null) add("growth", (nfp.actual < nfp.forecast ? 1 : nfp.actual > nfp.forecast ? -1 : 0) + (ur.actual > ur.forecast ? 1 : ur.actual < ur.forecast ? -1 : 0), `NFP ${nfp.actual}k vs ${nfp.forecast}k · UR ${ur.actual}% vs ${ur.forecast}%`); else add("growth", null, "forecast n/a");
  const cs = cotStats(); const g = cs && cs.XAU;
  if (g) add("pos", (g.pct >= 80 ? -1 : g.pct <= 20 ? 1 : 0) + (g.chg > 0 ? 1 : g.chg < 0 ? -1 : 0), `Net ${fx(g.net, 0)} · ${fx(g.pct, 0)}th pct · w/w ${sgn(g.chg, 0)} (${g.date})`); else add("pos", null, "COT unavailable");
  const fl = D.flows; add("flows", (fl.etf_month_usd_bn > 0 ? 1 : fl.etf_month_usd_bn < 0 ? -1 : 0) + (fl.cb_net_t > 0 ? 1 : fl.cb_net_t < 0 ? -1 : 0), `ETF ${fl.etf_month} ${sgn(fl.etf_month_usd_bn, 0)}bn · CB ${fl.cb_month} ${sgn(fl.cb_net_t, 0)}t`);
  const rk = D.risk; add("risk", rk.hy_chg_bp >= 5 ? 1 : rk.hy_chg_bp <= -5 ? -1 : 0, `HY spread ${rk.hy_spread_bp}bp · ${sgn(rk.hy_chg_bp, 0)}bp w/w (${rk.asof})`);
  const valid = res.filter((r) => !r.na); const total = valid.reduce((a, r) => a + r.score, 0), max = valid.reduce((a, r) => a + r.max, 0);
  return { rows: res, total, max, pct: max ? total / max : 0 };
}
function verdict(p) { return p >= 0.35 ? ["BULLISH", "up"] : p >= 0.12 ? ["LEAN BULLISH", "up"] : p <= -0.35 ? ["BEARISH", "dn"] : p <= -0.12 ? ["LEAN BEARISH", "dn"] : ["NEUTRAL", "fl"]; }

const CCY_RULES = [
  { k: "t20", name: "Trend 20d", max: 2, src: "LIVE", rule: "Change of the currency's equal-weight index vs the other 7 over the last 20 ECB fixes to the live quote: > +1% +2, > +0.3% +1, < -1% -2, < -0.3% -1." },
  { k: "t5", name: "Trend 5d", max: 1, src: "LIVE", rule: "Same index over 5 fixes: > +0.3% +1, < -0.3% -1." },
  { k: "t1", name: "Intraday", max: 1, src: "LIVE", rule: "Index change vs previous close from live quotes (CNBC; Kraken fallback): > +0.25% +1, < -0.25% -1. n/a without live quotes." },
  { k: "cot", name: "COT", max: 2, src: "LIVE", rule: "Non-commercial net (USD: ICE USD index) > 0 +1 else -1; weekly net change > 0 +1, < 0 -1." },
  { k: "rate", name: "Policy rate", max: 2, src: "DAILY", rule: "Rate above the 8-bank median +1 / below -1; last move hike +1 / cut -1." }
];
const CCY_MAX = CCY_RULES.reduce((a, r) => a + r.max, 0);
function ccyScores() {
  const cs = cotStats(); const banks = D.policy.banks; const rates = banks.map((b) => b.rate).sort((a, b) => a - b); const med = (rates[3] + rates[4]) / 2;
  const S = fxSeries(), L = liveFX(); const out = {};
  CCYS.forEach((c) => {
    const comp = {}; let ch20 = null, ch5 = null, ch1 = null;
    if (S && S.r.length > 21) { const R = S.r, n = R.length; const now = strengthIdx(R[n - 1], c);
      ch20 = (now - strengthIdx(R[n - 21], c)) * 100; ch5 = (now - strengthIdx(R[n - 6], c)) * 100;
      comp.t20 = ch20 > 1 ? 2 : ch20 > 0.3 ? 1 : ch20 < -1 ? -2 : ch20 < -0.3 ? -1 : 0; comp.t5 = ch5 > 0.3 ? 1 : ch5 < -0.3 ? -1 : 0; }
    if (L && !L.filled.length) { ch1 = (strengthIdx(L.r, c) - strengthIdx(L.p, c)) * 100; comp.t1 = ch1 > 0.25 ? 1 : ch1 < -0.25 ? -1 : 0; }
    const k = cs && cs[c]; if (k) comp.cot = (k.net > 0 ? 1 : -1) + (k.chg > 0 ? 1 : k.chg < 0 ? -1 : 0);
    const b = banks.find((x) => x.ccy === c); if (b) comp.rate = (b.rate > med ? 1 : b.rate < med ? -1 : 0) + (b.last_dir || 0);
    const total = Object.values(comp).reduce((a, v) => a + v, 0);
    out[c] = { comp, total, ch20, ch5, ch1, cot: k, bank: b };
  });
  out._src = S ? S.src : "n/a"; return out;
}
function pairs(sc) {
  const list = [];
  for (let i = 0; i < PRIORITY.length; i++) for (let j = i + 1; j < PRIORITY.length; j++) { const b = PRIORITY[i], q = PRIORITY[j]; list.push({ pair: b + "/" + q, b, q, score: sc[b].total - sc[q].total }); }
  return list.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}
const pairLabel = (s) => { const a = Math.abs(s), d = s > 0 ? "BUY" : "SELL"; return a >= 6 ? "STRONG " + d : a >= 3 ? d : a >= 1 ? "WEAK " + d : "NEUTRAL"; };
function corr(a, b) { const n = a.length; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); }

/* ------------------------------------------------------------ SMC engine (same logic as SMC_Elliott_Structure.mq5) */
function atr(C, n = 14) { let s = 0, c = 0; for (let i = Math.max(1, C.length - n); i < C.length; i++) { s += Math.max(C[i].h - C[i].l, Math.abs(C[i].h - C[i - 1].c), Math.abs(C[i].l - C[i - 1].c)); c++; } return c ? s / c : 0; }
function smc(C, L, wickBreak) {
  const n = C.length, H = C.map((x) => x.h), Lo = C.map((x) => x.l), Cl = C.map((x) => x.c), O = C.map((x) => x.o);
  const tol = atr(C) * 0.1; // equal-high/low tolerance = 10% of ATR(14) (MT5: InpEqTolerance points)
  const swings = [], breaks = [], obs = [], fvgs = [], eqs = [], legs = [], highs = [], lows = [];
  let trend = 0, sh = null, sl = null;
  for (let k = 0; k < n; k++) {
    // fills / mitigation / sweeps from this bar
    fvgs.forEach((f) => { if (f.filled || k <= f.i + 1) return; if (f.dir > 0 && Lo[k] <= f.bot) { f.filled = true; f.fi = k; } if (f.dir < 0 && H[k] >= f.top) { f.filled = true; f.fi = k; } });
    obs.forEach((o) => { if (o.mit || k <= o.k) return; if (o.dir > 0 && Cl[k] < o.bot) { o.mit = true; o.mi = k; } if (o.dir < 0 && Cl[k] > o.top) { o.mit = true; o.mi = k; } });
    eqs.forEach((e) => { if (e.end != null || k <= e.k) return;
      if (e.t === "H" && H[k] > e.p) { e.end = k; e.swept = Cl[k] < e.p; } if (e.t === "L" && Lo[k] < e.p) { e.end = k; e.swept = Cl[k] > e.p; } });
    // FVG (3-candle imbalance, middle candle k-1)
    if (k >= 2) { if (Lo[k] > H[k - 2]) fvgs.push({ i: k - 1, top: Lo[k], bot: H[k - 2], dir: 1, filled: false }); if (H[k] < Lo[k - 2]) fvgs.push({ i: k - 1, top: Lo[k - 2], bot: H[k], dir: -1, filled: false }); }
    // swing confirmed at k for pivot i = k - L
    const i = k - L;
    if (i >= L) {
      let isH = true, isL = true;
      for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (j < i) { if (H[j] >= H[i]) isH = false; if (Lo[j] <= Lo[i]) isL = false; } else { if (H[j] > H[i]) isH = false; if (Lo[j] < Lo[i]) isL = false; } }
      if (isH) { const prev = highs[highs.length - 1]; const s = { i, k, p: H[i], t: "H", lab: prev ? (H[i] > prev.p ? "HH" : "LH") : "H" }; swings.push(s);
        highs.slice(-5).forEach((o) => { if (Math.abs(o.p - s.p) <= tol) { let mx = -Infinity; for (let j = o.i + 1; j < i; j++) mx = Math.max(mx, H[j]); if (mx <= Math.max(o.p, s.p)) eqs.push({ i1: o.i, i2: i, k, p: Math.max(o.p, s.p), t: "H", end: null }); } });
        highs.push(s); sh = Object.assign({ broken: false }, s); }
      if (isL) { const prev = lows[lows.length - 1]; const s = { i, k, p: Lo[i], t: "L", lab: prev ? (Lo[i] > prev.p ? "HL" : "LL") : "L" }; swings.push(s);
        lows.slice(-5).forEach((o) => { if (Math.abs(o.p - s.p) <= tol) { let mn = Infinity; for (let j = o.i + 1; j < i; j++) mn = Math.min(mn, Lo[j]); if (mn >= Math.min(o.p, s.p)) eqs.push({ i1: o.i, i2: i, k, p: Math.min(o.p, s.p), t: "L", end: null }); } });
        lows.push(s); sl = Object.assign({ broken: false }, s); }
    }
    // structure breaks of the latest unbroken swing
    const up = wickBreak ? H[k] : Cl[k], dn = wickBreak ? Lo[k] : Cl[k];
    if (sh && !sh.broken && k > sh.i && up > sh.p) { sh.broken = true; const kind = trend < 0 ? "CHoCH" : "BOS"; trend = 1; breaks.push({ i0: sh.i, k, p: sh.p, dir: 1, kind });
      let m = sh.i; for (let j = sh.i; j <= k; j++) if (Lo[j] < Lo[m]) m = j;
      for (let j = m; j >= Math.max(0, m - 3 * L); j--) if (Cl[j] < O[j]) { obs.push({ i: j, k, top: H[j], bot: Lo[j], dir: 1, mit: false }); break; }
      legs.push({ dir: 1, a: m, k }); }
    if (sl && !sl.broken && k > sl.i && dn < sl.p) { sl.broken = true; const kind = trend > 0 ? "CHoCH" : "BOS"; trend = -1; breaks.push({ i0: sl.i, k, p: sl.p, dir: -1, kind });
      let m = sl.i; for (let j = sl.i; j <= k; j++) if (H[j] > H[m]) m = j;
      for (let j = m; j >= Math.max(0, m - 3 * L); j--) if (Cl[j] > O[j]) { obs.push({ i: j, k, top: H[j], bot: Lo[j], dir: -1, mit: false }); break; }
      legs.push({ dir: -1, a: m, k }); }
  }
  // Fib on the latest leg: anchor at leg start -> extreme since then
  let fib = null; const leg = legs[legs.length - 1];
  if (leg) { let e = leg.a; for (let j = leg.a; j < n; j++) { if (leg.dir > 0 ? H[j] > H[e] : Lo[j] < Lo[e]) e = j; }
    const lo = leg.dir > 0 ? Lo[leg.a] : Lo[e], hi = leg.dir > 0 ? H[e] : H[leg.a], R = hi - lo;
    const lv = (f) => (leg.dir > 0 ? hi - f * R : lo + f * R);
    fib = { dir: leg.dir, a: leg.a, e, lo, hi, levels: [0, 0.5, 0.618, 0.705, 0.786, 1].map((f) => ({ f, p: lv(f) })), ext: leg.dir > 0 ? lo + 1.618 * R : hi - 1.618 * R }; }
  // bias: structure (last break BOS +-2 / CHoCH +-1) + location vs 50% of the latest leg (discount for longs / premium for shorts +-1)
  const lb = breaks[breaks.length - 1], last = Cl[n - 1]; let bias = 0, loc = "n/a", inOTE = false;
  if (lb) bias += lb.dir * (lb.kind === "BOS" ? 2 : 1);
  if (fib) { const eq = fib.levels[1].p, o1 = fib.levels[2].p, o2 = fib.levels[4].p;
    inOTE = last <= Math.max(o1, o2) && last >= Math.min(o1, o2);
    if (fib.dir > 0) { loc = last < eq ? "DISCOUNT" : "PREMIUM"; if (lb && lb.dir > 0 && last < eq) bias += 1; }
    else { loc = last > eq ? "PREMIUM" : "DISCOUNT"; if (lb && lb.dir < 0 && last > eq) bias -= 1; } }
  return { swings, breaks, obs, fvgs, eqs, fib, trend, lb, bias, loc, inOTE, last, tol, n };
}
const candlesFor = (src, tf) => { const S = src === "XAU" ? st.xau : st.px; if (tf === "1D") return S.D; if (tf === "1H") return S.H; return agg(S.H, 4); };

/* ------------------------------------------------------------ events / calendar helpers */
function allEvents() {
  const ff = (D.ff_calendar.events || []).map((e) => ({ t: Date.parse(e.date), ccy: e.country, title: e.title, imp: e.impact, fc: e.forecast, prev: e.previous, actual: e.actual, src: "FF" })).filter((e) => isFinite(e.t));
  const ffMax = ff.length ? Math.max(...ff.map((e) => e.t)) : 0;
  const cur = D.curated_calendar.filter((e) => e.at && Date.parse(e.at) > ffMax).map((e) => ({ t: Date.parse(e.at), ccy: e.ccy, title: e.ev, imp: e.imp, src: "curated" }));
  return ff.concat(cur).sort((a, b) => a.t - b.t);
}
const nextHigh = () => { const now = Date.now(); return allEvents().find((e) => e.imp === "High" && e.t > now - 2 * 60e3) || null; };
function actualFor(e) {
  if (e.actual) return { v: e.actual, src: "FF" }; if (e.ccy !== "USD" || !D.us_actuals) return null;
  const d = new Date(e.t), pm = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), per = pm.getUTCFullYear() + "-" + pad(pm.getUTCMonth() + 1);
  const it = D.us_actuals.items.find((x) => new RegExp(x.re).test(e.title) && x.period === per); return it ? { v: it.v, src: "BLS" } : null;
}
const dot = (imp) => imp === "High" ? `<span class="dn">●●●</span>` : imp === "Medium" ? `<span class="yl">●●</span><span class="dim">●</span>` : `<span class="dim">●○○</span>`;
const fmtLocal = (t) => { const d = new Date(t); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " " + hm(d); };

/* ------------------------------------------------------------ renderers */
function gauge(score, max, label) {
  const p = max ? clamp(score / max, -1, 1) : 0, ang = Math.PI * (1 - (p + 1) / 2), cx = 110, cy = 112, R = 86;
  const nx = cx + Math.cos(ang) * (R - 14), ny = cy - Math.sin(ang) * (R - 14); const [v, c] = verdict(p); const gid = "gg" + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 220 148" width="220"><defs><linearGradient id="${gid}" x1="0" x2="1"><stop offset="0" stop-color="#ff4d5e"/><stop offset=".5" stop-color="#7a86a3"/><stop offset="1" stop-color="#19c37d"/></linearGradient></defs>
  <path d="M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}" fill="none" stroke="url(#${gid})" stroke-width="14" stroke-linecap="round"/>
  <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" style="stroke:var(--needle)" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="6" fill="#ff8a1f"/>
  <text x="${cx}" y="${cy + 28}" text-anchor="middle" font-family="monospace" font-size="22" font-weight="800" style="fill:${c === "up" ? "var(--gr)" : c === "dn" ? "var(--rd)" : "var(--tx)"}">${sgn(score, 0)} / ${max}</text>
  <text x="${cx - R}" y="${cy + 16}" text-anchor="middle" font-size="10" style="fill:var(--dim)" font-family="monospace">-${max}</text><text x="${cx + R}" y="${cy + 16}" text-anchor="middle" font-size="10" style="fill:var(--dim)" font-family="monospace">+${max}</text>
  ${label ? `<text x="${cx}" y="11" text-anchor="middle" font-size="10" style="fill:var(--dim)" font-family="monospace">${esc(label)}</text>` : ""}</svg>`;
}
function barRow(name, score, max, extra) {
  const w = max ? (Math.abs(score) / max) * 50 : 0, left = score >= 0 ? 50 : 50 - w;
  return `<div class="row"><span title="${esc(extra || "")}">${esc(name)}</span><div class="bar"><i style="left:${left}%;width:${w}%;background:${score > 0 ? "var(--gr)" : score < 0 ? "var(--rd)" : "var(--mid)"}"></i></div><span class="r ${cls(score)}" style="text-align:right">${score == null ? "n/a" : sgn(score, 0)}</span></div>`;
}
function tile(name, val, ch, sub) { return `<div class="tile"><div class="tn">${esc(name)}</div><div class="tv">${val}</div><div class="${cls(ch)}">${ch == null ? "&nbsp;" : sgn(ch) + "%"}</div>${sub ? `<div class="ts">${esc(sub)}</div>` : ""}</div>`; }
function rFund(G) {
  const gp = goldPx(), ref = goldRef(), q = st.q || {}, RN = ratesNow(), real = RN.rows.find((r) => /real/i.test(r.name));
  const qv = (s, d = 2) => (q[s] ? fx(q[s].last, d) : "n/a"), qc = (s) => (q[s] ? q[s].chp : null);
  const y10 = q.US10Y ? `${q.US10Y.last.toFixed(3)}%` : RN.rows[2].value.toFixed(2) + "%";
  const tiles = tile("XAU/USD", gp ? fx(gp.px) : "n/a", gp ? (gp.px / ref.v - 1) * 100 : null, gp ? `${gp.src} · vs ${ref.lbl}` : "stale") +
    tile("DXY (ICE)", qv(".DXY", 3), qc(".DXY"), q[".DXY"] ? "CNBC" : `close ${D.us_rates.dxy_actual.value}`) +
    `<div class="tile"><div class="tn">US 10Y</div><div class="tv">${y10}</div><div class="${cls(q.US10Y ? -q.US10Y.ch : 0)}">${q.US10Y ? sgn(q.US10Y.ch * 100, 1) + "bp" : "&nbsp;"}</div><div class="ts">${q.US10Y ? "CNBC intraday" : "Treasury close"}</div></div>` +
    `<div class="tile"><div class="tn">10Y REAL</div><div class="tv">${real ? real.value.toFixed(2) + "%" : "n/a"}</div><div class="${cls(real ? -real.chg_bp : 0)}">${real ? sgn(real.chg_bp, 0) + "bp w/w" : ""}</div><div class="ts">Treasury ${esc(RN.asof)}</div></div>` +
    tile("WTI", q["@CL.1"] ? "$" + fx(q["@CL.1"].last) : "$" + D.risk.wti, qc("@CL.1"), "front month") + tile("VIX", qv(".VIX"), qc(".VIX"), "CBOE");
  const now = Date.now(), ev = allEvents().filter((e) => e.t > now - 3600e3 && e.t < now + 36 * 3600e3 && (e.imp === "High" || (e.imp === "Medium" && e.ccy === "USD")));
  const nh = nextHigh(); const left = nh ? nh.t - now : null;
  const evh = ev.length ? `<table>${ev.map((e) => { const a = actualFor(e); return `<tr style="${e.t < now ? "opacity:.55" : ""}"><td>${fmtLocal(e.t)}</td><td><b>${esc(e.ccy)}</b></td><td>${esc(e.title)}</td><td>${dot(e.imp)}</td><td class="r">${a ? `<b>${esc(a.v)}</b>` : e.fc ? "f " + esc(e.fc) : "-"}</td></tr>`; }).join("")}</table>`
    : `<div class="dim" style="font:12px var(--mono)">No high-impact (or USD medium) events in the next 36h in the loaded calendar.</div>`;
  const [v, c] = verdict(G.pct); const drv = G.rows.filter((r) => !r.na && r.score).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 4);
  $("b_fund").innerHTML = `<div class="tiles">${tiles}</div>
  <div class="cd ${left != null && left < 30 * 60e3 ? "soon" : ""}">${nh ? `<span class="dim">NEXT HIGH-IMPACT</span> <b>${esc(nh.ccy)} · ${esc(nh.title)}</b> <span class="dim">${fmtLocal(nh.t)}</span><span class="cdv" data-cd="${nh.t}">${left <= 0 ? "NOW" : dur(left)}</span>` : `<span class="dim">No upcoming high-impact event with a known time in the loaded calendar.</span>`}</div>
  <div class="sub">KEY RISK EVENTS · NEXT 36H (your local time)</div>${evh}
  <div class="fv"><span class="pill ${c}">FUNDAMENTALS: ${v} ${sgn(G.total, 0)}/${G.max}</span> ${drv.map((r) => `<span class="pill ${cls(r.score)}">${esc(r.name)} ${sgn(r.score, 0)}</span>`).join(" ")}</div>
  <div class="asof">Fed: ${esc(D.policy.banks.find((b) => b.ccy === "USD").rate.toFixed(2))}% upper bound, last move ${D.fed.last_move_dir > 0 ? "hike" : "cut/hold"}; Oct 28 hike odds ~${D.fed.next_hike_prob}%, Dec ~${D.fed.dec_hike_prob}% (manual, ${esc(D.policy.asof)}). Flows: ETF ${esc(D.flows.etf_month)} ${sgn(D.flows.etf_month_usd_bn, 0)}bn, CB ${esc(D.flows.cb_month)} +${D.flows.cb_net_t}t. Calendar: ForexFactory (build ${esc(D.ff_calendar.fetched_at || "n/a")}) + curated.</div>`;
}
function smcAll() { const out = {}; ["1H", "4H", "1D"].forEach((tf) => { let C = candlesFor(st.chartSrc, tf), src = st.chartSrc;
    if ((!C || C.length < 30) && st.chartSrc === "XAU") { C = candlesFor("PAXG", tf); src = "PAXG"; }
    out[tf] = C && C.length >= 30 ? Object.assign(smc(C, st.swingLen, false), { src, C }) : null; }); st.smc = out; return out; }
const biasTxt = (s) => { if (!s) return "n/a"; const lb = s.lb; return (lb ? `${lb.kind} ${lb.dir > 0 ? "↑" : "↓"}` : "no break") + ` · ${s.loc}${s.inOTE ? " · in OTE" : ""}`; };
function rConf(G) {
  const S = st.smc, W = { "1D": 0.5, "4H": 0.3, "1H": 0.2 }; let tw = 0, T = 0;
  Object.entries(W).forEach(([tf, w]) => { if (S[tf]) { T += (w * S[tf].bias) / 3; tw += w; } }); T = tw ? T / tw : null;
  const F = clamp(G.pct / 0.35, -1, 1); const C = T == null ? F / 2 : (F + T) / 2; const pts = Math.round(C * 10);
  let lab, lc; if (T != null && Math.sign(F) === Math.sign(T) && Math.abs(F) >= 0.2 && Math.abs(T) >= 0.2) { lab = "ALIGNED " + (F > 0 ? "BULLISH" : "BEARISH"); lc = F > 0 ? "up" : "dn"; }
  else if (T != null && Math.sign(F) !== Math.sign(T) && Math.abs(F) >= 0.2 && Math.abs(T) >= 0.2) { lab = "CONFLICT"; lc = "yl"; } else { lab = "MIXED / WEAK"; lc = "fl"; }
  const row = (n, val, max, txt) => `<tr><td>${n}</td><td class="r ${cls(val)}"><b>${val == null ? "n/a" : sgn(val, 0)}</b>${max ? `<span class="dim">/${max}</span>` : ""}</td><td class="dim">${esc(txt)}</td></tr>`;
  $("b_conf").innerHTML = `<div class="sc"><div>${gauge(pts, 10, "CONFLUENCE")}</div><div><div class="vsub">TECHNICAL (SMC) + FUNDAMENTAL (SCORECARD)</div><div class="verdict ${lc}">${lab}</div>
   <div class="vsub">Fundamental ${sgn(F * 100, 0)}% · Technical ${T == null ? "n/a" : sgn(T * 100, 0) + "%"} · Combined ${sgn(C * 100, 0)}%</div>
   <table style="margin-top:6px"><tr><th>COMPONENT</th><th class="r">SCORE</th><th>STATE</th></tr>${row("Fundamental scorecard", G.total, G.max, verdict(G.pct)[0])}
   ${["1D", "4H", "1H"].map((tf) => row("SMC bias " + tf + (S[tf] && S[tf].src === "PAXG" ? " (PAXG)" : ""), S[tf] ? S[tf].bias : null, 3, biasTxt(S[tf]))).join("")}</table></div></div>
   <div class="asof">${lab === "CONFLICT" ? '<span class="yl">Technical and fundamental signals disagree: typical learning rule is to wait for alignment or trade smaller.</span> ' : ""}Combined = average of fundamental (score ÷ 35% of max, capped ±1) and technical (SMC bias ÷ 3, weighted 1D 50% / 4H 30% / 1H 20%). SMC bias = last break (BOS ±2, CHoCH ±1) + ±1 when price sits in the discount (bullish) / premium (bearish) half of the latest leg. Educational, not advice.</div>`;
}
function rScore(G) {
  const [v, c] = verdict(G.pct); const sup = G.rows.filter((r) => r.score > 0), ag = G.rows.filter((r) => r.score < 0); const gp = goldPx(), ref = goldRef();
  $("b_score").innerHTML = `<div class="sc"><div>${gauge(G.total, G.max, "COMPOSITE")}</div><div><div class="vsub">VERDICT · XAU/USD</div><div class="verdict ${c}">${v}</div>
  <div class="vsub">Score ${sgn(G.total, 0)} of ±${G.max} possible (${sgn(G.pct * 100, 0)}%) · ${G.rows.filter((r) => r.na).length} categories n/a</div>
  <div class="bars" style="margin-top:8px">${G.rows.map((r) => barRow(r.name + (r.src === "LIVE" ? " ●" : ""), r.na ? 0 : r.score, r.max, r.input)).join("")}</div></div></div>
  <div class="sw"><div><b class="up">▲ SUPPORTS GOLD</b><br>${sup.map((r) => `${sgn(r.score, 0)} ${esc(r.name)} <span class="dim">(${esc(r.input)})</span>`).join("<br>") || "<span class=dim>none</span>"}</div>
  <div><b class="dn">▼ WORKS AGAINST</b><br>${ag.map((r) => `${sgn(r.score, 0)} ${esc(r.name)} <span class="dim">(${esc(r.input)})</span>`).join("<br>") || "<span class=dim>none</span>"}</div></div>
  <div class="asof">● = live input. Hover a bar for its input. Spot ${gp ? fx(gp.px) : "n/a"} vs ${ref.lbl} ${fx(ref.v)}.</div>`;
}
function rStrength(sc) {
  const order = CCYS.slice().sort((a, b) => sc[b].total - sc[a].total);
  $("b_strength").innerHTML = `<div class="scroll"><table><tr><th>CCY</th><th>SCORE</th><th></th><th class="r">1D %</th><th class="r">5D %</th><th class="r">20D %</th>${CCY_RULES.map((r) => `<th class="r">${r.k.toUpperCase()}</th>`).join("")}<th class="r">POLICY</th></tr>` +
    order.map((c) => { const s = sc[c], w = (Math.abs(s.total) / CCY_MAX) * 50;
      return `<tr><td><b>${c}</b></td><td class="${cls(s.total)}"><b>${sgn(s.total, 0)}</b></td><td style="width:110px"><div class="bar"><i style="left:${s.total >= 0 ? 50 : 50 - w}%;width:${w}%;background:${s.total >= 0 ? "var(--gr)" : "var(--rd)"}"></i></div></td>
      <td class="r ${cls(s.ch1)}">${sgn(s.ch1)}</td><td class="r ${cls(s.ch5)}">${sgn(s.ch5)}</td><td class="r ${cls(s.ch20)}">${sgn(s.ch20)}</td>` + CCY_RULES.map((r) => `<td class="r ${cls(s.comp[r.k])}">${s.comp[r.k] == null ? "n/a" : sgn(s.comp[r.k], 0)}</td>`).join("") +
      `<td class="r">${s.bank ? s.bank.rate.toFixed(2) + "%" : "n/a"}</td></tr>`; }).join("") + `</table></div>
    <div class="asof">Range ±${CCY_MAX}. FX: ${esc(sc._src)}. 1D = vs previous close as reported by the quote feed (over weekends some symbols report UNCH). COT ${sc.USD.cot ? sc.USD.cot.date : "n/a"}; policy rates as of ${D.policy.asof}.</div>`;
}
function heat(v, m) { const a = clamp(Math.abs(v) / m, 0, 1); return v === 0 ? "var(--cell)" : v > 0 ? `rgba(25,195,125,${0.15 + a * 0.7})` : `rgba(255,77,94,${0.15 + a * 0.7})`; }
function rHeatmap(sc, P) {
  let h = `<div class="scroll"><table class="hm"><tr><th>BASE \\ QUOTE</th>${CCYS.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  CCYS.forEach((b) => { h += `<tr><th>${b}</th>` + CCYS.map((q) => b === q ? `<td style="background:var(--cell0)">·</td>` : `<td style="background:${heat(sc[b].total - sc[q].total, 10)}">${sgn(sc[b].total - sc[q].total, 0)}</td>`).join("") + "</tr>"; });
  h += `</table></div><div class="asof">Cell = row score − column score (±${CCY_MAX * 2}). Green = row currency stronger. Includes the live intraday component.</div>
  <div class="scroll" style="margin-top:8px"><table><tr><th>#</th><th>PAIR</th><th class="r">SCORE</th><th>BIAS</th><th class="r">LIVE</th><th>DRIVERS</th></tr>` +
    P.slice(0, 10).map((p, i) => `<tr><td class="dim">${i + 1}</td><td><b>${p.pair}</b></td><td class="r ${cls(p.score)}"><b>${sgn(p.score, 0)}</b></td><td><span class="pill ${cls(p.score)}">${pairLabel(p.score)}</span></td><td class="r">${pairPx(p.b, p.q)}</td><td class="dim">${p.b} ${sgn(sc[p.b].total, 0)} vs ${p.q} ${sgn(sc[p.q].total, 0)}</td></tr>`).join("") + `</table></div><div class="asof">Top 10 of 28 pairs by |score|. LIVE = cross computed from live USD quotes (n/a if no live feed).</div>`;
  $("b_heatmap").innerHTML = h;
}
function pairPx(b, q) { const L = liveFX(); if (!L) return "n/a"; const v = L.r[q] / L.r[b]; return fx(v, v > 20 ? 2 : 4); }
function rMarkets() {
  const q = st.q || {}; const row = (n, s, d, bp, srcOverride) => { const x = q[s]; if (!x) return `<tr><td>${n}</td><td class="r dim">n/a</td><td class="r"></td><td class="dim"></td></tr>`;
    const t = x.time ? String(x.time).replace("T", " ").slice(0, 16) : ""; return `<tr><td>${n}</td><td class="r"><b>${bp ? x.last.toFixed(3) + "%" : fx(x.last, d)}</b></td><td class="r ${bp ? cls(-(x.ch || 0)) : cls(x.chp)}">${bp ? sgn((x.ch || 0) * 100, 1) + "bp" : sgn(x.chp) + "%"}</td><td class="dim">${esc(t)}</td></tr>`; };
  const btc = st.btc ? `<tr><td>Bitcoin (Coinbase live)</td><td class="r"><b>${fx(st.btc.px, 0)}</b></td><td class="r ${q["BTC.CB="] ? cls(q["BTC.CB="].chp) : ""}">${q["BTC.CB="] ? sgn(q["BTC.CB="].chp) + "%" : ""}</td><td class="dim">${esc(String(st.btc.at || "").slice(0, 16).replace("T", " "))}</td></tr>` : row("Bitcoin", "BTC.CB=", 0);
  $("b_markets").innerHTML = `<div class="scroll"><table><tr><th>INSTRUMENT</th><th class="r">LAST</th><th class="r">CHG</th><th>QUOTE TIME (EXCH.)</th></tr>
  ${row("Gold spot XAU=", "XAU=", 2)}${row("Gold fut. COMEX", "@GC.1", 2)}${row("Silver spot XAG=", "XAG=", 3)}${row("US Dollar Index (ICE)", ".DXY", 3)}
  ${row("US 3M", "US3M", 3, 1)}${row("US 2Y", "US2Y", 3, 1)}${row("US 10Y", "US10Y", 3, 1)}${row("US 30Y", "US30Y", 3, 1)}
  ${row("WTI crude", "@CL.1", 2)}${row("Brent crude", "@LCO.1", 2)}${row("S&P 500", ".SPX", 2)}${row("Nasdaq 100", ".NDX", 2)}${row("VIX", ".VIX", 2)}${btc}</table></div>
  <div class="asof">Source: CNBC public quote feed (keyless, <b>unofficial/undocumented</b>, may be delayed or change without notice). Yields: green = falling. Quote time is the exchange's last trade time.</div>`;
}
function rCOT() {
  const cs = cotStats(); if (!cs) { if (!st.cotRendered) $("b_cot").innerHTML = `<span class="dn">COT feed unavailable.</span>`; return; }
  st.cotRendered = true;
  $("b_cot").innerHTML = `<div class="cots">` + Object.keys(COT_CODES).filter((k) => cs[k]).map((k) => { const x = cs[k];
    const fc = /LONG/.test(x.flag) ? "up" : /SHORT/.test(x.flag) ? "dn" : "fl";
    return `<div class="cot"><div class="nm"><span>${k}</span><span class="dim" style="font-weight:400">${esc(COT_NAMES[k])}</span></div>
    <div class="big ${cls(x.net)}">${sgn(x.net / 1000, 1)}K</div><div class="dim">net contracts · ${x.date}</div>
    <div class="lb"><i style="width:${x.pctLong.toFixed(1)}%"></i></div><div style="display:flex;justify-content:space-between"><span class="up">${x.pctLong.toFixed(0)}% L</span><span class="dn">${(100 - x.pctLong).toFixed(0)}% S</span></div>
    <div>w/w <span class="${cls(x.chg)}">${sgn(x.chg / 1000, 1)}K</span> · 52w pct <b>${x.pct.toFixed(0)}</b></div><div><span class="pill ${fc}">${x.flag}</span></div></div>`; }).join("") +
    `</div><div class="asof">Source: CFTC Legacy futures-only report (public API), non-commercial (large speculators). Weekly, positions as of Tuesday, released Friday. Percentile over last ${cs.XAU ? cs.XAU.n : 52} reports.</div>`;
}

function rChart() {
  const el = $("b_chart"), tf = st.chartTf; let src = st.chartSrc, C = candlesFor(src, tf), note = "";
  if ((!C || C.length < 30) && src === "XAU") { const C2 = candlesFor("PAXG", tf); if (C2 && C2.length >= 30) { C = C2; src = "PAXG"; note = "XAU chart feed unavailable → PAXG fallback. "; } }
  const B = (k, v, lab, on) => `<button class="btn ghost sm ${on ? "on" : ""}" data-${k}="${v}">${lab}</button>`;
  const ctl = `<div class="ctl"><span class="grp2">${["1H", "4H", "1D"].map((t) => B("tf", t, t, tf === t)).join("")}</span><span class="grp2">${B("src", "XAU", "XAU SPOT", st.chartSrc === "XAU")}${B("src", "PAXG", "PAXG 24/7", st.chartSrc === "PAXG")}</span>
    <span class="grp2">${B("smc", st.smcOn ? 0 : 1, "SMC " + (st.smcOn ? "ON" : "OFF"), st.smcOn)}</span><span class="grp2"><span class="dim">SWING</span>${[3, 5, 8].map((n) => B("sl", n, n, st.swingLen === n)).join("")}</span></div>`;
  if (!C || C.length < 30) { el.innerHTML = ctl + `<span class="dn">Candles unavailable for ${tf}.</span>`; bindChart(el); return; }
  const SM = st.smcOn ? smc(C, st.swingLen, false) : null;
  const narrow = el.clientWidth > 0 && el.clientWidth < 640; // phones: fewer candles, taller canvas
  const N = Math.min(C.length, narrow ? 60 : 140), off = C.length - N, c = C.slice(off), W = narrow ? 480 : 1000, H = narrow ? 440 : 400, L = 8, R = narrow ? 56 : 70, T = 12, Bm = 22;
  let lo = Math.min(...c.map((x) => x.l)), hi = Math.max(...c.map((x) => x.h));
  if (SM && SM.fib) { const e = SM.fib.ext, span = hi - lo; if (e > hi && e - hi < span * 0.3) hi = e; if (e < lo && lo - e < span * 0.3) lo = e; }
  const pd = (hi - lo) * 0.04, X = (i) => L + (clamp(i - off, -0.5, N - 0.5) + 0.5) * ((W - L - R) / N), Y = (v) => T + ((hi + pd - v) / (hi - lo + 2 * pd)) * (H - T - Bm);
  const bw = Math.max(1.5, ((W - L - R) / N) * 0.62), xr = W - R, inY = (v) => v >= lo - pd && v <= hi + pd;
  const closes = C.map((x) => x.c), s20 = [], s50 = []; for (let i = off; i < C.length; i++) { const a = closes.slice(0, i + 1); s20.push(sma(a, 20)); s50.push(sma(a, 50)); }
  const txt = (x, y, t, col, anchor = "start", size = 10, w = 400) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${size}" font-family="monospace" font-weight="${w}" style="fill:${col}">${esc(t)}</text>`;
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let g = 0; g <= 5; g++) { const v = lo - pd + ((hi - lo + 2 * pd) * g) / 5; s += `<line x1="${L}" x2="${xr}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/>` + txt(xr + 4, Y(v) + 4, fx(v, 0), "var(--dim)"); }
  const used = []; const place = (x, y) => { let yy = y; for (let n = 0; n < 6 && used.some((u) => Math.abs(u[0] - x) < 60 && Math.abs(u[1] - yy) < 11); n++) yy += 11; used.push([x, yy]); return yy; };
  const box = (i0, top, bot, fill, stroke, label) => { const x0 = X(i0), y0 = Y(top), y1 = Y(bot); return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(xr - x0).toFixed(1)}" height="${Math.max(1.5, y1 - y0).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width=".8"/>` + txt(x0 + 3, place(x0 + 3, y0 + 10), label, stroke, "start", 9, 700); };
  let info = [];
  if (SM) {
    // Fib OTE zone (drawn first, under candles)
    const F = SM.fib; if (F) { const o1 = F.levels[2].p, o2 = F.levels[4].p; s += `<rect x="${X(F.a).toFixed(1)}" y="${Y(Math.max(o1, o2)).toFixed(1)}" width="${(xr - X(F.a)).toFixed(1)}" height="${Math.abs(Y(o1) - Y(o2)).toFixed(1)}" fill="rgba(74,163,255,.10)"/>`; }
    const pick = (arr, f, n) => arr.filter(f).slice(-n);
    pick(SM.obs, (o) => !o.mit && o.dir > 0 && inY(o.top), 2).forEach((o) => (s += box(o.i, o.top, o.bot, "rgba(25,195,125,.16)", "#19c37d", "BULL OB")));
    pick(SM.obs, (o) => !o.mit && o.dir < 0 && inY(o.bot), 2).forEach((o) => (s += box(o.i, o.top, o.bot, "rgba(255,77,94,.16)", "#ff4d5e", "BEAR OB")));
    pick(SM.fvgs, (f) => !f.filled && f.dir > 0 && f.i >= off && inY(f.top), 2).forEach((f) => (s += box(f.i, f.top, f.bot, "rgba(255,211,77,.10)", "#d9b23a", "FVG↑")));
    pick(SM.fvgs, (f) => !f.filled && f.dir < 0 && f.i >= off && inY(f.bot), 2).forEach((f) => (s += box(f.i, f.top, f.bot, "rgba(186,104,255,.12)", "#b07cff", "FVG↓")));
  }
  c.forEach((k, j) => { const i = j + off, up = k.c >= k.o, col = up ? "#19c37d" : "#ff4d5e";
    s += `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(k.h)}" y2="${Y(k.l)}" stroke="${col}"/><rect x="${X(i) - bw / 2}" y="${Y(Math.max(k.o, k.c))}" width="${bw}" height="${Math.max(1, Math.abs(Y(k.o) - Y(k.c)))}" fill="${col}"/>`; });
  const line = (arr, col) => { const pts = arr.map((v, j) => (v == null ? null : `${X(j + off).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(" "); return pts ? `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.2" opacity="${SM ? 0.45 : 1}"/>` : ""; };
  s += line(s20, "#ffb057") + line(s50, "#4aa3ff");
  if (SM) {
    SM.breaks.filter((b) => b.k >= off).slice(-6).forEach((b) => { const col = b.dir > 0 ? "#19c37d" : "#ff4d5e", x0 = X(b.i0), x1 = X(b.k);
      s += `<line x1="${x0}" x2="${x1}" y1="${Y(b.p)}" y2="${Y(b.p)}" stroke="${col}" stroke-dasharray="${b.kind === "CHoCH" ? "2 3" : "6 3"}" stroke-width="1.3"/>` + txt(Math.max(L + 18, (x0 + x1) / 2), Y(b.p) + (b.dir > 0 ? -4 : 11), b.kind, col, "middle", 9.5, 700); });
    SM.eqs.filter((e) => (e.end == null ? SM.n - 1 : e.end) >= off + 8).slice(-4).forEach((e) => { const x0 = X(e.i1), x1 = e.end == null ? xr : X(e.end);
      s += `<line x1="${x0}" x2="${x1}" y1="${Y(e.p)}" y2="${Y(e.p)}" stroke="#ffd34d" stroke-dasharray="1 3" stroke-width="1.6"/>` + txt(Math.max(L + 56, x1 - 2), Y(e.p) + (e.t === "H" ? -4 : 11), (e.t === "H" ? "EQH" : "EQL") + (e.end == null ? " $$$" : e.swept ? " swept" : " taken"), "#ffd34d", "end", 9, 700); });
    SM.swings.filter((w) => w.i >= off && w.lab.length === 2).forEach((w) => { const col = w.lab === "HH" || w.lab === "HL" ? "#19c37d" : "#ff4d5e";
      s += txt(X(w.i), w.t === "H" ? Y(w.p) - 5 : Y(w.p) + 13, w.lab, col, "middle", 9, 700); });
    const F = SM.fib; if (F) { const x0 = X(F.a);
      const labs = [];
      F.levels.forEach((l) => { const ote = l.f >= 0.618 && l.f <= 0.786; s += `<line x1="${x0}" x2="${xr}" y1="${Y(l.p)}" y2="${Y(l.p)}" stroke="#4aa3ff" stroke-width="${ote ? 1 : 0.6}" opacity="${l.f === 0 || l.f === 1 ? 0.35 : 0.8}" stroke-dasharray="${l.f === 0.5 ? "4 2" : ""}"/>`;
        if (l.f > 0 && l.f < 1) labs.push([Y(l.p) + 3, `${l.f} ${fx(l.p, 1)}`]); });
      labs.sort((a, b) => a[0] - b[0]); for (let j = 1; j < labs.length; j++) labs[j][0] = Math.max(labs[j][0], labs[j - 1][0] + 10);
      labs.forEach(([y, t]) => (s += `<rect x="${xr - 78}" y="${y - 8.5}" width="76" height="10" style="fill:var(--pn)" opacity=".75"/>` + txt(xr - 3, y, t, "#4aa3ff", "end", 9)));
      if (inY(F.ext)) s += `<line x1="${x0}" x2="${xr}" y1="${Y(F.ext)}" y2="${Y(F.ext)}" stroke="#ff8a1f" stroke-dasharray="5 3"/>` + txt(xr - 3, Y(F.ext) - 3, `1.618 EXT ${fx(F.ext, 1)}`, "#ff8a1f", "end", 9, 700);
      else info.push(`1.618 ext ${fx(F.ext, 1)} (off-chart)`);
      s += txt(x0 + 4, Y((F.levels[2].p + F.levels[4].p) / 2) + 3, "OTE", "#4aa3ff", "start", 9, 700); }
  }
  const gp = goldPx(), last = src === "XAU" && gp ? gp.px : c[c.length - 1].c;
  s += `<line x1="${L}" x2="${xr}" y1="${Y(last)}" y2="${Y(last)}" stroke="#ff8a1f" stroke-dasharray="3 3"/><rect x="${xr + 1}" y="${Y(last) - 8}" width="${R - 2}" height="16" fill="#ff8a1f" rx="3"/>` + txt(xr + 4, Y(last) + 4, fx(last, 1), "#140a00", "start", 10.5, 700);
  (narrow ? [0, N - 1] : [0, Math.floor(N / 3), Math.floor((2 * N) / 3), N - 1]).forEach((j) => { const d = new Date(c[j].t);
    s += txt(X(j + off), H - 6, tf === "1D" ? d.toISOString().slice(0, 10) : d.toISOString().slice(5, 16).replace("T", " "), "var(--dim)", j === N - 1 ? "end" : j === 0 ? "start" : "middle"); });
  s += `</svg>`;
  let sum = "";
  if (SM) { const F = SM.fib, lb = SM.lb, ob = SM.obs.filter((o) => !o.mit).slice(-1)[0], fv = SM.fvgs.filter((f) => !f.filled).slice(-1)[0], eq = SM.eqs.filter((e) => e.end == null).slice(-2);
    sum = `<div class="smcsum"><span class="pill ${cls(SM.bias)}">SMC BIAS ${tf} ${sgn(SM.bias, 0)}/3</span><span>Structure: <b class="${lb ? cls(lb.dir) : ""}">${lb ? `${lb.kind} ${lb.dir > 0 ? "bullish" : "bearish"} @ ${fx(lb.p, 1)}` : "no break yet"}</b></span>
      <span>Leg: ${F ? `${F.dir > 0 ? "up" : "down"} ${fx(F.lo, 1)} → ${fx(F.hi, 1)} · price in <b>${SM.loc}</b>${SM.inOTE ? ' · <b class="or">inside OTE 0.618–0.786</b>' : ""}` : "n/a"}</span>
      <span>Latest OB: ${ob ? `${ob.dir > 0 ? "bull" : "bear"} ${fx(ob.bot, 1)}–${fx(ob.top, 1)}` : "none open"}</span><span>Latest FVG: ${fv ? `${fv.dir > 0 ? "bull" : "bear"} ${fx(fv.bot, 1)}–${fx(fv.top, 1)}` : "none open"}</span>
      <span>Liquidity: ${eq.length ? eq.map((e) => `${e.t === "H" ? "EQH" : "EQL"} ${fx(e.p, 1)}`).join(", ") : "no resting equal highs/lows"}</span>${info.length ? `<span class="dim">${esc(info.join(" · "))}</span>` : ""}</div>`; }
  const srcTxt = src === "XAU" ? "XAU/USD spot via CNBC chart feed (unofficial; 1H ~60 days, 4H = aggregated 1H, 1D ~2y; closed-market zero-range bars removed)" : "PAXG-USD (gold-backed token, Coinbase, trades 24/7; tracks spot closely but not exactly; 4H = aggregated 1H)";
  el.innerHTML = ctl + `<div class="chart">${s}</div>${sum}<div class="asof">${note}${esc(srcTxt)} · ${c.length} of ${C.length} candles shown (UTC) · <span style="color:#ffb057">━ SMA20</span> <span style="color:#4aa3ff">━ SMA50</span>${SM ? ` · swings: ${st.swingLen} bars each side, close-based breaks, EQ tolerance ${fx(SM.tol, 2)} (10% ATR14) · same rules as the MT5 indicator SMC_Elliott_Structure.mq5` : ""}</div>`;
  bindChart(el);
}
function bindChart(el) {
  el.querySelectorAll("[data-tf]").forEach((b) => (b.onclick = () => { st.chartTf = b.dataset.tf; localStorage.setItem("rezan_tf", st.chartTf); rChart(); }));
  el.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => { st.chartSrc = b.dataset.src; localStorage.setItem("rezan_src", st.chartSrc); renderAll(); }));
  el.querySelectorAll("[data-smc]").forEach((b) => (b.onclick = () => { st.smcOn = b.dataset.smc === "1"; localStorage.setItem("rezan_smc", st.smcOn ? "1" : "0"); rChart(); }));
  el.querySelectorAll("[data-sl]").forEach((b) => (b.onclick = () => { st.swingLen = +b.dataset.sl; localStorage.setItem("rezan_sl", st.swingLen); renderAll(); }));
}
function rCorr() {
  const S = fxSeries(), gd = goldDaily(); if (!S || !gd) { $("b_corr").innerHTML = `<span class="dim">Needs FX series + gold daily candles.</span>`; return; }
  const pmap = {}; gd.C.forEach((k) => (pmap[isoDay(new Date(k.t))] = k.c));
  const rows = st.fx.dates.map((d, i) => ({ d, r: st.fx.r[i] })).filter((x) => pmap[x.d] != null);
  const series = { GOLD: rows.map((x) => pmap[x.d]), DXY: rows.map((x) => dxyOf(x.r)), EURUSD: rows.map((x) => 1 / x.r.EUR), GBPUSD: rows.map((x) => 1 / x.r.GBP), USDJPY: rows.map((x) => x.r.JPY), AUDUSD: rows.map((x) => 1 / x.r.AUD), USDCHF: rows.map((x) => x.r.CHF) };
  const N = 60, keys = Object.keys(series); const rets = {};
  keys.forEach((k) => { const s = series[k]; const r = []; for (let i = 1; i < s.length; i++) r.push(Math.log(s[i] / s[i - 1])); rets[k] = r.slice(-N); });
  const n = rets[keys[0]].length; if (n < 20) { $("b_corr").innerHTML = `<span class="dim">Not enough overlapping dates (${n}).</span>`; return; }
  let h = `<div class="scroll"><table class="hm"><tr><th></th>${keys.map((k) => `<th>${k}</th>`).join("")}</tr>`;
  keys.forEach((a) => { h += `<tr><th>${a}</th>` + keys.map((b) => { const v = a === b ? 1 : corr(rets[a], rets[b]); return `<td style="background:${a === b ? "var(--cell0)" : heat(v, 1)}">${v.toFixed(2)}</td>`; }).join("") + "</tr>"; });
  $("b_corr").innerHTML = h + `</table></div><div class="asof">Pearson correlation of daily log returns, last ${n} common days. GOLD = ${esc(gd.src)} daily close; FX = ECB fixes (14:15 CET) - the timing mismatch lowers correlations.</div>`;
}
function rRates() {
  const u = ratesNow(), p = D.policy, q = st.q || {}, S = fxSeries(); const dxyP = S ? dxyOf(S.r[S.r.length - 1]) : null;
  const live = { "US 3M": "US3M", "US 2Y": "US2Y", "US 10Y": "US10Y", "US 30Y": "US30Y" };
  const dx = q[".DXY"] ? { v: fx(q[".DXY"].last, 3), c: q[".DXY"].chp, l: "live CNBC" } : { v: D.us_rates.dxy_actual.value, c: D.us_rates.dxy_actual.chg_pct_d, l: "close " + (D.us_rates.dxy_actual.asof || "") };
  $("b_rates").innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px"><div><table><tr><th>US CURVE</th><th class="r">CLOSE</th><th class="r">W/W</th><th class="r">INTRADAY</th></tr>` +
    u.rows.map((r) => { const x = live[r.name] && q[live[r.name]]; return `<tr><td>${esc(r.name)}</td><td class="r"><b>${r.value.toFixed(2)}%</b></td><td class="r ${cls(-r.chg_bp)}">${r.chg_bp == null ? "n/a" : sgn(r.chg_bp, 0) + "bp"}</td><td class="r ${x ? cls(-x.ch) : "dim"}">${x ? x.last.toFixed(3) + "%" : "-"}</td></tr>`; }).join("") +
    `<tr><td>DXY (ICE)</td><td class="r"><b>${dx.v}</b></td><td class="r ${cls(-dx.c)}">${sgn(dx.c, 2)}% d/d</td><td class="r dim">${esc(dx.l)}</td></tr><tr><td>DXY proxy (ECB fix + live)</td><td class="r"><b>${fx(dxyP)}</b></td><td class="r dim"></td><td class="r dim">calc</td></tr>` +
    `</table><div class="asof">Close/W/W: ${esc(u.asof)} · ${esc(u.source)}. Intraday: CNBC quote feed (unofficial). Green = yields falling (usually gold-supportive).</div></div><div><table><tr><th>BANK</th><th class="r">RATE</th><th>LAST MOVE</th><th>NEXT</th></tr>` +
    p.banks.slice().sort((a, b) => b.rate - a.rate).map((b) => `<tr><td><b>${b.ccy}</b> <span class="dim">${b.bank}</span></td><td class="r"><b>${b.rate.toFixed(2)}%</b></td><td class="${cls(b.last_dir)}">${esc(b.last)}</td><td>${esc(b.next)}</td></tr>`).join("") +
    `</table><div class="asof">As of ${p.asof} (manual) · ${esc(p.source)}. ${esc(p.note)}</div></div></div>`;
}
function rRegime() {
  const pmi = D.us_data.pmi_composite, cpi = D.us_data.rows.find((r) => r.name.startsWith("CPI y/y"));
  const gUp = pmi.value > 50, iUp = cpi.actual > cpi.prior;
  const q = [["GOLDILOCKS", "Growth ↑ · Inflation ↓", gUp && !iUp], ["OVERHEATING / REFLATION", "Growth ↑ · Inflation ↑", gUp && iUp], ["DISINFLATIONARY SLOWDOWN", "Growth ↓ · Inflation ↓", !gUp && !iUp], ["STAGFLATION", "Growth ↓ · Inflation ↑", !gUp && iUp]];
  const nfp = D.us_data.rows.find((r) => r.name.startsWith("Nonfarm"));
  $("b_regime").innerHTML = `<div class="quad">${q.map((x) => `<div class="${x[2] ? "on" : ""}"><b>${x[0]}</b><br>${x[1]}${x[2] ? "<br>◀ CURRENT" : ""}</div>`).join("")}</div>
  <div class="asof">Growth: US composite PMI ${pmi.value} (${pmi.period}, manual) ${gUp ? "> 50" : "≤ 50"} · Inflation: ${esc(cpi.name)} ${cpi.actual}% vs prior ${cpi.prior}% (${iUp ? "rising" : "falling"}). Payrolls ${nfp ? sgn(nfp.actual, 0) + "k" : "n/a"} - check whether jobs confirm the PMI.</div>`;
}
function rFed() {
  const f = D.fed, usd = D.policy.banks.find((b) => b.ccy === "USD");
  $("b_fed").innerHTML = `<div class="verdict" style="font-size:20px">FFR ${(usd.rate - 0.25).toFixed(2)}–${usd.rate.toFixed(2)}%</div><div class="vsub">Next: ${esc(usd.next)}</div>
  <table style="margin-top:6px">${f.odds.map((o) => `<tr><td>${esc(o.label)}</td><td class="r"><b>${o.value}%</b></td></tr>`).join("")}</table><div class="asof yl">⚠ ${esc(f.note)} (manual - no free keyless FedWatch feed)</div>`;
}
function rSurprise() {
  $("b_surprise").innerHTML = `<div class="scroll"><table><tr><th>RELEASE</th><th class="r">ACTUAL</th><th class="r">FCST</th><th class="r">PRIOR</th><th class="r">SURPRISE</th><th>READ</th></tr>` +
    D.us_data.rows.map((r) => { const s = r.forecast == null ? null : r.actual - r.forecast; const hawk = s == null || Math.abs(s) < 1e-9 ? 0 : (s > 0) === r.hawk_if_higher ? 1 : -1;
      return `<tr><td>${esc(r.name)}${r.src ? ` <span class="tag live" title="${esc(r.src)}">AUTO</span>` : ""}</td><td class="r"><b>${r.actual}${r.unit}</b></td><td class="r">${r.forecast == null ? "n/a" : r.forecast + r.unit}</td><td class="r dim">${r.prior == null ? "n/a" : r.prior + r.unit}</td><td class="r ${hawk > 0 ? "dn" : hawk < 0 ? "up" : "fl"}">${s == null ? "n/a" : sgn(s, r.unit === "k" ? 0 : 1)}</td><td><span class="pill ${hawk > 0 ? "dn" : hawk < 0 ? "up" : "fl"}">${hawk > 0 ? "HAWKISH" : hawk < 0 ? "DOVISH" : s == null ? "N/A" : "IN LINE"}</span></td></tr>`; }).join("") +
    `</table></div><div class="asof">${esc(D.us_data.asof)} · ${esc(D.us_data.source)}. AUTO = actual/prior pulled from the BLS public API by build.py; forecasts are entered by hand (n/a when unknown). Red = hawkish (usually USD+, gold−).</div>`;
}
function rCalendar() {
  const now = Date.now(), ev = allEvents().filter((e) => e.src === "FF" && (e.imp === "High" || (e.imp === "Medium" && /USD|EUR|GBP|JPY/.test(e.ccy))));
  const nh = nextHigh(), left = nh ? nh.t - now : null;
  let h = `<div class="cd ${left != null && left < 30 * 60e3 ? "soon" : ""}">${nh ? `<span class="dim">NEXT HIGH-IMPACT</span> <b>${esc(nh.ccy)} · ${esc(nh.title)}</b><span class="cdv" data-cd="${nh.t}">${left <= 0 ? "NOW" : dur(left)}</span>` : `<span class="dim">No upcoming timed high-impact event loaded.</span>`}</div>`;
  h += `<div class="scroll"><table><tr><th>LOCAL TIME</th><th>CCY</th><th>EVENT</th><th class="r">ACTUAL</th><th class="r">FCST</th><th class="r">PREV</th><th>IMP</th></tr>`;
  h += ev.length ? ev.map((e) => { const past = e.t < now, a = actualFor(e), soon = !past && e.t - now < 30 * 60e3;
    return `<tr class="${soon ? "soonrow" : ""}" style="${past ? "opacity:.55" : ""}"><td>${fmtLocal(e.t)}</td><td><b>${esc(e.ccy)}</b></td><td>${esc(e.title)}</td><td class="r">${a ? `<b>${esc(a.v)}</b><span class="dim" style="font-size:9px"> ${a.src}</span>` : past ? '<span class="dim">n/a</span>' : "-"}</td><td class="r">${esc(e.fc || "-")}</td><td class="r dim">${esc(e.prev || "-")}</td><td>${dot(e.imp)}</td></tr>`; }).join("")
    : `<tr><td colspan="7" class="dim">ForexFactory weekly JSON not loaded at build time.</td></tr>`;
  h += `</table></div><div class="asof">This week: ForexFactory weekly JSON (build ${esc(D.ff_calendar.fetched_at || "n/a")}), High + Medium USD/EUR/GBP/JPY, your local time zone. The free FF feed has no actuals: past US CPI/NFP/unemployment actuals come from the BLS API (build.py); other past events show n/a - check the source.</div>
  <div style="margin-top:8px" class="scroll"><table><tr><th>DATE</th><th>CCY</th><th>KEY EVENTS AHEAD (CURATED)</th><th>IMP</th></tr>` +
    D.curated_calendar.map((e) => `<tr><td>${esc(e.at ? fmtLocal(Date.parse(e.at)) : e.date)}</td><td><b>${esc(e.ccy)}</b></td><td>${esc(e.ev)}</td><td>${dot(e.imp)}</td></tr>`).join("") + `</table></div>`;
  $("b_calendar").innerHTML = h;
}
function rNews() {
  if (!st.news) { if (!st.newsRendered) $("b_news").innerHTML = `<span class="dn">News feed unavailable.</span>`; return; }
  st.newsRendered = true; const re = /gold|xau|silver|dollar|usd|fed|warsh|yield|treasur|inflation|cpi|pce|oil|iran|eur|gbp|jpy|yen|boj|ecb|boe|rba/i;
  let items = st.news.filter((i) => re.test(i.title)); if (items.length < 5) items = st.news;
  $("b_news").innerHTML = `<div class="news">${items.slice(0, 10).map((i) => `<div class="n"><span class="t">${esc((i.pubDate || "").slice(5, 16))}</span><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></div>`).join("")}</div><div class="asof">FXStreet RSS via rss2json (UTC times), filtered for macro/FX/gold keywords.</div>`;
}
const SESS = [["SYDNEY", "Australia/Sydney", 7, 16], ["TOKYO", "Asia/Tokyo", 9, 18], ["LONDON", "Europe/London", 8, 17], ["NEW YORK", "America/New_York", 8, 17]];
function zoneParts(tz) { const p = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).forEach((x) => (p[x.type] = x.value)); return { wd: p.weekday, h: +p.hour % 24, m: +p.minute }; }
function rSessions() {
  const ny = zoneParts("America/New_York"); const nyMin = ny.h * 60 + ny.m;
  const fxClosed = ny.wd === "Sat" || (ny.wd === "Sun" && nyMin < 17 * 60) || (ny.wd === "Fri" && nyMin >= 17 * 60);
  $("b_sessions").innerHTML = SESS.map(([n, tz, o, c]) => { const z = zoneParts(tz), mins = z.h * 60 + z.m, open = !fxClosed && !["Sat", "Sun"].includes(z.wd) && mins >= o * 60 && mins < c * 60;
    const prog = open ? ((mins - o * 60) / ((c - o) * 60)) * 100 : 0;
    return `<div class="ses"><span><b>${n}</b></span><div class="pb"><i style="width:${prog}%"></i></div><span class="${open ? "up" : "dim"}" style="text-align:right">${open ? "OPEN" : "CLOSED"}</span></div><div class="dim" style="font:11px var(--mono);margin:-2px 0 4px">${z.wd} ${pad(z.h)}:${pad(z.m)} local · ${pad(o)}:00–${c}:00</div>`; }).join("") +
    `<div class="asof">${fxClosed ? '<span class="dn">FX & spot gold closed for the weekend (reopen Sun 17:00 New York). PAXG/BTC still trade 24/7.</span>' : '<span class="up">FX market open.</span>'} Approximate cash-session hours.</div>`;
  const f = $("f_sessions"); if (f) f.textContent = "clock";
}
function rFlows() {
  const f = D.flows, r = D.risk, q = st.q || {};
  const oil = q["@LCO.1"] && q["@CL.1"] ? `$${fx(q["@LCO.1"].last)} / $${fx(q["@CL.1"].last)} <span class="dim">live</span>` : `$${r.brent} / $${r.wti}`;
  $("b_flows").innerHTML = `<table><tr><td>Gold ETFs ${f.etf_month}</td><td class="r up">+$${f.etf_month_usd_bn}bn</td></tr><tr><td>Gold ETFs Q3</td><td class="r up">+$${f.etf_q3_usd_bn}bn (record)</td></tr><tr><td>ETF holdings</td><td class="r">${fx(f.etf_holdings_t, 0)}t (record)</td></tr>
  <tr><td>Central banks ${f.cb_month}</td><td class="r up">+${f.cb_net_t}t</td></tr><tr><td>PBoC ${f.pboc_month}</td><td class="r up">+${f.pboc_t}t · ${f.pboc_streak_m}-mo streak</td></tr>
  <tr><td>Brent / WTI</td><td class="r">${oil}</td></tr><tr><td>US HY spread (${r.asof})</td><td class="r dn">${r.hy_spread_bp}bp (${sgn(r.hy_chg_bp, 0)})</td></tr></table>
  <div style="margin-top:6px">${r.headlines.map((h) => `<div class="dim" style="font-size:12px">• ${esc(h)}</div>`).join("")}</div><div class="asof">${esc(f.asof)} (manual). HY spread manual (FRED blocked from the build box). Oil live via CNBC when available.</div>`;
}
function rRules() {
  $("b_rules").innerHTML = `<div class="rules"><h4>GOLD SCORECARD (sum of categories; categories with missing data are excluded from the max)</h4><ul>${GOLD_RULES.map((r) => `<li><b>${esc(r.name)}</b> [${r.src}, ±${r.max}]: ${esc(r.rule)}</li>`).join("")}</ul>
  <h4>VERDICT</h4><ul><li>score/max ≥ +35% BULLISH · ≥ +12% LEAN BULLISH · ≤ −12% LEAN BEARISH · ≤ −35% BEARISH · otherwise NEUTRAL.</li></ul>
  <h4>CURRENCY STRENGTH (±${CCY_MAX} per currency)</h4><ul>${CCY_RULES.map((r) => `<li><b>${esc(r.name)}</b> [${r.src}, ±${r.max}]: ${esc(r.rule)}</li>`).join("")}</ul>
  <h4>SMC OVERLAY (same logic as the MT5 indicator)</h4><ul><li>Swing high/low: bar higher/lower than N bars on each side (N = SWING 3/5/8), confirmed N bars later. HH/LH vs previous swing high, HL/LL vs previous swing low.</li>
  <li>BOS = close beyond the latest unbroken swing in the trend direction; CHoCH = first close beyond it against the prior trend.</li><li>Order block = last opposite-colour candle at/before the start of the breaking leg; removed once a close goes through it. FVG = 3-candle gap (low[k] > high[k-2] or high[k] < low[k-2]); removed when fully filled.</li>
  <li>EQH/EQL = two swings within 10% of ATR(14) with no breach between them; "$$$" = resting liquidity, "swept" = wick through and close back, "taken" = closed through.</li><li>Fib on the latest leg (leg start → extreme since): 0.5 equilibrium, OTE 0.618/0.705/0.786, extension 1.618.</li></ul>
  <h4>CONFLUENCE</h4><ul><li>Combined = (fundamental + technical) / 2. ALIGNED when both agree with |each| ≥ 20%; CONFLICT when they disagree with |each| ≥ 20%; otherwise MIXED.</li></ul>
  <h4>PAIRS / PLAYBOOK</h4><ul><li>Pair score = base score − quote score (±${CCY_MAX * 2}). |score| ≥ 6 STRONG, ≥ 3 normal, ≥ 1 WEAK, else NEUTRAL. Conviction tier: HIGH ≥ 6, MEDIUM ≥ 3, LOW otherwise.</li>
  <li>These are mechanical, backward-looking rules for learning. They are not forecasts and ignore risk management and event risk.</li></ul></div>`;
}
function rNA() {
  const m = { na_options: "Options flow / unusual activity", na_retail: "Broker retail positioning (long/short %)", na_liq: "Order-book / stop-cluster liquidity map", na_smart: "Dark-pool & block-trade data" };
  Object.entries(m).forEach(([id, t]) => ($("b_" + id).innerHTML = `<div class="nabox"><div><b>Not available (paid data)</b>${esc(t)} needs a licensed or login-only feed. No free keyless browser source. (Chart EQH/EQL lines show price-based liquidity.)</div></div>`));
}
function rFeeds() {
  const rows = Object.values(st.feeds).map((v) => `<tr><td>${esc(v.label)}${v.info ? `<br><span class="dim" style="font-size:10.5px">${esc(v.info)}</span>` : ""}</td><td class="r ${v.ok ? "up" : "dn"}">${v.ok ? "OK" : "FAILED"}</td><td class="r dim">${v.okAt ? hms(v.okAt) : "never"}</td></tr>`).join("");
  const a = D.auto || {}, bs = ["forexfactory", "treasury", "bls", "cnbc"].map((k) => `${k}: ${a[k] ? (a[k].ok ? "ok " : "FAILED ") + (a[k].at || "") : "n/a"}`).join(" · ");
  $("b_feeds").innerHTML = `<div class="scroll"><table class="feeds"><tr><th>LIVE FEED (BROWSER)</th><th class="r">STATE</th><th class="r">LAST OK</th></tr>${rows}</table></div>
  <div class="asof">Daily file: ${esc(D.meta.asof)}<br>Build fetches: ${esc(bs)}<br>Refresh every 5 min (retry after 60 s on failure, and on tab focus / reconnect). ECB FX, COT & XAU daily every 30 min; Treasury curve hourly. Page reloads itself every 6 h to pick up a rebuilt daily file.</div>`;
}
function rTicker(sc) {
  const it = [], q = st.q || {}; const add = (n, v, ch, unit = "%") => it.push(`<span class="tk"><b>${n}</b>${v}${ch == null ? "" : ` <span class="${unit === "bp" ? cls(-ch) : cls(ch)}">${ch > 0 ? "▲" : ch < 0 ? "▼" : "■"} ${sgn(ch, unit === "bp" ? 1 : 2)}${unit}</span>`}</span>`);
  const gp = goldPx(), ref = goldRef(); if (gp) add("XAU/USD", fx(gp.px), (gp.px / ref.v - 1) * 100);
  if (st.silver) add("XAG/USD", fx(st.silver.px), q["XAG="] ? q["XAG="].chp : null);
  if (q["@GC.1"]) add("GC FUT", fx(q["@GC.1"].last), q["@GC.1"].chp);
  if (st.paxg) add("PAXG", fx(st.paxg), null);
  if (q[".DXY"]) add("DXY", fx(q[".DXY"].last, 3), q[".DXY"].chp);
  const L = liveFX();
  [["EUR/USD", "EUR", 1, 4], ["GBP/USD", "GBP", 1, 4], ["USD/JPY", "JPY", 0, 2], ["USD/CHF", "CHF", 0, 4], ["USD/CAD", "CAD", 0, 4], ["AUD/USD", "AUD", 1, 4], ["NZD/USD", "NZD", 1, 4]].forEach(([n, c, inv, d]) => {
    if (L && !L.filled.includes(c)) { const v = inv ? 1 / L.r[c] : L.r[c], p = L.p[c] ? (inv ? 1 / L.p[c] : L.p[c]) : null; add(n, fx(v, d), p ? (v / p - 1) * 100 : null); }
    else if (st.fx) { const R = st.fx.r, b = R[R.length - 1], a = R[R.length - 2], f = (r) => (inv ? 1 / r[c] : r[c]); add(n + "*", fx(f(b), d), (f(b) / f(a) - 1) * 100); } });
  ["US2Y", "US10Y", "US30Y"].forEach((s) => { if (q[s]) add(s, q[s].last.toFixed(3) + "%", q[s].ch * 100, "bp"); });
  if (!q.US10Y) add("US10Y", ratesNow().rows[2].value.toFixed(2) + "%", null);
  const real = ratesNow().rows.find((r) => /real/i.test(r.name)); if (real) add("10Y REAL", real.value.toFixed(2) + "%", null);
  if (q["@CL.1"]) add("WTI", fx(q["@CL.1"].last), q["@CL.1"].chp); if (q["@LCO.1"]) add("BRENT", fx(q["@LCO.1"].last), q["@LCO.1"].chp);
  if (q[".SPX"]) add("S&P 500", fx(q[".SPX"].last), q[".SPX"].chp); if (q[".VIX"]) add("VIX", fx(q[".VIX"].last), q[".VIX"].chp);
  if (st.btc) add("BTC", fx(st.btc.px, 0), q["BTC.CB="] ? q["BTC.CB="].chp : null);
  if (sc) { const top = CCYS.slice().sort((a, b) => sc[b].total - sc[a].total); it.push(`<span class="tk"><b>STRONGEST</b><span class="up">${top[0]}</span> · <b>WEAKEST</b><span class="dn">${top[7]}</span></span>`); }
  const html = it.join("") + `<span class="tk dim">Quotes: CNBC public feed (unofficial) · FX fallback Kraken · * = ECB daily fix · gold spot gold-api.com</span>`;
  $("tickTrack").innerHTML = html + html;
}
function rBrief(G, sc, P) {
  const [v] = verdict(G.pct); const sup = G.rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score), ag = G.rows.filter((r) => r.score < 0).sort((a, b) => a.score - b.score);
  const order = CCYS.slice().sort((a, b) => sc[b].total - sc[a].total); const cs = cotStats(); const g = cs && cs.XAU; const gp = goldPx(), ref = goldRef(), RN = ratesNow(), q = st.q || {};
  const nh = nextHigh(); const s4 = st.smc["4H"], s1 = st.smc["1D"];
  $("b_brief").innerHTML = `<div class="brief"><p><b class="or">GOLD:</b> Spot ${gp ? fx(gp.px) : "n/a"} (${gp ? sgn((gp.px / ref.v - 1) * 100) + "% vs " + ref.lbl : "stale"}). The rule-based scorecard reads <b>${v}</b> (${sgn(G.total, 0)}/${G.max}).
  Main supports: ${sup.slice(0, 3).map((r) => r.name.toLowerCase()).join(", ") || "none"}. Main headwinds: ${ag.slice(0, 3).map((r) => r.name.toLowerCase()).join(", ") || "none"}.</p>
  <p><b class="or">STRUCTURE:</b> 1D ${esc(biasTxt(s1))}; 4H ${esc(biasTxt(s4))}.</p>
  <p><b class="or">POSITIONING:</b> ${g ? `Speculators net long ${fx(g.net, 0)} gold contracts (${g.pct.toFixed(0)}th percentile of 52w, w/w ${sgn(g.chg, 0)}, report ${g.date}).` : "COT n/a."}</p>
  <p><b class="or">FX:</b> Strongest ${order[0]} (${sgn(sc[order[0]].total, 0)}), ${order[1]} (${sgn(sc[order[1]].total, 0)}); weakest ${order[7]} (${sgn(sc[order[7]].total, 0)}), ${order[6]} (${sgn(sc[order[6]].total, 0)}). Widest divergence: <b>${P[0].pair}</b> ${sgn(P[0].score, 0)} (${pairLabel(P[0].score)}).</p>
  <p><b class="or">RATES:</b> 10Y ${q.US10Y ? q.US10Y.last.toFixed(3) + "% (live)" : RN.rows[2].value + "%"} · 10Y real ${RN.rows[4].value}% (${esc(RN.asof)}) · DXY ${q[".DXY"] ? fx(q[".DXY"].last, 2) : D.us_rates.dxy_actual.value} · Fed Oct 28 hike odds ~${D.fed.next_hike_prob}% (manual), Dec ~${D.fed.dec_hike_prob}%.</p>
  <p><b class="or">NEXT CATALYST:</b> ${nh ? `${esc(nh.ccy)} ${esc(nh.title)} · ${fmtLocal(nh.t)}` : "n/a"}.</p><p class="dim" style="font-size:11px">Auto-generated from the rules and data on this page. Educational, not financial advice.</p></div>`;
}
function rPlaybook(G, sc, P) {
  const [v, c] = verdict(G.pct); const tier = (a) => (a >= 6 ? "HIGH" : a >= 3 ? "MEDIUM" : "LOW");
  const drivers = (p) => { const b = sc[p.b].comp, q = sc[p.q].comp; return CCY_RULES.map((r) => r.k).map((k) => { const d = (b[k] || 0) - (q[k] || 0); return d ? `${k.toUpperCase()} ${sgn(d, 0)}` : null; }).filter(Boolean).join(" · "); };
  const gTop = G.rows.filter((r) => r.score !== 0 && !r.na).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3).map((r) => `${r.name} ${sgn(r.score, 0)}`).join(" · ");
  $("b_playbook").innerHTML = `<div class="scroll"><table><tr><th>#</th><th>MARKET</th><th>BIAS</th><th class="r">SCORE</th><th>CONVICTION</th><th>KEY DRIVERS</th></tr>
  <tr><td class="dim">G</td><td><b>XAU/USD</b></td><td><span class="pill ${c}">${v}</span></td><td class="r ${cls(G.total)}">${sgn(G.total, 0)}/${G.max}</td><td>${tier(Math.abs((G.total / G.max) * 14))}</td><td class="dim">${esc(gTop)}</td></tr>` +
    P.slice(0, 6).map((p, i) => `<tr><td class="dim">${i + 1}</td><td><b>${p.pair}</b></td><td><span class="pill ${cls(p.score)}">${p.score > 0 ? "LONG BIAS" : p.score < 0 ? "SHORT BIAS" : "FLAT"}</span></td><td class="r ${cls(p.score)}">${sgn(p.score, 0)}</td><td>${tier(Math.abs(p.score))}</td><td class="dim">${esc(drivers(p))}</td></tr>`).join("") +
    `</table></div><div class="asof dn">EDUCATIONAL, NOT FINANCIAL ADVICE. Bias = direction implied by the mechanical scores only. Confirm with structure (chart SMC overlay), event risk and position sizing.</div>`;
}

/* ------------------------------------------------------------ alerts + sound */
const AKEY = "rezan_mt_alerts_v1";
function alertCfg() { try { return Object.assign({ on: false, above: null, below: null, pair: 6, sound: true, ev: true, fired: {} }, JSON.parse(localStorage.getItem(AKEY) || "{}")); } catch (e) { return { on: false, fired: {} }; } }
function saveCfg(c) { try { localStorage.setItem(AKEY, JSON.stringify(c)); } catch (e) {} }
let actx = null;
function beep(kind) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const seq = kind === "urgent" ? [880, 660, 880, 660] : [660, 990];
  seq.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime + i * 0.22; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.21); }); } catch (e) {} }
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 8000); }
function notify(msg, kind) { toast("🔔 " + msg); const c = alertCfg(); if (c.sound) beep(kind);
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("Rezan Macro Terminal", { body: msg }); } catch (e) {} }
function rAlerts() {
  const c = alertCfg();
  $("b_alerts").innerHTML = `<div class="al"><label><input type="checkbox" id="al_on" ${c.on ? "checked" : ""}> Price / pair alerts enabled</label>
  <label>Gold above <input type="number" id="al_above" step="1" value="${c.above ?? ""}" placeholder="e.g. 4215"></label>
  <label>Gold below <input type="number" id="al_below" step="1" value="${c.below ?? ""}" placeholder="e.g. 4075"></label>
  <label>Pair |score| ≥ <input type="number" id="al_pair" step="1" value="${c.pair ?? 6}"></label>
  <label><input type="checkbox" id="al_ev" ${c.ev ? "checked" : ""}> Warn 30 min & 5 min before high-impact events</label>
  <label><input type="checkbox" id="al_snd" ${c.sound ? "checked" : ""}> Sound</label>
  <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn sm" id="al_save">SAVE</button><button class="btn ghost sm" id="al_test">TEST SOUND</button><button class="btn ghost sm" id="al_perm">BROWSER NOTIFICATIONS</button></div>
  <div class="asof">Checked on every refresh (prices) and every second (event countdown) while this page is open. Fires once per crossing. Browsers need one click on the page before sound can play. Notification permission: ${"Notification" in window ? esc(Notification.permission) : "unsupported"}.</div></div>`;
  $("al_save").onclick = () => { const n = (id) => { const v = $(id).value; return v === "" ? null : +v; };
    const c2 = alertCfg(); Object.assign(c2, { on: $("al_on").checked, above: n("al_above"), below: n("al_below"), pair: n("al_pair"), ev: $("al_ev").checked, sound: $("al_snd").checked, fired: {} }); saveCfg(c2); toast("Alerts saved"); };
  $("al_test").onclick = () => beep("urgent");
  $("al_perm").onclick = () => { if ("Notification" in window) Notification.requestPermission().then(() => rAlerts()); };
}
function checkAlerts(P) {
  const c = alertCfg(); if (!c.on) return; const f = c.fired || {}; const gp = goldPx(), px = gp && gp.px;
  const fire = (key, cond, msg) => { if (cond && !f[key]) { f[key] = 1; notify(msg); } else if (!cond) delete f[key]; };
  if (px && c.above != null) fire("above", px >= c.above, `Gold ${fx(px)} is above ${c.above}`);
  if (px && c.below != null) fire("below", px <= c.below, `Gold ${fx(px)} is below ${c.below}`);
  if (c.pair != null && P) P.forEach((p) => fire("p_" + p.pair, Math.abs(p.score) >= c.pair, `${p.pair} score ${sgn(p.score, 0)} (${pairLabel(p.score)})`));
  c.fired = f; saveCfg(c);
}
function tickEvents() {
  const nh = nextHigh(), now = Date.now(), el = $("nexthi");
  if (!nh) { el.textContent = ""; el.className = "nexthi"; } else { const left = nh.t - now; el.className = "nexthi" + (left < 30 * 60e3 ? " soon" : "");
    el.innerHTML = `<span class="lbl">NEXT HIGH:</span> ${esc(nh.ccy)} ${esc(nh.title.length > 26 ? nh.title.slice(0, 25) + "…" : nh.title)} <b>${left <= 0 ? "NOW" : dur(left)}</b>`;
    const c = alertCfg(); if (c.ev) { const key = "ev_" + nh.t, f = c.fired || {};
      [[30, "30 min"], [5, "5 min"]].forEach(([m, lbl]) => { if (left > 0 && left <= m * 60e3 && !f[key + m]) { f[key + m] = 1; c.fired = f; saveCfg(c); notify(`${nh.ccy} ${nh.title} in ${lbl}`, "urgent"); } }); } }
  document.querySelectorAll("[data-cd]").forEach((x) => { const l = +x.dataset.cd - now; x.textContent = l <= 0 ? "NOW" : dur(l); const p = x.closest(".cd"); if (p) p.classList.toggle("soon", l < 30 * 60e3); });
}

/* ------------------------------------------------------------ per-card freshness */
function rFresh() {
  MODULES.forEach((m) => { const el = $("f_" + m.id); if (!el || m.clock) return;
    if (m.daily) { const t = String(m.daily() || ""), d = t.match(/\d{4}-\d{2}-\d{2}/); el.textContent = d ? "data " + d[0].slice(5) : "manual"; el.title = t; el.className = "fr"; return; }
    if (!m.feeds) { el.textContent = ""; return; }
    const keys = m.id === "chart" ? (st.chartSrc === "XAU" ? ["xauH", "xauD"] : ["pxH", "pxD"]) : m.feeds;
    const fs = keys.map((k) => st.feeds[k]).filter(Boolean); if (!fs.length) { el.textContent = ""; return; }
    const oks = fs.filter((f) => f.okAt).map((f) => f.okAt.getTime()); const bad = fs.some((f) => !f.ok);
    el.className = "fr" + (bad ? " stale" : ""); el.textContent = oks.length ? (bad ? "STALE · " : "⟳ ") + hm(new Date(Math.min(...oks))) : "NO DATA";
    el.title = fs.map((f) => `${f.label}: ${f.ok ? "ok" : "failed"} ${f.okAt ? "last ok " + hms(f.okAt) : ""}`).join("\n"); });
}

/* ------------------------------------------------------------ main loop */
function renderAll() {
  const safe = (fn, id) => { try { fn(); } catch (e) { console.error("render " + id, e); const el = $("b_" + id); if (el) el.innerHTML = `<span class="dn">Render error: ${esc(e.message)}</span>`; } };
  let G = null, sc = null, P = null;
  safe(smcAll, "chart");
  safe(() => { G = goldScore(); rScore(G); }, "score");
  safe(() => rFund(G), "fund"); safe(() => rConf(G), "conf");
  safe(() => { sc = ccyScores(); rStrength(sc); P = pairs(sc); rHeatmap(sc, P); }, "strength");
  safe(rCOT, "cot"); safe(rChart, "chart"); safe(rMarkets, "markets"); safe(rCorr, "corr"); safe(rRates, "rates"); safe(rRegime, "regime"); safe(rFed, "fed");
  safe(rSurprise, "surprise"); safe(rCalendar, "calendar"); safe(rNews, "news"); safe(rFlows, "flows"); safe(rRules, "rules"); safe(rNA, "na_options"); safe(rFeeds, "feeds");
  if (G && sc && P) { safe(() => rBrief(G, sc, P), "brief"); safe(() => rPlaybook(G, sc, P), "playbook"); }
  safe(() => rTicker(sc), "ticker"); safe(rFresh, "feeds"); checkAlerts(P);
  window.__rezan = { G, sc, P, smc: st.smc };
}
const JOBS = [
  ["gold", "XAU spot (gold-api.com)", fGold], ["silver", "XAG spot (gold-api.com)", fSilver], ["quotes", "Cross-asset quotes (CNBC, unofficial)", fQuotes],
  ["kraken", "FX intraday fallback (Kraken)", fKraken], ["btc", "BTC-USD (Coinbase)", fBtc], ["paxg", "PAXG spot (Coinbase)", fPaxg],
  ["xauH", "XAU 1H → 1H/4H (CNBC chart)", fXauH], ["xauD", "XAU daily (CNBC chart)", fXauD, 30], ["pxH", "PAXG 1H x600 (Coinbase)", fPxH], ["pxD", "PAXG 1D (Coinbase)", fPxD, 30],
  ["news", "News (FXStreet/rss2json)", fNews], ["fx", "FX series (Frankfurter/ECB)", fFX, 30], ["cot", "COT (CFTC public API)", fCOT, 30], ["tsy", "US yields (Treasury XML)", fTsy, 60, true]];
let busy = false, nextAt = 0, timer = null, retryT = null, lastRun = 0;
const due = (j, force) => force || !j[3] || !st.feeds[j[0]] || !st.feeds[j[0]].okAt || Date.now() - st.feeds[j[0]].okAt > j[3] * 60e3;
async function runJobs(list) { const res = await Promise.allSettled(list.map((j) => j[2]()));
  res.forEach((r, i) => { const j = list[i]; feed(j[0], j[1], r.status === "fulfilled", r.status === "fulfilled" ? (typeof r.value === "string" ? r.value : "") : String((r.reason && r.reason.message) || r.reason)); if (r.status === "rejected") console.warn("feed failed:", j[1], r.reason); });
  return list.filter((j, i) => res[i].status === "rejected").map((j) => j[1].split(" (")[0]); }
function setStatus(failed) {
  const goldOk = (st.feeds.gold && st.feeds.gold.ok) || (st.feeds.quotes && st.feeds.quotes.ok && st.q && st.q["XAU="]);
  $("light").className = "light " + (!goldOk ? "bad" : failed.length ? "warn" : "ok");
  if (goldOk) { $("livestate").textContent = failed.length ? `LIVE · partial (${failed.length} feed${failed.length > 1 ? "s" : ""} stale)` : "LIVE"; $("livestate").title = failed.join(", "); $("livestate").className = ""; $("lastupd").textContent = hms(new Date()); }
  else { $("livestate").textContent = "STALE · fetch failed"; $("livestate").className = "stale"; }
  window.__liveStatus = { goldOk: !!goldOk, failed, at: Date.now() };
}
async function refresh(force) {
  if (busy) return; busy = true; lastRun = Date.now(); $("light").className = "light warn"; $("livestate").textContent = "UPDATING"; $("livestate").className = "";
  const fast = JOBS.filter((j) => !j[4] && due(j, force)), slow = JOBS.filter((j) => j[4] && due(j, force));
  const slowP = slow.length ? runJobs(slow) : Promise.resolve([]);
  let failed = await runJobs(fast); renderAll(); setStatus(failed.concat(st.slowFailed || []));
  slowP.then((sf) => { st.slowFailed = sf; if (slow.length) { renderAll(); setStatus(failed.concat(sf)); } });
  clearTimeout(retryT); if (failed.length) retryT = setTimeout(() => refresh(false), 60e3);
  busy = false;
}
function schedule() { clearInterval(timer); nextAt = Date.now() + INTERVAL; timer = setInterval(() => { nextAt = Date.now() + INTERVAL; refresh(false); }, INTERVAL); }
// 24/7 robustness: background tabs throttle timers -> refresh on focus/reconnect; reload every 6h (hosted copy may have a newer daily build)
const loadedAt = Date.now(); let lastInput = Date.now();
["pointerdown", "keydown", "wheel"].forEach((e) => window.addEventListener(e, () => (lastInput = Date.now()), { passive: true }));
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastRun > INTERVAL) { refresh(false); schedule(); } });
window.addEventListener("online", () => { refresh(true); schedule(); });
setInterval(() => { if (Date.now() - loadedAt > 6 * 3600e3 && Date.now() - lastInput > 5 * 60e3 && navigator.onLine) location.reload(); }, 10 * 60e3);
let rz = null; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { try { rChart(); } catch (e) {} }, 300); });
buildShell(); rAlerts(); rSessions(); tickEvents();
setInterval(() => { const s = Math.max(0, Math.round((nextAt - Date.now()) / 1000)); $("nextin").textContent = Math.floor(s / 60) + ":" + pad(s % 60); rSessions(); tickEvents(); }, 1000);
refresh(true); schedule();
})();
