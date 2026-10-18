import os, json
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__)); url = "file://" + os.path.join(D, "index.html")
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
        else:
            print("  scrollWidth:", pg.evaluate("document.documentElement.scrollWidth"))
        bad = [l for l in logs if l.startswith(("error", "PAGEERROR", "warning"))]
        print("  console problems:", bad or "none")
        pg.screenshot(path=os.path.join(D, f"screenshot_{name}.png"), full_page=True); ctx.close()
    br.close()
