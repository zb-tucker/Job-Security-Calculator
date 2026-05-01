const form = document.querySelector("#risk-form");
const roleInput = document.querySelector("#role-input");
const companyInput = document.querySelector("#company-input");
const riskScore = document.querySelector("#risk-score");
const riskRing = document.querySelector("#risk-ring");
const riskLabel = document.querySelector("#risk-label");
const analysisTitle = document.querySelector("#analysis-title");
const analysisKicker = document.querySelector("#analysis-kicker");
const agentStatus = document.querySelector("#agent-status");
const signalGrid = document.querySelector("#signal-grid");
const verdictTitle = document.querySelector("#verdict-title");
const verdictCopy = document.querySelector("#verdict-copy");
const trendChart = document.querySelector("#trend-chart");
const companyTitle = document.querySelector("#company-title");
const confidenceLabel = document.querySelector("#confidence-label");
const companyRisk = document.querySelector("#company-risk");
const companyCopy = document.querySelector("#company-copy");
const companyBars = document.querySelector("#company-bars");
const evidenceList = document.querySelector("#evidence-list");
const agentSteps = document.querySelector("#agent-steps");
const toggleEvidence = document.querySelector("#toggle-evidence");
const trendButtons = document.querySelectorAll(".segmented button");
const matchedRole = document.querySelector("#matched-role");
const roleHint = document.querySelector("#role-hint");
const matchedCompany = document.querySelector("#matched-company");
const dataMode = document.querySelector("#data-mode");
const saveWatch = document.querySelector("#save-watch");
const watchlist = document.querySelector("#watchlist");
const runButton = form.querySelector(".primary-action");
const runButtonLabel = form.querySelector(".button-label");
const futureRisk = document.querySelector("#future-risk");
const futureSecurity = document.querySelector("#future-security");
const futureRationale = document.querySelector("#future-rationale");
const relatedFields = document.querySelector("#related-fields");

let activeTrend = "employment";
let evidenceExpanded = false;
let latestAnalysis = null;
let analysisRequest = 0;
let savedWatches = JSON.parse(localStorage.getItem("jobSecurityWatchlist") || "[]");

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toNumber(value) {
  return Number.parseFloat(String(value || "0").replace(/,/g, "")) || 0;
}

function riskColor(score) {
  if (score >= 70) return "var(--coral)";
  if (score >= 50) return "var(--amber)";
  return "var(--green)";
}

function riskText(score) {
  if (score >= 70) return ["High risk", "Security is fragile"];
  if (score >= 50) return ["Elevated risk", "Watch the signals"];
  if (score >= 35) return ["Moderate risk", "Mixed but manageable"];
  return ["Lower risk", "Durable near-term"];
}

function formatWage(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sourceClass(status) {
  if (["live", "local", "derived"].includes(status)) return "ready";
  if (["thin", "not-found"].includes(status)) return "limited";
  return "planned";
}

function setSourceStatus(sources) {
  sources.forEach((source) => {
    const row = document.querySelector(`#source-${source.id}`);
    const label = document.querySelector(`#${source.id}-status`);
    if (!row || !label) return;
    row.classList.remove("ready", "planned", "limited");
    row.classList.add(sourceClass(source.status));
    label.textContent = source.detail || source.status;
  });
}

function renderSignals(analysis) {
  const signals = [
    {
      label: "AI exposure",
      value: analysis.scores.aiExposure,
      body: "CSV automation score blended with occupation-category coverage from the local Anthropic graph.",
    },
    {
      label: "Labor outlook",
      value: analysis.scores.laborRisk,
      body: `${analysis.roleMatch.row.emp_change_pct}% projected employment change through 2034, translated into labor-demand risk.`,
    },
    {
      label: "Company pressure",
      value: analysis.scores.companyPressure,
      body: "Company-class baseline adjusted with live postings, SEC filing activity, and public text sentiment.",
    },
    {
      label: "Live source pressure",
      value: clamp((analysis.scores.postingNewsRisk + analysis.scores.sentimentRisk + analysis.scores.filingsRisk + (analysis.scores.linkedInRisk || 0)) / 4),
      body: "Directional signal from live news discovery, LinkedIn public discovery, job postings, public filings, and sentiment extraction.",
    },
  ];

  signalGrid.innerHTML = signals
    .map(
      (signal) => `
        <article class="signal-card">
          <span class="card-label">${escapeHtml(signal.label)}</span>
          <strong>${signal.value}</strong>
          <div class="signal-track"><span style="width: ${signal.value}%; background: ${riskColor(signal.value)}"></span></div>
          <p>${escapeHtml(signal.body)}</p>
        </article>
      `,
    )
    .join("");
}

function renderTrend(analysis) {
  const data = analysis.trend[activeTrend] || [];

  if (activeTrend === "employment") {
    renderEmploymentLine(data);
    return;
  }

  renderMetricRows(data, activeTrend);
}

function metricColor(value, kind) {
  if (kind === "wage") {
    if (value >= 70) return "var(--green)";
    if (value >= 45) return "var(--blue)";
    return "var(--amber)";
  }
  return riskColor(value);
}

function metricExplanation(label, kind) {
  const key = label.toLowerCase();
  const explanations = {
    ai: "Looks at occupation automation risk and broad AI coverage, then weights it into overall exposure.",
    labor: "Translates projected BLS employment growth or decline into demand-side risk.",
    company: "Combines adjusted layoff, automation, maturity, monitoring, hiring, and live-source company signals.",
    postings: "Uses job posting availability and company-role posting signals as a demand proxy.",
    linkedin: "Uses LinkedIn public discovery for company-role, company news, and role trend signals.",
    filings: "Looks at public filing activity, especially events that can signal restructuring or business pressure.",
    sentiment: "Scores retrieved source titles and snippets for layoff, automation, hiring, and growth language.",
    fit: "Measures how the specific role behaves inside the specific company context.",
    median: "Normalizes the matched occupation median wage into a rough economic-strength signal.",
    education: "Uses education requirements as a loose proxy for credentialing, specialization, and training friction.",
    growth: "Converts projected employment growth into a wage/outlook support signal.",
  };
  return explanations[key] || `${kind === "risk" ? "Risk" : "Wage"} factor used by the current methodology.`;
}

function renderMetricRows(data, kind) {
  trendChart.innerHTML = `
    <div class="metric-list">
      ${data
        .map(([label, rawValue]) => {
          const value = clamp(toNumber(rawValue));
          return `
            <article class="metric-row">
              <div class="metric-row-header">
                <strong>${escapeHtml(label)}</strong>
                <span>${value}</span>
              </div>
              <div class="metric-bar">
                <span style="width: ${value}%; background: ${metricColor(value, kind)}"></span>
              </div>
              <p>${escapeHtml(metricExplanation(label, kind))}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEmploymentLine(data) {
  const width = 640;
  const height = 255;
  const pad = { top: 18, right: 26, bottom: 34, left: 44 };
  const values = data.flatMap((point) => [point.low, point.high, point.value].map(toNumber));
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const span = Math.max(1, maxValue - minValue);
  const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, data.length - 1);
  const y = (value) => pad.top + (1 - (toNumber(value) - minValue) / span) * (height - pad.top - pad.bottom);
  const pointCoords = data.map((point, index) => [x(index), y(point.value)]);
  const highCoords = data.map((point, index) => [x(index), y(point.high)]);
  const lowCoords = data.map((point, index) => [x(index), y(point.low)]).reverse();
  const linePath = pointCoords.map(([px, py], index) => `${index === 0 ? "M" : "L"} ${px} ${py}`).join(" ");
  const bandPath = [...highCoords, ...lowCoords]
    .map(([px, py], index) => `${index === 0 ? "M" : "L"} ${px} ${py}`)
    .join(" ");

  trendChart.innerHTML = `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Employment projection with confidence interval">
      ${[0, 0.25, 0.5, 0.75, 1]
        .map((ratio) => {
          const gy = pad.top + ratio * (height - pad.top - pad.bottom);
          return `<line class="grid-line" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}"></line>`;
        })
        .join("")}
      ${data
        .map((_, index) => {
          const gx = x(index);
          return `<line class="grid-line" x1="${gx}" y1="${pad.top}" x2="${gx}" y2="${height - pad.bottom}"></line>`;
        })
        .join("")}
      <line class="axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
      <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
      <path class="confidence-band" d="${bandPath} Z"></path>
      <path class="projection-line" d="${linePath}"></path>
      ${pointCoords
        .map(
          ([px, py], index) => `
            <circle class="projection-point" cx="${px}" cy="${py}" r="4"></circle>
            <text class="x-label" x="${px}" y="${height - 10}" text-anchor="middle">${escapeHtml(data[index].label)}</text>
            <text class="point-label" x="${px}" y="${py - 10}" text-anchor="middle">${Math.round(toNumber(data[index].value))}k</text>
          `,
        )
        .join("")}
      <text class="y-label" x="8" y="${pad.top + 8}">${Math.round(maxValue)}k</text>
      <text class="y-label" x="8" y="${height - pad.bottom}">${Math.round(minValue)}k</text>
    </svg>
  `;
}

function renderCompany(analysis) {
  const pressure = analysis.scores.companyPressure;
  companyTitle.textContent = analysis.company.name;
  confidenceLabel.textContent = `${analysis.company.lookupStatus?.includes("enriched") ? "Lookup" : "Classifier"} ${analysis.company.confidence}%`;
  companyRisk.textContent = pressure;
  companyRisk.style.color = riskColor(pressure);
  companyCopy.textContent = `${analysis.company.summary} ${analysis.company.roleFit || ""}`;

  companyBars.innerHTML = analysis.companyBars
    .map(
      ([label, value]) => `
        <div class="mini-bar">
          <header><span>${escapeHtml(label)}</span><strong>${value}</strong></header>
          <div class="signal-track"><span style="width: ${clamp(value)}%; background: ${riskColor(
            label === "Hiring signal" ? 100 - value : value,
          )}"></span></div>
        </div>
      `,
    )
    .join("");
}

function renderEvidence(analysis) {
  const visible = evidenceExpanded ? analysis.evidence : analysis.evidence.slice(0, 6);
  evidenceList.innerHTML = visible
    .map((item) => {
      const source = item.url
        ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.source)}</a>`
        : escapeHtml(item.source);
      const date = item.date ? ` | ${escapeHtml(item.date)}` : "";
      return `
        <article class="evidence-item">
          <header>
            <strong>${escapeHtml(item.title)}</strong>
            <span class="impact ${escapeHtml(item.impact)}">${escapeHtml(item.impact)}</span>
          </header>
          <p>${escapeHtml(item.body)}</p>
          <div class="citation"><span>${escapeHtml(item.type)}</span>${source}${date}</div>
        </article>
      `;
    })
    .join("");

  toggleEvidence.textContent = evidenceExpanded ? "Show less" : "Show all";
}

function renderAgentSteps(analysis) {
  agentSteps.innerHTML = analysis.agentSteps
    .map(
      ([title, body]) => `
        <li>
          <div>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(body)}</span>
          </div>
        </li>
      `,
    )
    .join("");
}

function renderFuturePanel(analysis) {
  futureRisk.textContent = analysis.future?.risk ?? 0;
  futureSecurity.textContent = analysis.future?.security ?? 0;
  futureRisk.style.color = riskColor(analysis.future?.risk || 0);
  futureSecurity.style.color = riskColor(100 - (analysis.future?.security || 0));
  futureRationale.textContent = analysis.future?.rationale || "No field outlook returned.";

  relatedFields.innerHTML = (analysis.relatedFields || [])
    .slice(0, 6)
    .map(
      (field) => `
        <article class="related-field">
          <header>
            <strong>${escapeHtml(field.title)}</strong>
            <span>${escapeHtml(field.security)} security</span>
          </header>
          <span>${escapeHtml(field.group)} | ${escapeHtml(field.growth)}% growth | AI ${escapeHtml(field.aiExposure)}</span>
        </article>
      `,
    )
    .join("");
}

function renderAnalysis(analysis) {
  latestAnalysis = analysis;
  const [label, verdict] = riskText(analysis.scores.score);
  const row = analysis.roleMatch.row;

  matchedRole.textContent = `${analysis.roleMatch.title} (${analysis.roleMatch.confidence}%)`;
  roleHint.textContent = analysis.roleHint?.title
    ? `${analysis.roleHint.title} (${analysis.roleHint.confidence}%)`
    : "No local hint match";
  matchedCompany.textContent = `${analysis.company.label} (${analysis.company.confidence}%)`;
  dataMode.textContent = analysis.mode === "live" ? "Product API" : "Local fallback";
  analysisKicker.textContent = `${analysis.roleMatch.group} | ${analysis.roleMatch.code}`;
  analysisTitle.textContent = `${roleInput.value || analysis.roleMatch.title} at ${analysis.company.name}`;
  riskScore.textContent = analysis.scores.score;
  riskLabel.textContent = label;
  riskRing.style.stroke = riskColor(analysis.scores.score);
  riskRing.style.strokeDashoffset = 402 - (402 * analysis.scores.score) / 100;
  verdictTitle.textContent = verdict;
  verdictCopy.textContent = `${analysis.roleMatch.title} has a ${row.growth_category.toLowerCase()} BLS outlook, a median wage of ${formatWage(
    row.median_wage_2024,
  )}, and a ${row.ai_risk_category.toLowerCase()} CSV AI-risk category. Live source pressure is now incorporated from news, postings, filings, and sentiment when available.`;
  agentStatus.textContent = `Updated ${new Date(analysis.analyzedAt).toLocaleTimeString()}`;

  setSourceStatus(analysis.sourceStatus);
  renderSignals(analysis);
  renderTrend(analysis);
  renderCompany(analysis);
  renderEvidence(analysis);
  renderAgentSteps(analysis);
  renderFuturePanel(analysis);
}

function renderApiError(error) {
  agentStatus.textContent = "Product API unavailable";
  dataMode.textContent = "API unavailable";
  verdictTitle.textContent = "Start the local product server";
  verdictCopy.textContent = `The live ingestion backend is not reachable from this page. Run "npm start" in this folder, then open http://127.0.0.1:8000. Details: ${error.message}`;
}

function setRunning(isRunning) {
  runButton.disabled = isRunning;
  runButton.classList.toggle("is-running", isRunning);
  runButtonLabel.textContent = isRunning ? "Analyzing..." : "Run analysis";
}

function persistWatchlist() {
  localStorage.setItem("jobSecurityWatchlist", JSON.stringify(savedWatches));
}

function renderWatchlist() {
  if (!savedWatches.length) {
    watchlist.innerHTML = `<div class="watch-item"><strong>No saved searches</strong><span>Save a role and company to monitor it.</span></div>`;
    return;
  }

  watchlist.innerHTML = savedWatches
    .map(
      (item, index) => `
        <button class="watch-item" type="button" data-watch-index="${index}">
          <strong>${escapeHtml(item.role)}</strong>
          <span>${escapeHtml(item.company)}</span>
        </button>
      `,
    )
    .join("");
}

async function runAnalysis() {
  const requestId = ++analysisRequest;
  agentStatus.textContent = "Collecting live sources...";
  setRunning(true);

  const params = new URLSearchParams({
    role: roleInput.value,
    company: companyInput.value,
  });

  try {
    const response = await fetch(`/api/analyze?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const analysis = await response.json();
    if (requestId === analysisRequest) renderAnalysis(analysis);
  } catch (error) {
    if (requestId === analysisRequest) renderApiError(error);
  } finally {
    if (requestId === analysisRequest) setRunning(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runAnalysis();
});

[roleInput, companyInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runAnalysis();
    }
  });
});

trendButtons.forEach((button) => {
  button.addEventListener("click", () => {
    trendButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeTrend = button.dataset.view;
    if (latestAnalysis) renderTrend(latestAnalysis);
  });
});

toggleEvidence.addEventListener("click", () => {
  evidenceExpanded = !evidenceExpanded;
  if (latestAnalysis) renderEvidence(latestAnalysis);
});

saveWatch.addEventListener("click", () => {
  const role = roleInput.value.trim();
  const company = companyInput.value.trim();
  if (!role || !company) return;
  const exists = savedWatches.some(
    (item) => item.role.toLowerCase() === role.toLowerCase() && item.company.toLowerCase() === company.toLowerCase(),
  );
  if (!exists) {
    savedWatches = [{ role, company }, ...savedWatches].slice(0, 8);
    persistWatchlist();
    renderWatchlist();
  }
});

watchlist.addEventListener("click", (event) => {
  const item = event.target.closest("[data-watch-index]");
  if (!item) return;
  const saved = savedWatches[Number(item.dataset.watchIndex)];
  roleInput.value = saved.role;
  companyInput.value = saved.company;
  runAnalysis();
});

renderWatchlist();
runAnalysis();
