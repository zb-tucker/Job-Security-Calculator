# Job Security Calculator

A product prototype for a sourced job security analysis dashboard. It combines labor statistics, AI exposure context, live news discovery, job postings, SEC filing metadata, company posture, and derived public sentiment into a directional risk estimate.

## Run Locally

```powershell
npm start
```

Then open `http://127.0.0.1:8000`.

If `npm` is not installed, run the same server directly:

```powershell
node server.js
```

The app should be served through `server.js` because the product API performs live ingestion and avoids browser CORS limits.

## Deploy

Use a Node web-service host so the live ingestion API can run alongside the UI. Render is configured through `render.yaml`; see `DEPLOYMENT.md` for the shipping checklist.

## Current Product Prototype

- Free-text role and company inputs
- Local classification from typed role/company to known occupation and company profiles
- Full BLS occupation matching from the 2024-2034 occupation workbook, with the smaller local CSV used as an enrichment overlay where it has extra AI-risk fields
- Expanded role aliasing with fuzzy matching over BLS/SOC occupation rows
- Company industry inference from local profiles, with public lookup enrichment for unknown employers
- Role-company fit reasoning, such as how software roles differ inside banking, healthcare, retail, defense, or large tech employers
- Role-specific risk modifiers that adjust company-level automation, layoff, monitoring, and hiring-resilience signals by role context
- Company maturity profiles, including venture-backed startups, growth-stage startups, private-equity backed companies, and mid-market private companies
- Optional small local language model support through an Ollama-compatible endpoint for role classification, company classification, and source-quality scoring
- Fixed scoring methodology based on source signals rather than user-adjustable risk weights
- Composite risk score with factor cards
- Professional outlook chart with a gridded jobs line plot, confidence interval band, and explained vertical risk/wage factor bars
- Company posture panel
- Evidence stream with a source/citation label on every item
- Company-specific news receives higher weight than role-only, peer, or sector background news
- Live source ingestion through a local backend
- Source health panel showing live, local, limited, or unavailable inputs
- Agent run panel showing the analysis pipeline used for the current run
- Related-fields section beside the Anthropic graph, including theoretical future risk and future security scores
- Bottom profile section linking to Handshake and LinkedIn professional profiles

## Live Ingestion

- Full BLS occupation projections table converted from `occupation.xlsx` into `BLS_occupation_2024_2034.csv`
- BLS-style local enrichment CSV: `US_BLS_Employment_subset.csv`
- Local Anthropic AI coverage graph image, used as AI exposure context
- GDELT news discovery for recent public news around a company, role, layoffs, hiring, AI, and automation, with Google News RSS fallback when GDELT is throttled
- Remotive public remote jobs API for active remote postings
- LinkedIn public discovery through accessible public search/feed results and direct LinkedIn search links; the app does not bypass login or scrape private LinkedIn pages
- SEC EDGAR company submissions API for recent 10-K, 10-Q, 8-K, 20-F, and 6-K filing metadata
- Derived sentiment from retrieved public source titles and snippets
- Optional semantic model endpoint: `JSC_LLM_URL`, defaulting to `http://127.0.0.1:11434/api/generate`
- Optional semantic model name: `JSC_LLM_MODEL`, defaulting to `llama3.2:3b`

Every evidence card includes a source label, and live upstream items link out when a URL is available.

If no local model is running, the app uses deterministic fallback rules and marks the semantic source as `Heuristic fallback`.

For best role matching, run a small local model before starting the app. Example with Ollama:

```powershell
ollama pull llama3.2:3b
ollama serve
```

Then start the app in another terminal. Without a local model, the app uses exact BLS titles, local role hints, and conservative "all other" BLS fallbacks before rejecting weak matches.

## Methodology Inspiration

This app borrows several ideas from Andrej Karpathy's US Job Market Visualizer:

- Treat BLS Occupational Outlook data as a core source of truth
- Keep the tool exploratory instead of pretending the score is an economic forecast
- Separate metric layers such as employment outlook, pay, education, and AI exposure
- Use an LLM-style scoring rubric to add rationale where raw structured data is not enough
- State clearly that AI exposure means reshaping risk, not automatic job disappearance

This app extends that idea from occupation-level exploration into company-role analysis by adding live company sources, filings, postings, sentiment, and role-company fit reasoning.

## Product Readiness Gaps

- Replace the simple text classifier with a real classifier over SOC/O*NET roles and company entities
- Replace heuristic scoring with validated model weights and backtesting
- Add paid or licensed job board ingestion for current and historical postings by role, company, seniority, location, and remote policy
- Add vetted professional news feeds and earnings-call transcript providers
- Add WARN notice ingestion by state
- Store dated evidence snippets with source URLs, extraction timestamps, source quality, and confidence scores
- Add authentication and saved watchlists for roles, companies, and locations
- Add a transparent methodology page explaining that scores are estimates, not employment predictions
- Add persistence, scheduled refreshes, alerts, and audit logs
- Add source-quality controls and compliance review for any scraped source

## Data sources

- `occupation.xlsx`
- `BLS_occupation_2024_2034.csv`
- `US_BLS_Employment_subset.csv`
- Local Anthropic AI coverage graph image, currently used only as AI exposure context
- Labor bureau statistics
- Job posting sources, monitoring increases or decreases in postings for companies and roles
- Historical job postings, especially around layoffs, product launches, automation programs, and hiring freezes
- News sources, including recent news and historical news around layoffs within fields and companies
- Public sentiment sources, reviewed carefully because they can be noisy or brigaded
