# Project

## What This Is

A DCF stock valuation Angular app that is being extended with a standalone Fundamentals Dashboard feature: users search an Indian (NSE/BSE) stock ticker and see key fundamental-analysis metrics (Market Cap, Current Price, 52-Week High/Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE) sourced live from Yahoo Finance's free unofficial API via a new backend proxy.

## Core Value

A user can look up any NSE/BSE-listed company and instantly see the core fundamental metrics used for value-investing style analysis (Screener.in style), for free, with no manual data entry.

## Project Shape

- **Complexity:** complex
- **Why:** Requires new backend infrastructure (proxy) not previously present in this static Angular app, plus derived financial calculations (ROCE/ROE) from an unofficial, schema-unstable upstream API.
- **Web stack:** Angular (frontend) + Node/Express proxy (backend, new)

## Current State

Existing app is a DCF calculator built in Angular with CSV/XLSX import services. No backend currently exists. This milestone adds the first backend component (a Node/Express proxy) and a new dashboard feature module.

## Architecture / Key Patterns

- Angular frontend: new dashboard feature module/route alongside existing dcf-calculator
- New `/server` folder: Node/Express proxy using the `yahoo-finance2` npm package
- Proxy calls Yahoo Finance's `quoteSummary()` for valuation metrics and `fundamentalsTimeSeries()` for financial statement data (EBIT, capital employed, net income, equity) to derive ROCE/ROE server-side
- Proxy caches per-ticker responses in-memory for ~5 minutes
- Dev workflow: two processes (`ng serve` + node server)

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M001: Fundamentals Dashboard — live-data dashboard showing 8 key fundamental metrics for a single searched NSE/BSE ticker, backed by a new Node/Express proxy over Yahoo Finance's unofficial API
