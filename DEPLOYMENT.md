# Deployment

This app can be deployed either as a Node web service or as a Netlify site with serverless functions. The UI is static, but `/api/analyze` must run server-side because it performs live source ingestion.

## Recommended Fast Path: Netlify

This repo includes `netlify.toml` and Netlify Functions for:

- `/api/health`
- `/api/analyze`

Deploy settings:

- Build command: leave blank or use `npm run check`
- Publish directory: `.`
- Functions directory: `netlify/functions`

Optional semantic model settings:

- `JSC_LLM_URL`: an Ollama-compatible generate endpoint reachable from the deployed function
- `JSC_LLM_MODEL`: model name, default `llama3.2:3b`

If no remote model is configured, the app still runs with deterministic classification and source-quality fallbacks.

## Node Web Service: Render

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
