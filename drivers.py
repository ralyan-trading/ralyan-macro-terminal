"""Ralyan Macro Terminal - rule-based 'why is the market moving' engine (stdlib only).

Input: data.json sections market_hist (daily closes), event_archive (ForexFactory), release_log (dated releases with
actual/forecast/previous), us_actuals (BLS), institutional (CFTC) and news_archive (dated headlines).
Output: data["drivers"] = weekly explanation lines + a dated timeline. Every line carries its date(s) and the numbers it used;
nothing is guessed - a driver without data is skipped and listed in drivers.notes.
"""
import re, datetime as dt

MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
fd = lambda d: f"{MON[int(d[5:7]) - 1]} {int(d[8:10])}"  # 2026-10-14 -> Oct 14
sg = lambda x, n=2: ("+" if x > 0 else "") + f"{x:.{n}f}"
LOWER_IS_HAWKISH = re.compile(r"unemployment|jobless|claims", re.I)
KEYW = re.compile(r"gold|xau|bullion|fed|fomc|powell|warsh|dollar|treasur|yield|inflation|cpi|ppi|payroll|jobs|tariff|oil|iran|safe.haven", re.I)


def num(s):
    if s is None: return None
    m = re.search(r"-?\d+(\.\d+)?", str(s).replace(",", ""))
    if not m: return None
    v = float(m.group(0))
    return v * (1000 if re.search(r"\dM", str(s)) else 1)


def weekday_series(pts):
    return [(d, v) for d, v in pts if dt.date.fromisoformat(d).weekday() < 5]


def at_or_before(pts, d):
    r = [v for x, v in pts if x <= d]
    return r[-1] if r else None


def prev_before(pts, d):
    r = [(x, v) for x, v in pts if x < d]
    return r[-1] if r else (None, None)


def events(data):
    """Dated events with actual/forecast/previous from release_log + event_archive (+BLS actuals)."""
    out, seen = [], set()
    norm = lambda t: re.sub(r"[^a-z]", "", t.lower())[:14]
    for e in data.get("release_log", []):
        out.append(dict(e, src=e.get("src", "release log")))
        seen.add((e["date"][:10], e["ccy"], norm(e["title"])))
    ua = (data.get("us_actuals") or {}).get("items", [])
    for e in data.get("event_archive", []):
        d = e["date"][:10]
        key = (d, e["country"], norm(e["title"]))
        if key in seen: continue
        a, asrc = e.get("actual"), "ForexFactory"
        if not a and e["country"] == "USD":
            y, m = int(d[:4]), int(d[5:7]) - 1
            if m == 0: y, m = y - 1, 12
            per = f"{y}-{m:02d}"
            hit = [x for x in ua if re.search(x["re"], e["title"]) and x["period"] == per]
            if hit: a, asrc = hit[0]["v"], "BLS API"
        out.append({"date": e["date"], "ccy": e["country"], "title": e["title"], "impact": e["impact"], "actual": a or None,
                    "forecast": e.get("forecast") or None, "previous": e.get("previous") or None, "src": "ForexFactory calendar" + (f" + {asrc} actual" if a and asrc != "ForexFactory" else "")})
        seen.add(key)
    for e in out:
        a, f = num(e.get("actual")), num(e.get("forecast"))
        e["surprise"] = None if a is None or f is None else round(a - f, 4)
        hawk = None
        if e.get("read"): hawk = {"hawkish": 1, "dovish": -1}.get(e["read"].split()[0].lower())
        elif e["surprise"] is not None and abs(e["surprise"]) > 1e-9:
            hawk = (1 if e["surprise"] > 0 else -1) * (-1 if LOWER_IS_HAWKISH.search(e["title"]) else 1)
        e["hawk"] = hawk
        c = e["ccy"]
        if hawk is None: e["interp"] = "no forecast/actual to compare" if e["surprise"] is None else "in line with forecast"
        elif c == "USD": e["interp"] = ("hawkish → USD+, gold−" if hawk > 0 else "dovish → USD−, gold+")
        else: e["interp"] = (f"stronger than expected → {c}+" if hawk > 0 else f"weaker than expected → {c}−")
    return sorted(out, key=lambda e: e["date"])


def fmt_ev(e):
    parts = [f"{e['actual']}" if e.get("actual") else "actual n/a"]
    if e.get("forecast"): parts.append(f"vs {e['forecast']} fcst")
    if e.get("previous"): parts.append(f"prev {e['previous']}")
    return f"{e['ccy']} {e['title']} ({fd(e['date'][:10])}: {', '.join(parts)})"


def cot_lines(data):
    g = (data.get("institutional") or {}).get("gold_disagg")
    if not g or len(g["weeks"]) < 2: return None
    a, b = g["weeks"][-2], g["weeks"][-1]
    net = lambda w, k: w[k][0] - w[k][1]
    return {"date": b["date"], "prev": a["date"], "mm": net(b, "mm"), "mm_chg": net(b, "mm") - net(a, "mm"),
            "swap": net(b, "swap"), "swap_chg": net(b, "swap") - net(a, "swap"), "oi_chg": b["oi"] - a["oi"]}


def build(data, now):
    S = {k: weekday_series(v) for k, v in (data.get("market_hist") or {}).get("series", {}).items()}
    notes = []
    X = S.get("XAU") or []
    if len(X) < 8:
        data["drivers"] = {"ok": False, "notes": ["gold daily closes unavailable - drivers not computed"]}; return
    # window = last 5 complete sessions
    d1, d0 = X[-1][0], X[-6][0]
    g0, g1 = X[-6][1], X[-1][1]; gch = (g1 / g0 - 1) * 100
    win = f"{fd(d0)} → {fd(d1)}"
    lines = []  # each: label, text, gold (+1 helps gold / -1 hurts / 0 mixed), dates, src

    def pct(k):
        s = S.get(k)
        if not s: notes.append(f"{k} daily series missing"); return None
        a, b = at_or_before(s, d0), at_or_before(s, d1)
        return None if a is None or b is None else (b / a - 1) * 100

    def bp(k):
        s = S.get(k)
        if not s: notes.append(f"{k} daily series missing"); return None
        a, b = at_or_before(s, d0), at_or_before(s, d1)
        return None if a is None or b is None else (b - a) * 100, b

    dx = pct("DXY")
    if dx is not None:
        lines.append({"k": "usd", "label": "US dollar", "gold": 1 if dx <= -0.3 else -1 if dx >= 0.3 else 0, "dates": win, "src": "DXY daily close, CNBC", "brief": f"DXY {sg(dx)}%",
                      "text": f"Dollar index (DXY) {sg(dx)}% ({win}). " + ("A weaker dollar makes gold cheaper for non-US buyers → supportive." if dx <= -0.3 else "A stronger dollar usually weighs on gold." if dx >= 0.3 else "Dollar roughly flat → not a big driver.")})
    r = bp("REAL10Y")
    if r and r[0] is not None:
        c, lvl = r
        lines.append({"k": "real", "label": "Real yields", "gold": 1 if c <= -5 else -1 if c >= 5 else 0, "dates": win, "src": "U.S. Treasury real yield curve (10Y TIPS)", "brief": f"10Y real yield {sg(c, 0)}bp",
                      "text": f"10Y real yield {sg(c, 0)}bp to {lvl:.2f}% ({win}). " + ("Falling real yields lower the cost of holding gold (it pays no interest) → supportive." if c <= -5 else "Rising real yields make interest-paying assets more attractive than gold → headwind." if c >= 5 else "Little change.")})
    n = bp("US10Y")
    if n and n[0] is not None:
        c, lvl = n
        lines.append({"k": "nom", "label": "US 10Y yield", "gold": 1 if c <= -5 else -1 if c >= 5 else 0, "dates": win, "src": "US10Y daily close, CNBC", "brief": f"US 10Y {sg(c, 0)}bp",
                      "text": f"US 10Y yield {sg(c, 0)}bp to {lvl:.2f}% ({win})." + (" Bond yields falling = markets pricing less Fed tightening." if c <= -5 else " Yields rising = markets pricing a tighter Fed." if c >= 5 else "")})
    o = pct("WTI")
    if o is not None:
        lines.append({"k": "oil", "label": "Oil", "gold": 0, "dates": win, "src": "WTI front-month daily close, CNBC", "brief": f"WTI {sg(o, 1)}%",
                      "text": f"WTI crude {sg(o, 1)}% ({win}). " + ("Higher oil lifts inflation fears: that can support gold as a hedge but also pushes the Fed to stay tight (mixed)." if o >= 3 else "Lower oil eases inflation fears → less pressure on the Fed (mildly gold-supportive via yields, mixed)." if o <= -3 else "Oil not a major driver this week.")})
    sp, vx = pct("SPX"), bp("VIX")
    if sp is not None and vx and vx[0] is not None:
        v = vx[0] / 100
        off = sp <= -1.5 or v >= 3
        on = sp >= 1.5 and v <= -2
        lines.append({"k": "risk", "label": "Risk mood", "gold": 1 if off else -1 if on else 0, "dates": win, "src": "S&P 500 and VIX daily close, CNBC", "brief": f"risk-{'off' if off else 'on' if on else 'mixed'} (S&P {sg(sp, 1)}%, VIX {sg(v, 1)})",
                      "text": f"S&P 500 {sg(sp, 1)}%, VIX {sg(v, 1)} pts ({win}). " + ("Risk-off: safe-haven demand helps gold." if off else "Risk-on: less need for safe havens." if on else "Risk mood mixed.")})
    cl = cot_lines(data)
    if cl:
        lines.append({"k": "cot", "label": "Funds & banks (COT)", "gold": 1 if cl["mm_chg"] > 0 else -1 if cl["mm_chg"] < 0 else 0, "dates": f"{fd(cl['prev'])} → {fd(cl['date'])}", "src": "CFTC Disaggregated COT, COMEX gold", "brief": f"funds net {sg(cl['mm_chg'] / 1000, 1)}K contracts (COT {fd(cl['date'])})",
                      "text": f"Managed money (funds) net {sg(cl['mm_chg'] / 1000, 1)}K contracts to {cl['mm'] / 1000:.1f}K; swap dealers (banks) net {sg(cl['swap_chg'] / 1000, 1)}K to {cl['swap'] / 1000:.1f}K; open interest {sg(cl['oi_chg'] / 1000, 1)}K (report {fd(cl['date'])}). "
                              + ("Funds were adding to longs → buying pressure." if cl["mm_chg"] > 0 else "Funds were cutting longs / adding shorts → selling pressure." if cl["mm_chg"] < 0 else "")})
    EV = events(data)
    in_win = [e for e in EV if d0 < e["date"][:10] <= d1 and e.get("impact", "High") == "High" and e.get("hawk") is not None]
    for e in in_win:
        gd = day_move(X, e["date"][:10])
        lines.append({"k": "event", "label": "Data / Fed", "gold": -e["hawk"] if e["ccy"] == "USD" else 0, "dates": fd(e["date"][:10]), "src": e["src"], "brief": f"{e['title']} {e.get('actual') or 'n/a'} vs {e.get('forecast') or 'n/a'} fcst ({fd(e['date'][:10])}, {'hawkish' if e['hawk'] > 0 else 'dovish'})" if e["ccy"] == "USD" else f"{e['ccy']} {e['title']} ({fd(e['date'][:10])})",
                      "text": f"{fmt_ev(e)}: {e['interp']}." + (f" Gold that day {sg(gd, 2)}%." if gd is not None else "")})
    helps = [l for l in lines if l["gold"] > 0]; hurts = [l for l in lines if l["gold"] < 0]
    fits = helps if gch > 0 else hurts
    head = (f"Gold {sg(gch)}% over the last 5 sessions ({win}: {g0:,.2f} → {g1:,.2f}). "
            + (f"{'Helped' if gch > 0 else 'Pushed lower'} mainly by: " + "; ".join(l["brief"] for l in fits[:4]) + ". " if fits else "No single macro driver lines up with the move. ")
            + (("Working against it: " + "; ".join(l["brief"] for l in (hurts if gch > 0 else helps)[:3]) + ".") if (hurts if gch > 0 else helps) else ""))
    # FX brief
    fx = []
    for k, lab, inv in (("EURUSD", "EUR/USD", False), ("USDJPY", "USD/JPY", False)):
        p = pct(k)
        if p is not None: fx.append(f"{lab} {sg(p)}% ({win})")
    tff = ((data.get("institutional") or {}).get("fx_tff") or {}).get("ccy", {})
    fxl = []
    if dx is not None: fxl.append(f"DXY {sg(dx)}% ({win})" + (" - dollar weaker" if dx < -0.2 else " - dollar stronger" if dx > 0.2 else " - flat") + (", " + ", ".join(fx) if fx else "") + ".")
    for c in ("EUR", "JPY", "GBP"):
        w = tff.get(c) or []
        if len(w) >= 2:
            lv = lambda x: x["lev"][0] - x["lev"][1]; am = lambda x: x["am"][0] - x["am"][1]
            fxl.append(f"{c} futures (CFTC, {fd(w[-1]['date'])}): hedge funds net {sg((lv(w[-1]) - lv(w[-2])) / 1000, 1)}K w/w to {lv(w[-1]) / 1000:.1f}K; asset managers {sg((am(w[-1]) - am(w[-2])) / 1000, 1)}K to {am(w[-1]) / 1000:.1f}K.")
    # timeline: last ~20 sessions
    news = (data.get("news_archive") or {}).get("items", [])
    tl = []
    moves = [abs(X[i][1] / X[i - 1][1] - 1) * 100 for i in range(max(1, len(X) - 60), len(X))]
    med = sorted(moves)[len(moves) // 2] if moves else 1
    for i in range(max(1, len(X) - 20), len(X)):
        d, gp = X[i][0], (X[i][1] / X[i - 1][1] - 1) * 100
        dxp = chg_d(S.get("DXY"), d, pctmode=True); y10 = chg_d(S.get("US10Y"), d); ry = chg_d(S.get("REAL10Y"), d)
        evs = [e for e in EV if e["date"][:10] == d and (e.get("impact") == "High" or e["ccy"] == "USD")]
        hl = [n for n in news if n["t"][:10] == d and KEYW.search(n["title"])][:2]
        notable = abs(gp) >= max(1.0, 1.5 * med)
        why = interp_day(gp, dxp, y10, evs)
        tl.append({"date": d, "gold_pct": round(gp, 2), "gold_close": X[i][1], "dxy_pct": None if dxp is None else round(dxp, 2), "us10y_bp": None if y10 is None else round(y10 * 100),
                   "real_bp": None if ry is None else round(ry * 100), "notable": notable,
                   "events": [{"t": e["date"], "ccy": e["ccy"], "title": e["title"], "actual": e.get("actual"), "forecast": e.get("forecast"), "previous": e.get("previous"), "interp": e["interp"], "src": e["src"]} for e in evs],
                   "headlines": [{"title": h["title"], "src": h["src"], "link": h["link"], "t": h["t"]} for h in hl], "why": why})
    data["drivers"] = {"ok": True, "built_at": now.isoformat(timespec="minutes"), "window": {"from": d0, "to": d1}, "gold": {"from": g0, "to": g1, "chg_pct": round(gch, 2)},
                       "headline": head, "lines": lines, "fx": fxl, "timeline": tl[::-1], "notes": sorted(set(notes)),
                       "method": "Rule-based: each driver compares the same 5-session window; 'helps/hurts gold' uses textbook relationships (weaker USD, lower real yields, risk-off, fund buying = supportive). Daily % = close-to-close, so it includes every other news of that day."}


def short(l):
    t = l["text"].split(". ")[0]
    return t if len(t) < 140 else t[:137] + "…"


def day_move(X, d):
    i = [j for j, (x, _) in enumerate(X) if x == d]
    if not i or i[0] == 0: return None
    return (X[i[0]][1] / X[i[0] - 1][1] - 1) * 100


def chg_d(s, d, pctmode=False):
    if not s: return None
    cur = [v for x, v in s if x == d]
    if not cur: return None
    _, pv = prev_before(s, d)
    if pv is None: return None
    return (cur[0] / pv - 1) * 100 if pctmode else cur[0] - pv


def interp_day(gp, dxp, y10, evs):
    parts = []
    for e in evs:
        if e.get("hawk") is not None and e["ccy"] == "USD":
            exp = -e["hawk"]
            parts.append(f"{e['title']} {e['interp'].split(' →')[0]}; gold {'reacted as expected' if (gp > 0) == (exp > 0) else 'moved against the usual reaction'}")
    if dxp is not None and y10 is not None:
        if gp > 0 and dxp < 0 and y10 < 0: parts.append("weaker USD + lower yields → gold+")
        elif gp < 0 and dxp > 0 and y10 > 0: parts.append("stronger USD + higher yields → gold−")
        elif gp > 0 and dxp > 0: parts.append("gold up despite a firmer USD (safe-haven or other demand)")
        elif gp < 0 and dxp < 0: parts.append("gold down despite a softer USD (profit-taking / other flows)")
        elif gp > 0 and y10 < 0: parts.append("lower yields → gold+")
        elif gp < 0 and y10 > 0: parts.append("higher yields → gold−")
    return "; ".join(parts) or "no clear macro driver in the data"
