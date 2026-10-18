# Rezan Macro Terminal - running it 24/7

The page is ONE self-contained file (`index.html`). Live data (gold, FX, yields, indices, oil, BTC, COT, news) is
fetched by the visitor's browser every 5 minutes from keyless CORS APIs, so any static host works. The daily
part (calendar, Treasury curve, BLS actuals, DXY/oil close) is refreshed by `build.py` - stdlib only, no keys.

## Options tested / researched (Oct 18 2026)
| Option | Account? | Daily auto-refresh | Notes |
|---|---|---|---|
| cloudflared quick tunnel from the agent box | none | n/a | FAILED here: box egress blocks port 7844 (QUIC and HTTP2), URL returned HTTP 530. Even where it works the trycloudflare URL is random, changes on every restart, no SLA, and dies when the machine sleeps. |
| **GitHub Pages + Actions (recommended)** | free GitHub account, public repo | yes - `.github/workflows/pages.yml` (2 runs/day) | Uses the built-in GITHUB_TOKEN: no token to create. Scheduled workflows pause after 60 days without commits - the workflow commits data.json each run, which counts as activity. |
| Netlify | free account (anonymous `netlify deploy --allow-anonymous` / Drop sites are deleted after 1 h unless claimed) | via Git repo build or a GitHub Action + personal access token | fine alternative |
| Cloudflare Pages | free account | Git integration build, or wrangler + API token from an Action | fine alternative |
| Vercel | free Hobby account (non-commercial) | Git integration; Hobby cron = 1/day | fine alternative |
| Cursor "Origin" git host (connected) | n/a | n/a | Git repositories only - no static-site/Pages hosting tools; no namespace exists for this user. |
| Any always-on PC/VPS | none | `run_daily.sh` in crontab | serve `publish/` with any web server |

## Recommended: GitHub Pages (about 10 minutes, one-time)
1. Sign in / sign up at github.com (free).
2. New repository, e.g. `rezan-macro-terminal`, **Public**, no template.
3. Upload this folder's files: `index.html`, `build.py`, `data.json`, `src/` (3 files), `run_daily.sh`, `.gitignore`, and
   `.github/workflows/pages.yml` (on the web: "Add file → Create new file", type `.github/workflows/pages.yml`, paste the content).
   Or with git: `git init && git add . && git commit -m init && git branch -M main && git remote add origin https://github.com/<you>/rezan-macro-terminal.git && git push -u origin main`.
4. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. This click is required.
   The workflow uses `actions/configure-pages`, but it does **not** turn Pages on by itself: that only works with a
   personal token, and the built-in Actions token would fail the run. Leave the workflow as it is and use this menu.
5. You do **not** need to change **Settings → Actions → General → Workflow permissions**. The workflow file already
   asks for permission to save `data.json`. Change that setting to **Read and write** only if a run fails with
   "permission denied" or "403" on the commit step.
6. **Actions** tab → "build-and-publish" → **Run workflow**. After ~1 min the site is at `https://<you>.github.io/rezan-macro-terminal/`.
   This repo: https://anaqishah731-svg.github.io/rezan-macro-terminal/
7. Open it on phone/PC and keep the tab open; it refreshes itself every 5 min, retries failed feeds after 60 s, refreshes when
   you return to the tab and reloads every 6 h to pick up the latest daily build.

## Hand-maintained sections (build.py flags them when >7 days old)
policy rates, Fed odds, WGC flows, HY spread, PMI, economic forecasts. Everything else updates automatically.
