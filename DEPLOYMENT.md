# Deployment

This app should be deployed as a Node web service because `server.js` serves both the UI and the live ingestion API at `/api/analyze`.

## Recommended Path: Render

1. Push this project to a GitHub repository.
2. In Render, create a new Blueprint or Web Service from the repository.
3. Use the included `render.yaml`.
4. Confirm these settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
   - Environment variable: `HOST=0.0.0.0`
5. Optional semantic model settings:
   - `JSC_LLM_URL`: an Ollama-compatible generate endpoint reachable from the deployed service
   - `JSC_LLM_MODEL`: model name, default `llama3.2:3b`

If no remote model is configured, the app still runs with deterministic classification and source-quality fallbacks.

## Other Hosts

Railway, Fly.io, DigitalOcean App Platform, and similar Node web-service hosts can run the app with the same command:

```powershell
npm start
```

The host must provide a `PORT` environment variable or allow port `8000`. For cloud deployment, set:

```text
HOST=0.0.0.0
```

## Not Static-Only

Static hosts can serve `index.html`, `styles.css`, and `app.js`, but the live news, postings, filings, company lookup, and sentiment API will not work unless `server.js` is also running or converted into serverless functions.
