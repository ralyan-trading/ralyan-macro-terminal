#!/usr/bin/env python3
"""Ralyan Macro Terminal builder - safe to run unattended (cron / GitHub Actions).

Every run it re-fetches what is publicly available WITHOUT keys and stamps dates:
  1. ForexFactory weekly calendar JSON (no browser CORS, so it is pulled here)
  2. U.S. Treasury daily nominal + real yield curves  -> us_rates (w/w change, 10Y breakeven = nominal - real)
  3. BLS public API v1 (CPI, core CPI, payrolls, unemployment, AHE) -> us_data actuals + us_actuals for the calendar
  4. CNBC public quote feed (unofficial) -> DXY close, Brent/WTI
Then it inlines src/style.css + data.json + src/app.js into one self-contained index.html.
Any fetch that fails keeps the previous value (logged in data.json -> auto.failures). Manual sections
(policy rates, Fed odds, WGC flows, HY spread, forecasts) are left untouched and flagged if older than 7 days.

Usage: python3 build.py [--no-fetch]      (stdlib only; exit code 0 unless the page itself cannot be written)
"""
import json, os, re, sys, urllib.request, urllib.parse, datetime as dt
D = os.path.dirname(os.path.abspath(__file__))
data_path = os.path.join(D, "data.json")
data = json.load(open(data_path))
UTC = dt.timezone.utc
now = dt.datetime.now(UTC)
stamp = now.strftime("%Y-%m-%d %H:%M UTC")
UA = {"User-Agent": "Mozilla/5.0 (RalyanMacroTerminal build)"}
auto = data.setdefault("auto", {})
auto["failures"] = []
log = lambda *a: print("[build]", *a)


def get(url, timeout=45, body=None, headers=None):
    h = dict(UA); h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def step(name):
    def deco(fn):
        def run():
            try:
                msg = fn(); auto[name] = {"ok": True, "at": stamp, "info": msg or ""}; log(name, "OK", msg or "")
            except Exception as ex:  # keep previous data
                auto["failures"].append(f"{name}: {ex}"); prev = auto.get(name, {})
                auto[name] = {"ok": False, "at": prev.get("at"), "info": f"failed {stamp}: {ex}"}; log(name, "FAILED -", ex)
        return run
    return deco


@step("forexfactory")
def ff():
    ev = json.loads(get(data["ff_calendar"]["source"], 30))
    keep = ("title", "country", "date", "impact", "forecast", "previous", "actual")
    data["ff_calendar"]["events"] = [{k: e.get(k, "") for k in keep if k != "actual" or e.get("actual")} for e in ev]
    data["ff_calendar"]["fetched_at"] = stamp
    return f"{len(ev)} events"


def tsy_month(kind, ym):
    xml = get(f"{data['live_sources']['treasury']}?data={kind}&field_tdr_date_value_month={ym}", 90)
    rows = []
    for ent in re.findall(r"<m:properties>(.*?)</m:properties>", xml, re.S):
        f = dict(re.findall(r"<d:(\w+)[^>]*>([^<]*)<", ent))
        if f.get("NEW_DATE"): rows.append(f)
    return rows


@step("treasury")
def treasury():
    months = [now.strftime("%Y%m"), (now.replace(day=1) - dt.timedelta(days=1)).strftime("%Y%m")]
    nom, real = [], []
    for ym in reversed(months):
        nom += tsy_month("daily_treasury_yield_curve", ym); real += tsy_month("daily_treasury_real_yield_curve", ym)
    nom.sort(key=lambda r: r["NEW_DATE"]); real.sort(key=lambda r: r["NEW_DATE"])
    if len(nom) < 6 or len(real) < 6: raise RuntimeError("too few observations")
    def wk(pts):  # pts = [(date, value)] sorted; w/w = vs latest observation on/before the same day last week
        d0 = dt.date.fromisoformat(pts[-1][0][:10]) - dt.timedelta(days=7)
        ref = [v for d, v in pts if dt.date.fromisoformat(d[:10]) <= d0]
        return round((pts[-1][1] - ref[-1]) * 100) if ref else None
    def row(name, series, key):
        pts = [(r["NEW_DATE"], float(r[key])) for r in series if r.get(key)]
        return {"name": name, "value": pts[-1][1], "chg_bp": wk(pts)}
    rmap = {r["NEW_DATE"]: float(r["TC_10YEAR"]) for r in real if r.get("TC_10YEAR")}
    be = [(n["NEW_DATE"], float(n["BC_10YEAR"]) - rmap[n["NEW_DATE"]]) for n in nom if n["NEW_DATE"] in rmap]
    rows = [row("US 3M", nom, "BC_3MONTH"), row("US 2Y", nom, "BC_2YEAR"), row("US 10Y", nom, "BC_10YEAR"), row("US 30Y", nom, "BC_30YEAR"),
            row("US 10Y real (TIPS)", real, "TC_10YEAR"),
            {"name": "US 10Y breakeven", "value": round(be[-1][1], 2), "chg_bp": wk(be)}]
    last = nom[-1]["NEW_DATE"][:10]
    data["us_rates"].update({"rows": rows, "asof": f"{last} close (real {real[-1]['NEW_DATE'][:10]})",
                             "source": "U.S. Treasury daily par & real yield curves (auto); breakeven = 10Y nominal - 10Y real; w/w = vs same weekday a week earlier"})
    return f"10Y {rows[2]['value']} real {rows[4]['value']} as of {last}"


BLS = {"cpi_nsa": "CUUR0000SA0", "cpi_sa": "CUSR0000SA0", "core_nsa": "CUUR0000SA0L1E", "core_sa": "CUSR0000SA0L1E",
       "nfp": "CES0000000001", "ur": "LNS14000000", "ahe": "CES0500000003"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@step("bls")
def bls():
    body = json.dumps({"seriesid": list(BLS.values()), "startyear": str(now.year - 2), "endyear": str(now.year)}).encode()
    j = json.loads(get("https://api.bls.gov/publicAPI/v1/timeseries/data/", 60, body, {"Content-Type": "application/json"}))
    if j.get("status") != "REQUEST_SUCCEEDED": raise RuntimeError(j.get("message"))
    S = {}
    for s in j["Results"]["series"]:
        S[s["seriesID"]] = {(int(x["year"]), int(x["period"][1:])): float(x["value"]) for x in s["data"] if x["period"].startswith("M") and x["period"] != "M13" and x["value"] not in ("-", "")}
    def ser(k): return S[BLS[k]]
    def latest(k): return max(ser(k))
    def back(p, n):
        y, m = p; m -= n
        while m <= 0: m += 12; y -= 1
        return (y, m)
    def yoy(k, p): s = ser(k); return round((s[p] / s[back(p, 12)] - 1) * 100, 1)
    def mom(k, p): s = ser(k); return round((s[p] / s[back(p, 1)] - 1) * 100, 1)
    p = latest("cpi_nsa"); pj = latest("nfp")
    vals = {  # name prefix -> (actual, prior, period, unit)
        "CPI y/y": (yoy("cpi_nsa", p), yoy("cpi_nsa", back(p, 1)), p, "%"),
        "Core CPI y/y": (yoy("core_nsa", p), yoy("core_nsa", back(p, 1)), p, "%"),
        "CPI m/m": (mom("cpi_sa", p), mom("cpi_sa", back(p, 1)), p, "%"),
        "Core CPI m/m": (mom("core_sa", p), mom("core_sa", back(p, 1)), p, "%"),
        "Nonfarm payrolls": (round(ser("nfp")[pj] - ser("nfp")[back(pj, 1)]), round(ser("nfp")[back(pj, 1)] - ser("nfp")[back(pj, 2)]), pj, "k"),
        "Unemployment rate": (ser("ur")[pj], ser("ur")[back(pj, 1)], pj, "%"),
        "Avg hourly earnings y/y": (yoy("ahe", pj), yoy("ahe", back(pj, 1)), pj, "%"),
    }
    changed = []
    for r in data["us_data"]["rows"]:
        for pref, (a, pr, per, unit) in vals.items():
            if re.sub(r" \(.*\)$", "", r["name"]) != pref: continue
            label = f"{pref} ({MON[per[1] - 1]})"
            if r["name"] != label:  # new release month: forecast unknown until updated manually
                r["forecast"] = None; changed.append(label)
            r.update({"name": label, "actual": a, "prior": pr, "src": "BLS API (auto)", "period": f"{per[0]}-{per[1]:02d}"})
    # actuals for the calendar (FF free feed has no actuals): event title regex -> value for the data month
    data["us_actuals"] = {"source": "BLS public API v1", "fetched_at": stamp, "items": [
        {"re": r"^CPI y/y", "v": f"{vals['CPI y/y'][0]}%", "period": f"{p[0]}-{p[1]:02d}"},
        {"re": r"^Core CPI y/y", "v": f"{vals['Core CPI y/y'][0]}%", "period": f"{p[0]}-{p[1]:02d}"},
        {"re": r"^CPI m/m", "v": f"{vals['CPI m/m'][0]}%", "period": f"{p[0]}-{p[1]:02d}"},
        {"re": r"^Core CPI m/m", "v": f"{vals['Core CPI m/m'][0]}%", "period": f"{p[0]}-{p[1]:02d}"},
        {"re": r"^Non-Farm Employment Change", "v": f"{vals['Nonfarm payrolls'][0]}K", "period": f"{pj[0]}-{pj[1]:02d}"},
        {"re": r"^Unemployment Rate", "v": f"{vals['Unemployment rate'][0]}%", "period": f"{pj[0]}-{pj[1]:02d}"}]}
    if changed: data["us_data"]["asof"] = f"BLS auto-update {stamp} (new month: {', '.join(changed)} - forecasts n/a until entered)"
    return f"CPI {p} y/y {vals['CPI y/y'][0]} · NFP {pj} {vals['Nonfarm payrolls'][0]}k" + (f" · NEW: {changed}" if changed else "")


@step("cnbc")
def cnbc():
    syms = ".DXY|@LCO.1|@CL.1"
    j = json.loads(get(f"{data['live_sources']['cnbc_quote']}?symbols={urllib.request.quote(syms)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1", 30))
    q = {x["symbol"]: x for x in j["FormattedQuoteResult"]["FormattedQuote"]}
    num = lambda s: float(str(s).replace(",", "").replace("%", "").replace("+", ""))
    dx = q[".DXY"]
    data["us_rates"]["dxy_actual"] = {"value": round(num(dx["last"]), 2), "chg_pct_d": 0.0 if dx["change_pct"] == "UNCH" else num(dx["change_pct"]),
                                      "asof": str(dx.get("last_time", ""))[:10], "source": "CNBC quote feed (unofficial)"}
    data["us_rates"]["dxy_actual"].pop("chg_pct_w", None)
    data["risk"].update({"brent": num(q["@LCO.1"]["last"]), "wti": num(q["@CL.1"]["last"]), "oil_asof": str(q["@CL.1"].get("last_time", ""))[:10] + " (CNBC, front-month futures)"})
    return f"DXY {dx['last']} Brent {q['@LCO.1']['last']} WTI {q['@CL.1']['last']}"


# ---------------------------------------------------------------- v3: institutional positioning + market drivers
SOC = "https://publicreporting.cftc.gov/resource/"
TFF_CODES = {"USD": "098662", "EUR": "099741", "GBP": "096742", "JPY": "097741", "CHF": "092741", "CAD": "090741", "AUD": "232741", "NZD": "112741"}
I = lambda x: int(float(x or 0))


def soc(ds, where, select, limit=400):
    q = urllib.parse.urlencode({"$select": select, "$where": where, "$order": "report_date_as_yyyy_mm_dd ASC", "$limit": str(limit)})
    return json.loads(get(f"{SOC}{ds}.json?{q}", 60))


@step("cot_disagg")
def cot_disagg():
    """CFTC Disaggregated futures-only report for COMEX gold (088691): swap dealers / managed money / producers / other / small."""
    since = (now - dt.timedelta(days=7 * 26)).strftime("%Y-%m-%d")
    sel = ",".join(["report_date_as_yyyy_mm_dd", "open_interest_all", "change_in_open_interest_all",
                    "prod_merc_positions_long", "prod_merc_positions_short", "swap_positions_long_all", "swap__positions_short_all",
                    "m_money_positions_long_all", "m_money_positions_short_all", "other_rept_positions_long", "other_rept_positions_short",
                    "nonrept_positions_long_all", "nonrept_positions_short_all"])
    rows = soc("72hh-3qpy", f"cftc_contract_market_code='088691' AND report_date_as_yyyy_mm_dd >= '{since}T00:00:00.000'", sel)
    if len(rows) < 3: raise RuntimeError("too few rows")
    hist = []
    for r in rows:
        w = {"date": r["report_date_as_yyyy_mm_dd"][:10], "oi": I(r["open_interest_all"])}
        for k, (lk, sk) in {"swap": ("swap_positions_long_all", "swap__positions_short_all"), "mm": ("m_money_positions_long_all", "m_money_positions_short_all"),
                            "pm": ("prod_merc_positions_long", "prod_merc_positions_short"), "other": ("other_rept_positions_long", "other_rept_positions_short"),
                            "small": ("nonrept_positions_long_all", "nonrept_positions_short_all")}.items():
            w[k] = [I(r.get(lk)), I(r.get(sk))]
        hist.append(w)
    inst = data.setdefault("institutional", {})
    inst["gold_disagg"] = {"market": "GOLD - COMEX (088691)", "report": "CFTC Disaggregated, futures only (dataset 72hh-3qpy)",
                           "note": "Positions as of Tuesday, published Friday 3:30pm ET. [long, short] contracts (100 oz).", "fetched_at": stamp, "weeks": hist[-26:]}
    l = hist[-1]; return f"gold {l['date']} swap net {l['swap'][0]-l['swap'][1]} mm net {l['mm'][0]-l['mm'][1]}"


@step("cot_tff")
def cot_tff():
    """CFTC Traders in Financial Futures (futures only) for the USD index + 7 currency futures."""
    since = (now - dt.timedelta(days=7 * 14)).strftime("%Y-%m-%d")
    codes = ",".join(f"'{c}'" for c in TFF_CODES.values())
    sel = ",".join(["cftc_contract_market_code", "report_date_as_yyyy_mm_dd", "open_interest_all", "dealer_positions_long_all", "dealer_positions_short_all",
                    "asset_mgr_positions_long", "asset_mgr_positions_short", "lev_money_positions_long", "lev_money_positions_short"])
    rows = soc("gpe5-46if", f"cftc_contract_market_code in({codes}) AND report_date_as_yyyy_mm_dd >= '{since}T00:00:00.000'", sel, 1000)
    out = {}
    for ccy, code in TFF_CODES.items():
        rs = [r for r in rows if r["cftc_contract_market_code"] == code]
        out[ccy] = [{"date": r["report_date_as_yyyy_mm_dd"][:10], "oi": I(r["open_interest_all"]),
                     "dealer": [I(r.get("dealer_positions_long_all")), I(r.get("dealer_positions_short_all"))],
                     "am": [I(r.get("asset_mgr_positions_long")), I(r.get("asset_mgr_positions_short"))],
                     "lev": [I(r.get("lev_money_positions_long")), I(r.get("lev_money_positions_short"))]} for r in rs][-13:]
    got = [c for c in out if out[c]]
    if len(got) < 4: raise RuntimeError(f"only {got}")
    data.setdefault("institutional", {})["fx_tff"] = {"report": "CFTC Traders in Financial Futures, futures only (dataset gpe5-46if)", "fetched_at": stamp, "ccy": out,
                                                      "note": "Contract = the currency vs USD (USD = ICE US Dollar Index). Dealer = banks/dealers; Asset mgr = pensions, funds; Leveraged = hedge funds/CTAs."}
    return f"{len(got)} markets, last {out[got[0]][-1]['date']}"


MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def bpr_month(y, m):
    html = get(f"https://www.cftc.gov/MarketReports/BankParticipation/dea{MON3[m - 1]}{y % 100:02d}f", 45)
    d = re.search(r"REPORT DATE:\s*([0-9/]+)", re.sub(r"<[^>]+>", " ", html))
    i = html.find(">CMX GOLD<")
    if i < 0 or not d: raise RuntimeError("gold row not found")
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html[i - 80:i + 2500], re.S)[:3]
    cells = [[re.sub(r"<[^>]+>|&nbsp;|,", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)] for r in rows]
    n = lambda v: int(v) if v.isdigit() else None
    us, non, tot = cells[0][2:], cells[1][1:], cells[2][1:]  # count, long, %L, short, %S (+ OI on the U.S. row)
    mk = lambda c: {"banks": n(c[0]), "long": n(c[1]), "long_pct": float(c[2] or 0), "short": n(c[3]), "short_pct": float(c[4] or 0)}
    mo, da, yy = d.group(1).split("/")
    return {"report_date": f"{yy}-{int(mo):02d}-{int(da):02d}", "us": mk(us), "non_us": mk(non), "all": mk(tot), "oi": n(us[5]) if len(us) > 5 else None,
            "url": f"https://www.cftc.gov/MarketReports/BankParticipation/dea{MON3[m - 1]}{y % 100:02d}f"}


@step("bank_participation")
def bank_participation():
    """CFTC Bank Participation Report (monthly, futures): number of banks and their gold long/short."""
    got, y, m = [], now.year, now.month
    for _ in range(4):
        try: got.append(bpr_month(y, m))
        except Exception as ex: log("bpr", y, m, "skip:", ex)
        if len(got) == 2: break
        m -= 1
        if m == 0: m, y = 12, y - 1
    if not got: raise RuntimeError("no BPR page parsed")
    data.setdefault("institutional", {})["bank_participation"] = {"market": "CMX GOLD", "fetched_at": stamp, "latest": got[0], "previous": got[1] if len(got) > 1 else None,
        "note": "Monthly snapshot (first Tuesday of the month). Counts below 4 banks are hidden by the CFTC for confidentiality."}
    a = got[0]["all"]; return f"{got[0]['report_date']} {a['banks']} banks L {a['long']} S {a['short']}"


def cnbc_daily(sym):
    j = json.loads(get(f"{data['live_sources']['cnbc_chart']}1Y.json?symbol={urllib.parse.quote(sym)}", 45))
    out = {}
    for b in j["barData"]["priceBars"]:
        h, l, c = float(b["high"]), float(b["low"]), float(b["close"])
        if h > l or sym.startswith("US"): out[b["tradeTime"][:4] + "-" + b["tradeTime"][4:6] + "-" + b["tradeTime"][6:8]] = c
    return out


@step("market_hist")
def market_hist():
    """Daily closes (last ~70 sessions) used for 'why is it moving' and the timeline price reactions."""
    syms = {"XAU": "XAU=", "DXY": ".DXY", "US10Y": "US10Y", "US2Y": "US2Y", "WTI": "@CL.1", "SPX": ".SPX", "VIX": ".VIX", "EURUSD": "EUR=", "USDJPY": "JPY="}
    hist, bad = {}, []
    for k, s in syms.items():
        try:
            d = cnbc_daily(s); keys = sorted(d)[-70:]; hist[k] = [[x, d[x]] for x in keys]
        except Exception as ex: bad.append(f"{k}: {ex}")
    if "XAU" not in hist: raise RuntimeError("gold daily unavailable; " + "; ".join(bad))
    # Treasury real 10Y (official) for the same window
    data["market_hist"] = {"source": "CNBC chart feed daily closes (unofficial); yields in %", "fetched_at": stamp, "series": hist, "missing": bad}
    return f"{len(hist)} series, gold to {hist['XAU'][-1][0]}" + (f" (missing {bad})" if bad else "")


@step("real_hist")
def real_hist():
    months = [now.strftime("%Y%m"), (now.replace(day=1) - dt.timedelta(days=1)).strftime("%Y%m"), (now.replace(day=1) - dt.timedelta(days=35)).strftime("%Y%m")]
    rows = []
    for ym in reversed(months): rows += tsy_month("daily_treasury_real_yield_curve", ym)
    pts = sorted({r["NEW_DATE"][:10]: float(r["TC_10YEAR"]) for r in rows if r.get("TC_10YEAR")}.items())
    if len(pts) < 10: raise RuntimeError("few real-yield rows")
    data.setdefault("market_hist", {}).setdefault("series", {})["REAL10Y"] = [list(p) for p in pts[-70:]]
    return f"{len(pts)} days to {pts[-1][0]}"


def rss_items(xml, src):
    out = []
    for it in re.findall(r"<item>(.*?)</item>", xml, re.S):
        g = lambda t: (re.search(rf"<{t}[^>]*>(.*?)</{t}>", it, re.S) or [None, ""])[1]
        title = re.sub(r"<!\[CDATA\[|\]\]>", "", g("title")).strip(); link = re.sub(r"<!\[CDATA\[|\]\]>", "", g("link")).strip(); pd = g("pubDate").strip()
        title = title.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">")
        try:
            t = (dt.datetime.strptime(pd, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=UTC) if "," in pd else dt.datetime.strptime(pd, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC))
        except Exception: continue
        src2 = src
        m = re.match(r"(.*) - ([^-]{2,40})$", title)
        if src.startswith("Google") and m: title, src2 = m.group(1), m.group(2) + " (via Google News)"
        if title: out.append({"t": t.isoformat(timespec="minutes"), "title": title[:220], "src": src2, "link": link})
    return out


NEWS_FEEDS = [("Google News: gold", "https://news.google.com/rss/search?q=%28gold+price%29+OR+XAUUSD+when:30d&hl=en-US&gl=US&ceid=US:en"),
              ("Google News: Fed/dollar", "https://news.google.com/rss/search?q=%28Fed+OR+Treasury+yields+OR+dollar+index%29+markets+when:14d&hl=en-US&gl=US&ceid=US:en"),
              ("Investing.com commodities", "https://www.investing.com/rss/news_11.rss"),
              ("Investing.com forex", "https://www.investing.com/rss/news_1.rss")]


@step("news")
def news():
    """Headlines fetched server-side (fallback for the browser feed + dated context for the timeline)."""
    got, bad = [], []
    for name, url in NEWS_FEEDS:
        try: got += rss_items(get(url, 30), name)
        except Exception as ex: bad.append(f"{name}: {ex}")
    try:
        j = json.loads(get(data["live_sources"]["news"], 30))
        if j.get("status") == "ok":
            for i in j.get("items", []):
                try: got.append({"t": dt.datetime.strptime(i["pubDate"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC).isoformat(timespec="minutes"), "title": i["title"][:220], "src": "FXStreet (rss2json)", "link": i["link"]})
                except Exception: pass
    except Exception as ex: bad.append(f"rss2json: {ex}")
    if not got: raise RuntimeError("; ".join(bad))
    old = data.get("news_archive", {}).get("items", [])
    seen, merged = set(), []
    cutoff = (now - dt.timedelta(days=35)).isoformat()
    for it in sorted(got + old, key=lambda x: x["t"], reverse=True):
        key = re.sub(r"\W+", "", it["title"].lower())[:70]
        if key in seen or it["t"] < cutoff or it["t"] > (now + dt.timedelta(hours=1)).isoformat(): continue
        seen.add(key); merged.append(it)
    data["news_archive"] = {"fetched_at": stamp, "items": merged[:400], "missing": bad,
                            "sources": [n for n, _ in NEWS_FEEDS] + ["FXStreet (rss2json)"]}
    return f"{len(got)} fetched, {len(merged[:400])} kept" + (f" (failed: {bad})" if bad else "")


def archive_events():
    """Keep high-impact (and USD medium) events with forecast/previous so past weeks stay visible after FF rolls over."""
    arc = {f"{e['date']}|{e['country']}|{e['title']}": e for e in data.get("event_archive", [])}
    for e in data["ff_calendar"].get("events", []):
        if e.get("impact") == "High" or (e.get("impact") == "Medium" and e.get("country") == "USD"):
            k = f"{e['date']}|{e['country']}|{e['title']}"; prev = arc.get(k, {})
            arc[k] = dict(prev, **{x: e.get(x, "") for x in ("title", "country", "date", "impact", "forecast", "previous")}, **({"actual": e["actual"]} if e.get("actual") else {}))
    cutoff = (now - dt.timedelta(days=45)).strftime("%Y-%m-%d")
    data["event_archive"] = sorted([e for e in arc.values() if e["date"][:10] >= cutoff], key=lambda e: e["date"])


def manual_age():
    """Flag hand-maintained sections so the page can show their age honestly."""
    out = {}
    for key, s in (("policy", data["policy"].get("asof")), ("flows", data["flows"].get("asof")), ("risk_hy", data["risk"].get("asof")), ("fed", data["fed"].get("asof", data["policy"].get("asof")))):
        m = re.search(r"(\d{4}-\d{2}-\d{2})", str(s or ""))
        out[key] = {"asof": m.group(1) if m else None}
        if m:
            age = (now.date() - dt.date.fromisoformat(m.group(1))).days; out[key]["age_days"] = age
            if age > 7: log(f"WARNING manual section '{key}' is {age} days old - update data.json by hand")
    auto["manual"] = out


def run_drivers():
    try:
        sys.path.insert(0, D); import drivers
        drivers.build(data, now); log("drivers OK", (data.get("drivers") or {}).get("headline", "")[:160])
    except Exception as ex:
        auto["failures"].append(f"drivers: {ex}"); log("drivers FAILED -", ex)


if "--no-fetch" not in sys.argv:
    for fn in (ff, treasury, bls, cnbc, cot_disagg, cot_tff, bank_participation, market_hist, real_hist, news): fn()
    archive_events()
    # drop curated events more than a day in the past
    data["curated_calendar"] = [e for e in data["curated_calendar"] if e["date"] >= (now - dt.timedelta(days=1)).strftime("%Y-%m-%d")]
    manual_age()
    data["meta"]["asof"] = f"Auto-built {stamp} · yields {data['us_rates']['asof']} · calendar {data['ff_calendar'].get('fetched_at', 'n/a')}"
    data["meta"]["built_at"] = now.isoformat(timespec="seconds")
    run_drivers()
    json.dump(data, open(data_path, "w"), indent=2)
else:
    run_drivers()  # recompute from the committed data (no network)

src = lambda n: open(os.path.join(D, "src", n)).read()
page = src("template.html").replace("__CSS__", src("style.css")).replace("__DATA__", json.dumps(data).replace("</", "<\\/")).replace("__APP__", src("app.js"))
open(os.path.join(D, "index.html"), "w").write(page)
log("wrote", os.path.join(D, "index.html"), len(page), "bytes;", "failures:", auto.get("failures") or "none")
