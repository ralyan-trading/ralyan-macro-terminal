#!/usr/bin/env python3
"""Rezan Macro Terminal builder - safe to run unattended (cron / GitHub Actions).

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
import json, os, re, sys, urllib.request, datetime as dt
D = os.path.dirname(os.path.abspath(__file__))
data_path = os.path.join(D, "data.json")
data = json.load(open(data_path))
UTC = dt.timezone.utc
now = dt.datetime.now(UTC)
stamp = now.strftime("%Y-%m-%d %H:%M UTC")
UA = {"User-Agent": "Mozilla/5.0 (RezanMacroTerminal build)"}
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


if "--no-fetch" not in sys.argv:
    for fn in (ff, treasury, bls, cnbc): fn()
    # drop curated events more than a day in the past
    data["curated_calendar"] = [e for e in data["curated_calendar"] if e["date"] >= (now - dt.timedelta(days=1)).strftime("%Y-%m-%d")]
    manual_age()
    data["meta"]["asof"] = f"Auto-built {stamp} · yields {data['us_rates']['asof']} · calendar {data['ff_calendar'].get('fetched_at', 'n/a')}"
    data["meta"]["built_at"] = now.isoformat(timespec="seconds")
    json.dump(data, open(data_path, "w"), indent=2)

src = lambda n: open(os.path.join(D, "src", n)).read()
page = src("template.html").replace("__CSS__", src("style.css")).replace("__DATA__", json.dumps(data).replace("</", "<\\/")).replace("__APP__", src("app.js"))
open(os.path.join(D, "index.html"), "w").write(page)
log("wrote", os.path.join(D, "index.html"), len(page), "bytes;", "failures:", auto.get("failures") or "none")
