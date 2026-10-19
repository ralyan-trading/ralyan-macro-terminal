# Rezan Macro Terminal

Rezan Macro Terminal puts gold, forex, yields, DXY, oil and news on one live screen that refreshes every 5 minutes. It scores gold's fundamentals, marks SMC structure on the chart, ranks currency strength, tracks COT data and counts down to major news. It's free, runs 24/7 and works on mobile. Educational, not financial advice.

**Live site:** https://anaqishah731-svg.github.io/rezan-macro-terminal/

The page is one file (`index.html`). A scheduled GitHub Action rebuilds the daily figures and publishes the site. The one-time clicks are in `HOSTING.md`.

Status: deploy requested 2026-10-19.

## v3 additions
- **Why is gold moving · Market drivers** - rule-based explanation of the last 5 sessions (DXY, US10Y, 10Y real yield, oil, S&P/VIX, CFTC COT, US data surprises), each line with its dates and source, plus a live "today" line.
- **Drivers timeline (last 4 weeks)** - every session: gold/DXY/10Y/real-yield change, high-impact events with actual vs forecast vs previous, a one-line read, and dated headlines.
- **Upcoming catalysts (next 7 days)** with the textbook market reaction.
- **Institutions & banks** - CFTC Disaggregated COT for gold (swap dealers = banks, managed money = funds, producers...), Traders in Financial Futures for USD/EUR/GBP/JPY/CHF/CAD/AUD/NZD, and the monthly CFTC Bank Participation Report for gold.
- **Institutional order blocks** on the chart (price-action zones with >= 1.5x ATR displacement that broke structure; not real bank order data) with COT confluence.
- `drivers.py` holds the drivers engine; `build.py` fetches everything (stdlib only, no keys).
