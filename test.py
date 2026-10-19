import os, json
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__)); url = "file://" + os.path.join(D, "index.html")
# ---- data keys added in v3 (institutional positioning + market drivers); fails loudly if a build dropped them
data = json.load(open(os.path.join(D, "data.json"))); problems = []
def need(cond, msg):
    if not cond: problems.append(msg)
inst = data.get("institutional", {})
need(len(inst.get("gold_disagg", {}).get("weeks", [])) >= 8, "institutional.gold_disagg.weeks < 8")
need(all(k in inst["gold_disagg"]["weeks"][-1] for k in ("date", "oi", "swap", "mm", "pm", "other", "small")) if inst.get("gold_disagg") else False, "gold_disagg week keys")
need(len([c for c, w in inst.get("fx_tff", {}).get("ccy", {}).items() if len(w) >= 2]) >= 4, "fx_tff < 4 currencies")
need("latest" in inst.get("bank_participation", {}), "bank_participation.latest missing (allowed to fail: monthly HTML page)")
need(len(data.get("market_hist", {}).get("series", {}).get("XAU", [])) >= 30, "market_hist XAU < 30 days")
need(len(data.get("news_archive", {}).get("items", [])) >= 10, "news_archive < 10 headlines")
dr = data.get("drivers", {}); need(dr.get("ok") and dr.get("lines") and len(dr.get("timeline", [])) >= 10, "drivers missing/short")
need(all(l.get("dates") and l.get("src") for l in dr.get("lines", [])), "driver line without date/source")
need(isinstance(data.get("event_archive"), list) and isinstance(data.get("release_log"), list), "event_archive/release_log missing")
print("data keys:", problems or "ok")
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for name, vp in [("desktop", {"width": 1600, "height": 1000}), ("mobile", {"width": 400, "height": 860})]:
        ctx = br.new_context(viewport=vp, device_scale_factor=1, timezone_id="Asia/Karachi"); pg = ctx.new_page()
        logs = []; pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}")); pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        pg.goto(url); pg.wait_for_function("window.__liveStatus !== undefined", timeout=60000)
        try: pg.wait_for_function("[...document.querySelectorAll('.feeds td')].some(td=>/Treasury/.test(td.innerText))", timeout=70000)
        except Exception as e: print("  (treasury feed not finished)", e)
        pg.wait_for_timeout(1500)
        print(f"== {name}", pg.evaluate("window.__liveStatus"))
        if name == "desktop":
            for r in pg.eval_on_selector_all(".feeds tr", "rs=>rs.map(r=>r.innerText.replace(/\\t/g,' | '))"): print("  ", r)
            print("  state:", pg.inner_text("#livestate"), "| gold verdict:", pg.inner_text("#b_score .verdict"))
            print("  errors in cards:", pg.eval_on_selector_all(".cb", "els=>els.filter(e=>/Render error/.test(e.innerText)).map(e=>e.id)"))
            print("  confluence:", pg.inner_text("#b_conf .verdict"), "| next:", pg.inner_text("#nexthi"))
            print("  smc:", pg.evaluate("Object.fromEntries(Object.entries(window.__rezan.smc).map(([k,v])=>[k, v?{bias:v.bias,src:v.src,lb:v.lb&&v.lb.kind+(v.lb.dir>0?'+':'-'),loc:v.loc,ote:v.inOTE,n:v.n,obs:v.obs.filter(o=>!o.mit).length,fvg:v.fvgs.filter(f=>!f.filled).length,eq:v.eqs.length}:null]))"))
            print("  smc summary:", pg.inner_text("#b_chart .smcsum") if pg.query_selector("#b_chart .smcsum") else None)
            print("  freshness:", pg.eval_on_selector_all(".fr", "els=>els.map(e=>e.id.slice(2)+'='+e.textContent).join(' ')"))
            print("  scroll overflow x:", pg.evaluate("document.documentElement.scrollWidth"), )
            for sec in ("drivers", "inst", "instob", "timeline", "catalysts", "news"):
                t = pg.inner_text("#b_" + sec); print(f"  [{sec}]", ("RENDER ERROR " if "Render error" in t else "") + t[:160].replace("\n", " | "))
            print("  inst OBs:", pg.evaluate("Object.fromEntries(Object.entries(window.__rezan.smc).map(([k,v])=>[k, v?v.obs.filter(o=>o.inst).map(o=>(o.dir>0?'+':'-')+o.grade+(o.mit?'x':o.touched?'t':'f')).join(' '):null]))"))
            print("  inst on chart:", pg.eval_on_selector_all("#b_chart svg text", "ts=>ts.filter(t=>/INST OB/.test(t.textContent)).map(t=>t.textContent)"))
            if os.environ.get("PREVIEW"):
                pg.click("#b_chart [data-tf='1H']"); pg.wait_for_timeout(500)
                print("  inst on 1H chart:", pg.eval_on_selector_all("#b_chart svg text", "ts=>ts.filter(t=>/INST OB/.test(t.textContent)).map(t=>t.textContent)"))
                for name2, ids in (("preview_institutional.png", ["#m_inst", "#m_chart", "#m_instob"]), ("preview_drivers.png", ["#m_drivers", "#m_timeline", "#m_catalysts"])):
                    pg.evaluate("ids=>{document.querySelectorAll('.card').forEach(c=>c.style.display=ids.includes('#'+c.id)?'':'none');document.querySelectorAll('.tl').forEach(t=>t.style.maxHeight='none');scrollTo(0,0)}", ids); pg.wait_for_timeout(400)
                    pg.screenshot(path=os.path.join(os.environ["PREVIEW"], name2), full_page=True)
                pg.evaluate("document.querySelectorAll('.card').forEach(c=>c.style.display='')")
        else:
            print("  scrollWidth:", pg.evaluate("document.documentElement.scrollWidth"))
        bad = [l for l in logs if l.startswith(("error", "PAGEERROR", "warning"))]
        print("  console problems:", bad or "none")
        pg.screenshot(path=os.path.join(D, f"screenshot_{name}.png"), full_page=True); ctx.close()
    br.close()
if problems: raise SystemExit("FAILED data checks: " + "; ".join(problems))
