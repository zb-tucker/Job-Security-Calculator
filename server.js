const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const CACHE_TTL_MS = 1000 * 60 * 30;
const REQUEST_TIMEOUT_MS = 7000;
const LLM_TIMEOUT_MS = 4500;
const LLM_MODEL = process.env.JSC_LLM_MODEL || "llama3.2:3b";
const LLM_URL = process.env.JSC_LLM_URL || "http://127.0.0.1:11434/api/generate";
const UNCLASSIFIED_ROLE = {
  occupation_title: "Unclassified role",
  occupation_code: "N/A",
  soc_major_code: "N/A",
  occupation_group: "Unknown occupation group",
  employment_2024: "0",
  employment_2034: "0",
  emp_change_pct: "0",
  median_wage_2024: "0",
  education_required: "Unknown",
  education_level: "0",
  automation_risk_score: "5",
  ai_risk_category: "Unknown",
  collar_type: "Unknown",
  growth_category: "Unknown",
  PosEmpChange: "FALSE",
};

const cache = new Map();
let blsRowsPromise;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const COMPANY_PROFILES = [
  {
    id: "large-tech",
    label: "Large technology platform",
    keywords: ["meta", "facebook", "google", "alphabet", "amazon", "apple", "microsoft", "netflix", "openai", "anthropic", "oracle", "salesforce", "adobe", "software", "saas", "cloud", "tech"],
    tickers: { meta: "META", facebook: "META", google: "GOOGL", alphabet: "GOOGL", amazon: "AMZN", apple: "AAPL", microsoft: "MSFT", netflix: "NFLX" },
    layoffMomentum: 74,
    automationPosture: 84,
    monitoringRisk: 66,
    hiringSignal: 54,
    sentimentRisk: 62,
    summary:
      "Large technology platforms have strong AI investment, high internal tooling leverage, and a recent history of efficiency programs. Role security varies sharply by team and business priority.",
  },
  {
    id: "healthcare",
    label: "Healthcare provider",
    keywords: ["hospital", "clinic", "health", "mayo", "kaiser", "hca", "cleveland", "medical", "care"],
    tickers: { hca: "HCA" },
    layoffMomentum: 32,
    automationPosture: 41,
    monitoringRisk: 44,
    hiringSignal: 78,
    sentimentRisk: 38,
    summary:
      "Healthcare providers face budget and reimbursement pressure, but licensed and patient-facing work tends to retain strong labor demand.",
  },
  {
    id: "finance",
    label: "Banking and financial services institution",
    keywords: ["bank", "banking", "credit union", "federal credit union", "navy federal", "jpmorgan", "chase", "goldman", "morgan stanley", "wells", "capital", "insurance", "fintech", "finance", "lending", "mortgage"],
    tickers: { jpmorgan: "JPM", chase: "JPM", goldman: "GS", "morgan stanley": "MS", wells: "WFC", citigroup: "C", citi: "C", "bank of america": "BAC" },
    layoffMomentum: 52,
    automationPosture: 66,
    monitoringRisk: 48,
    hiringSignal: 50,
    sentimentRisk: 50,
    summary:
      "Financial employers are adopting automation in reporting, underwriting, risk review, and support operations while keeping demand for controls and client accountability.",
  },
  {
    id: "manufacturing",
    label: "Industrial or manufacturing employer",
    keywords: ["manufacturing", "factory", "automotive", "tesla", "ford", "gm", "boeing", "industrial", "semiconductor", "plant"],
    tickers: { tesla: "TSLA", ford: "F", boeing: "BA" },
    layoffMomentum: 42,
    automationPosture: 62,
    monitoringRisk: 39,
    hiringSignal: 63,
    sentimentRisk: 44,
    summary:
      "Industrial employers can reduce routine labor through robotics while increasing demand for maintenance, controls, quality, and technical operations.",
  },
  {
    id: "customer-operations",
    label: "Customer operations or outsourcing vendor",
    keywords: ["support", "call center", "contact center", "outsourcing", "bpo", "concentrix", "teleperformance", "customer"],
    tickers: { concentrix: "CNXC" },
    layoffMomentum: 66,
    automationPosture: 86,
    monitoringRisk: 64,
    hiringSignal: 36,
    sentimentRisk: 68,
    summary:
      "High-volume customer operations are exposed to chat, voice, routing, and self-service automation, especially for routine tier-one work.",
  },
  {
    id: "retail",
    label: "Retail and consumer services employer",
    keywords: ["walmart", "target", "costco", "kroger", "retail", "store", "restaurant", "mcdonald", "starbucks", "consumer", "ecommerce"],
    tickers: { walmart: "WMT", target: "TGT", costco: "COST", kroger: "KR", starbucks: "SBUX", mcdonald: "MCD" },
    layoffMomentum: 46,
    automationPosture: 58,
    monitoringRisk: 55,
    hiringSignal: 60,
    sentimentRisk: 47,
    summary:
      "Retail and consumer services employers combine large frontline workforces with automation in scheduling, inventory, self-checkout, fulfillment, customer support, and analytics.",
  },
  {
    id: "government-defense",
    label: "Government, military, or defense institution",
    keywords: ["navy", "army", "air force", "defense", "dod", "federal", "government", "lockheed", "raytheon", "northrop", "general dynamics"],
    tickers: { lockheed: "LMT", raytheon: "RTX", northrop: "NOC", "general dynamics": "GD" },
    layoffMomentum: 30,
    automationPosture: 52,
    monitoringRisk: 48,
    hiringSignal: 64,
    sentimentRisk: 36,
    summary:
      "Government and defense-linked institutions are shaped by budgets, contracting cycles, clearance requirements, modernization programs, and slower but durable technology adoption.",
  },
  {
    id: "early-stage-startup",
    label: "Early-stage venture-backed startup",
    keywords: ["startup", "seed", "series a", "series b", "venture backed", "vc backed", "founders fund", "y combinator", "accelerator"],
    tickers: {},
    layoffMomentum: 62,
    automationPosture: 72,
    monitoringRisk: 38,
    hiringSignal: 48,
    sentimentRisk: 58,
    maturityRisk: 78,
    summary:
      "Early-stage venture-backed startups are shaped by runway, fundraising cycles, burn rate, product-market fit, and investor pressure. Layoff risk can rise quickly even when the industry is growing.",
  },
  {
    id: "growth-stage-startup",
    label: "Growth-stage startup",
    keywords: ["series c", "series d", "growth stage", "unicorn", "pre ipo", "scaleup", "scale up"],
    tickers: {},
    layoffMomentum: 58,
    automationPosture: 74,
    monitoringRisk: 46,
    hiringSignal: 52,
    sentimentRisk: 55,
    maturityRisk: 66,
    summary:
      "Growth-stage startups often swing between rapid hiring and efficiency pushes as they prepare for profitability, acquisition, or public-market scrutiny.",
  },
  {
    id: "private-equity",
    label: "Private-equity backed company",
    keywords: ["private equity", "pe backed", "portfolio company", "buyout", "blackstone", "kkr", "apollo", "carlyle", "thoma bravo", "vista equity"],
    tickers: {},
    layoffMomentum: 70,
    automationPosture: 68,
    monitoringRisk: 58,
    hiringSignal: 42,
    sentimentRisk: 62,
    maturityRisk: 74,
    summary:
      "Private-equity backed employers can have elevated restructuring pressure from margin expansion, debt service, operational consolidation, and cost takeout programs.",
  },
  {
    id: "mid-market-private",
    label: "Mid-market private company",
    keywords: ["mid market", "family owned", "privately held", "private company", "regional company"],
    tickers: {},
    layoffMomentum: 44,
    automationPosture: 48,
    monitoringRisk: 36,
    hiringSignal: 50,
    sentimentRisk: 42,
    maturityRisk: 42,
    summary:
      "Mid-market private companies often move more slowly than public firms or venture-backed startups, but can face abrupt changes from ownership transitions, debt, customer concentration, or modernization projects.",
  },
  {
    id: "education",
    label: "Education institution",
    keywords: ["university", "college", "school", "education", "academy", "district"],
    tickers: {},
    layoffMomentum: 38,
    automationPosture: 42,
    monitoringRisk: 34,
    hiringSignal: 52,
    sentimentRisk: 40,
    summary:
      "Education institutions face enrollment, budget, and policy pressure while adopting AI for administration, content, advising, and assessment workflows.",
  },
  {
    id: "media-entertainment",
    label: "Media and entertainment",
    keywords: ["disney", "warner", "paramount", "fox", "nyt", "media", "journalism", "news", "entertainment", "studio", "publishing"],
    tickers: { disney: "DIS", warner: "WBD", paramount: "PARA", fox: "FOXA", nyt: "NYT" },
    layoffMomentum: 78,
    automationPosture: 82,
    monitoringRisk: 50,
    hiringSignal: 40,
    sentimentRisk: 75,
    summary: "Media companies are facing structural declines in traditional channels, pivoting to digital, and heavily leveraging generative AI for content production, leading to high job insecurity in creative and production roles.",
  },
  {
    id: "energy-utilities",
    label: "Energy and utilities",
    keywords: ["exxon", "chevron", "shell", "bp", "energy", "oil", "gas", "utility", "solar", "wind", "power"],
    tickers: { exxon: "XOM", chevron: "CVX", shell: "SHEL", bp: "BP", nextera: "NEE" },
    layoffMomentum: 35,
    automationPosture: 55,
    monitoringRisk: 40,
    hiringSignal: 60,
    sentimentRisk: 35,
    summary: "Energy and utilities offer high job security due to constant baseline demand and infrastructure needs. Automation is focused on grid management and extraction optimization rather than replacing field operators.",
  },
  {
    id: "logistics-transportation",
    label: "Logistics and transportation",
    keywords: ["ups", "fedex", "dhl", "xpo", "maersk", "delta", "united", "american airlines", "logistics", "freight", "shipping", "airline", "transportation"],
    tickers: { ups: "UPS", fedex: "FDX", delta: "DAL", united: "UAL", "american airlines": "AAL" },
    layoffMomentum: 55,
    automationPosture: 70,
    monitoringRisk: 85,
    hiringSignal: 50,
    sentimentRisk: 60,
    summary: "Logistics faces heavy automation in routing, warehouse robotics, and eventually autonomous vehicles. Monitoring risk is extremely high for fleet and warehouse workers to enforce productivity standards.",
  },
  {
    id: "professional-services",
    label: "Professional services and consulting",
    keywords: ["deloitte", "pwc", "ey", "kpmg", "mckinsey", "bain", "bcg", "accenture", "consulting", "accounting", "legal", "law firm"],
    tickers: { accenture: "ACN" },
    layoffMomentum: 65,
    automationPosture: 88,
    monitoringRisk: 60,
    hiringSignal: 45,
    sentimentRisk: 65,
    summary: "Professional services are highly exposed to AI automation for document review, legal discovery, and junior-level data analysis, prompting a workforce shift toward leaner teams and senior advisory roles.",
  },
  {
    id: "real-estate-construction",
    label: "Real estate and construction",
    keywords: ["cbre", "jll", "zillow", "lennar", "toll brothers", "construction", "real estate", "property management", "builder"],
    tickers: { cbre: "CBRE", jll: "JLL", zillow: "Z", lennar: "LEN", "toll brothers": "TOL" },
    layoffMomentum: 60,
    automationPosture: 35,
    monitoringRisk: 30,
    hiringSignal: 45,
    sentimentRisk: 55,
    summary: "Cyclical by nature, real estate and construction job security is tied closely to interest rates. However, physical construction trades remain highly resistant to near-term software automation.",
  },
  {
    id: "biotech-pharma",
    label: "Biotechnology and pharmaceuticals",
    keywords: ["pfizer", "moderna", "johnson", "amgen", "merck", "biotech", "pharma", "clinical", "drug", "life sciences"],
    tickers: { pfizer: "PFE", moderna: "MRNA", "johnson & johnson": "JNJ", amgen: "AMGN", merck: "MRK" },
    layoffMomentum: 48,
    automationPosture: 75,
    monitoringRisk: 45,
    hiringSignal: 65,
    sentimentRisk: 42,
    summary: "Pharma utilizes AI heavily for drug discovery and trial data analysis. These tools largely act as force multipliers rather than replacements, maintaining strong structural demand for specialized researchers.",
  },
  {
    id: "hospitality-travel",
    label: "Hospitality and travel",
    keywords: ["marriott", "hilton", "hyatt", "carnival", "royal caribbean", "airbnb", "hotel", "hospitality", "cruise", "travel"],
    tickers: { marriott: "MAR", hilton: "HLT", carnival: "CCL", "royal caribbean": "RCL", airbnb: "ABNB" },
    layoffMomentum: 40,
    automationPosture: 45,
    monitoringRisk: 50,
    hiringSignal: 70,
    sentimentRisk: 40,
    summary: "Hospitality relies on human-centric service, making frontline roles secure from pure automation, though algorithmic dynamic pricing and centralized management systems handle the backend.",
  },
  {
    id: "telecommunications",
    label: "Telecommunications provider",
    keywords: ["verizon", "att", "t-mobile", "comcast", "charter", "telecom", "isp", "broadband", "wireless"],
    tickers: { verizon: "VZ", "at&t": "T", "t-mobile": "TMUS", comcast: "CMCSA", charter: "CHTR" },
    layoffMomentum: 68,
    automationPosture: 72,
    monitoringRisk: 65,
    hiringSignal: 40,
    sentimentRisk: 64,
    summary: "Telecom providers face saturated growth and frequently execute restructuring and efficiency programs. Network management and customer service are heavily targeted for automation.",
  },
  {
    id: "general",
    label: "General employer",
    keywords: [],
    tickers: {},
    layoffMomentum: 45,
    automationPosture: 50,
    monitoringRisk: 42,
    hiringSignal: 50,
    sentimentRisk: 45,
    summary: "This company is not recognized by the local classifier, so the app uses a neutral employer profile and relies more heavily on live source results.",
  },
  {
    id: "general",
    label: "General employer",
    keywords: [],
    tickers: {},
    layoffMomentum: 45,
    automationPosture: 50,
    monitoringRisk: 42,
    hiringSignal: 50,
    sentimentRisk: 45,
    summary:
      "This company is not recognized by the local classifier, so the app uses a neutral employer profile and relies more heavily on live source results.",
  },
];

const ANTHROPIC_AI_COVERAGE = {
  "Management occupations": 74,
  "Business and financial operations occupations": 82,
  "Computer and mathematical occupations": 90,
  "Architecture and engineering occupations": 66,
  "Life, physical, and social science occupations": 76,
  "Community and social service occupations": 50,
  "Legal occupations": 95,
  "Educational instruction and library occupations": 48,
  "Arts, design, entertainment, sports, and media occupations": 83,
  "Healthcare practitioners and technical occupations": 72,
  "Healthcare support occupations": 58,
  "Protective service occupations": 22,
  "Food preparation and serving related occupations": 18,
  "Building and grounds cleaning and maintenance occupations": 16,
  "Personal care and service occupations": 24,
  "Sales and related occupations": 60,
  "Office and administrative support occupations": 92,
  "Farming, fishing, and forestry occupations": 20,
  "Construction and extraction occupations": 18,
  "Installation, maintenance, and repair occupations": 23,
  "Production occupations": 34,
  "Transportation and material moving occupations": 28,
};

const ROLE_HINTS = [
  ["ceo chief executive president founder", "Chief executives"],
  ["operations manager general manager business operations", "General and operations managers"],
  ["marketing manager growth manager brand manager", "Marketing managers"],
  ["sales manager revenue manager account manager", "Sales managers"],
  ["administrative manager office manager facilities manager", "Administrative services managers"],
  ["it manager technology manager cio cto information systems manager", "Computer and information systems managers"],
  ["finance manager controller treasury fp&a financial planning", "Financial managers"],
  ["production manager plant manager manufacturing manager", "Industrial production managers"],
  ["purchasing procurement sourcing manager", "Purchasing managers"],
  ["logistics manager distribution manager supply chain manager transportation manager", "Transportation, storage, and distribution managers"],
  ["compensation benefits total rewards", "Compensation and benefits managers"],
  ["hr manager people manager human resources manager", "Human resources managers"],
  ["training manager learning development manager", "Training and development managers"],
  ["construction manager project superintendent", "Construction managers"],
  ["school administrator principal dean", "Education administrators, kindergarten through secondary"],
  ["college administrator university administrator provost", "Education administrators, postsecondary"],
  ["engineering manager architecture manager", "Architectural and engineering managers"],
  ["restaurant manager food service manager", "Food service managers"],
  ["hotel manager lodging manager hospitality manager", "Lodging managers"],
  ["health services manager clinic administrator hospital administrator", "Medical and health services managers"],
  ["property manager real estate manager hoa manager", "Property, real estate, and community association managers"],
  ["claims adjuster claims examiner insurance claims", "Claims adjusters, examiners, and investigators"],
  ["compliance analyst compliance officer risk compliance", "Compliance officers"],
  ["cost estimator estimating analyst", "Cost estimators"],
  ["hr specialist recruiter talent acquisition people operations", "Human resources specialists"],
  ["labor relations union relations employee relations", "Labor relations specialists"],
  ["logistician logistics analyst supply chain analyst", "Logisticians"],
  ["management consultant business consultant strategy analyst", "Management analysts"],
  ["event planner conference planner meeting planner", "Meeting, convention, and event planners"],
  ["fundraiser development officer advancement", "Fundraisers"],
  ["job analyst compensation analyst benefits analyst", "Compensation, benefits, and job analysis specialists"],
  ["training specialist instructional designer learning development", "Training and development specialists"],
  ["market research marketer marketing analyst seo analyst", "Market research analysts and marketing specialists"],
  ["accountant auditor accounting cpa", "Accountants and auditors"],
  ["budget analyst budgeting", "Budget analysts"],
  ["credit analyst lending analyst", "Credit analysts"],
  ["financial advisor wealth advisor planner", "Personal financial advisors"],
  ["underwriter underwriting insurance", "Insurance underwriters"],
  ["financial examiner bank examiner compliance examiner", "Financial examiners"],
  ["credit counselor loan counselor", "Credit counselors"],
  ["loan officer mortgage officer lending officer", "Loan officers"],
  ["tax examiner revenue agent tax collector", "Tax examiners and collectors, and revenue agents"],
  ["tax preparer tax associate", "Tax preparers"],
  ["software engineer software developer developer programmer coding backend frontend full stack application engineer platform engineer", "Software developers"],
  ["ai engineer ai developer machine learning engineer deep learning engineer ml engineer artificial intelligence engineer", "Computer and information research scientists"],
  ["business systems analyst systems analyst product analyst", "Computer systems analysts"],
  ["cybersecurity analyst security analyst information security soc analyst", "Information security analysts"],
  ["research scientist computer scientist ai researcher machine learning researcher", "Computer and information research scientists"],
  ["help desk network support desktop support it support", "Computer network support specialists"],
  ["technical support user support support specialist", "Computer user support specialists"],
  ["network architect cloud architect infrastructure architect", "Computer network architects"],
  ["database administrator dba data administrator", "Database administrators"],
  ["data architect database architect", "Database architects"],
  ["system administrator sysadmin network administrator", "Network and computer systems administrators"],
  ["qa tester quality assurance software tester test engineer", "Software quality assurance analysts and testers"],
  ["web developer frontend developer wordpress developer", "Web developers"],
  ["actuary actuarial analyst", "Actuaries"],
  ["cybersecurity specialist information security analyst", "Information security analysts"],
  ["cyber threat analyst threat intelligence analyst", "Information security analysts"],
  ["data scientist statistician analytics scientist", "Statisticians"],
  ["operations research analyst optimization analyst", "Operations research analysts"],
  ["architect building architect", "Architects, except landscape and naval"],
  ["landscape architect", "Landscape architects"],
  ["aerospace engineer", "Aerospace engineers"],
  ["biomedical engineer bioengineer", "Bioengineers and biomedical engineers"],
  ["chemical engineer process engineer", "Chemical engineers"],
  ["civil engineer structural engineer", "Civil engineers"],
  ["hardware engineer computer hardware engineer", "Computer hardware engineers"],
  ["electrical engineer", "Electrical engineers"],
  ["electronics engineer", "Electronics engineers, except computer"],
  ["environmental engineer", "Environmental engineers"],
  ["industrial engineer process improvement engineer", "Industrial engineers"],
  ["mechanical engineer", "Mechanical engineers"],
  ["drafting drafter cad technician", "Architectural and civil drafters"],
  ["mechatronics technician robotics technician automation technician", "Electro-mechanical and mechatronics technologists and technicians"],
  ["biochemist biophysicist", "Biochemists and biophysicists"],
  ["microbiologist", "Microbiologists"],
  ["epidemiologist public health scientist", "Epidemiologists"],
  ["medical scientist clinical researcher", "Medical scientists, except epidemiologists"],
  ["chemist", "Chemists"],
  ["environmental scientist", "Environmental scientists and specialists, including health"],
  ["economist", "Economists"],
  ["survey researcher pollster", "Survey researchers"],
  ["psychologist clinical counselor therapist", "Clinical and counseling psychologists"],
  ["school psychologist", "School psychologists"],
  ["urban planner regional planner", "Urban and regional planners"],
  ["research assistant social science assistant", "Social science research assistants"],
  ["forensic technician crime lab", "Forensic science technicians"],
  ["safety specialist occupational health safety", "Occupational health and safety specialists"],
  ["nursing assistant cna", "Nursing assistants"],
  ["medical assistant healthcare assistant", "Medical assistants"],
  ["medical transcriptionist transcription", "Medical transcriptionists"],
  ["phlebotomist", "Phlebotomists"],
  ["childcare worker daycare worker", "Childcare workers"],
  ["fitness trainer personal trainer", "Exercise trainers and group fitness instructors"],
  ["office supervisor administrative supervisor", "First-line supervisors of office and administrative support workers"],
  ["billing clerk billing specialist", "Billing and posting clerks"],
  ["bookkeeper accounting clerk auditing clerk", "Bookkeeping, accounting, and auditing clerks"],
  ["payroll clerk timekeeping payroll specialist", "Payroll and timekeeping clerks"],
  ["bank teller teller branch teller", "Tellers"],
  ["brokerage clerk securities clerk", "Brokerage clerks"],
  ["customer support customer service call center support representative", "Customer service representatives"],
  ["eligibility interviewer benefits interviewer", "Eligibility interviewers, government programs"],
  ["file clerk records clerk", "File clerks"],
  ["front desk hotel desk clerk", "Hotel, motel, and resort desk clerks"],
  ["library assistant", "Library assistants, clerical"],
  ["loan interviewer loan processor", "Loan interviewers and clerks"],
  ["new accounts banker account clerk", "New accounts clerks"],
  ["order clerk order entry", "Order clerks"],
  ["hr assistant human resources assistant", "Human resources assistants, except payroll and timekeeping"],
  ["receptionist information clerk", "Receptionists and information clerks"],
  ["travel agent reservation agent ticket agent", "Reservation and transportation ticket agents and travel clerks"],
  ["dispatcher logistics dispatcher", "Dispatchers, except police, fire, and ambulance"],
  ["mail carrier postal carrier", "Postal service mail carriers"],
  ["production planner expeditor", "Production, planning, and expediting clerks"],
  ["shipping receiving inventory clerk warehouse clerk", "Shipping, receiving, and inventory clerks"],
  ["executive assistant executive secretary", "Executive secretaries and executive administrative assistants"],
  ["legal assistant legal secretary", "Legal secretaries and administrative assistants"],
  ["medical secretary medical administrative assistant", "Medical secretaries and administrative assistants"],
  ["administrative assistant secretary office assistant", "Secretaries and administrative assistants, except legal, medical, and executive"],
  ["data entry clerk typist data keyer", "Data entry keyers"],
  ["word processor typist", "Word processors and typists"],
  ["desktop publisher layout designer", "Desktop publishers"],
  ["insurance processing clerk policy processing", "Insurance claims and policy processing clerks"],
  ["office clerk general clerk", "Office clerks, general"],
  ["proofreader copy editor", "Proofreaders and copy markers"],
  ["statistical assistant data assistant", "Statistical assistants"],
  ["farmworker agricultural worker", "Farmworkers and laborers, crop, nursery, and greenhouse"],
  ["forestry worker conservation worker", "Forest and conservation workers"],
  ["lawyer attorney counsel prosecutor", "Lawyers"],
  ["paralegal legal assistant", "Paralegals and legal assistants"],
  ["teacher elementary school teacher educator", "Elementary school teachers, except special education"],
  ["professor instructor faculty lecturer", "Postsecondary teachers, all other"],
  ["graphic designer visual designer", "Graphic designers"],
  ["writer author copywriter copy creator", "Writers and authors"],
  ["cashier retail clerk checkout", "Cashiers"],
  ["retail sales associate retail worker", "Retail salespersons"],
  ["real estate agent realtor broker", "Real estate brokers and sales agents"],
  ["chef head cook culinary", "Chefs and head cooks"],
  ["waiter waitress server", "Waiters and waitresses"],
  ["police officer law enforcement cop", "Police and sheriff's patrol officers"],
  ["security guard loss prevention", "Security guards"],
  ["carpenter woodworker builder", "Carpenters"],
  ["electrician electrical worker wireman", "Electricians"],
  ["truck driver delivery driver cdl driver", "Heavy and tractor-trailer truck drivers"],
  ["registered nurse rn nurse", "Registered nurses"],
  ["physician doctor md do pediatrician surgeon", "Physicians, all other"],
  ["pharmacist", "Pharmacists"],
  ["dentist orthodontist", "Dentists, general"],
  ["physical therapist pt physiotherapy", "Physical therapists"],
  ["janitor custodian cleaner housekeeping", "Janitors and cleaners, except maids and housekeeping cleaners"],
  ["hairdresser cosmetologist stylist barber salon", "Hairdressers, hairstylists, and cosmetologists"],
  ["flight attendant cabin crew steward", "Flight attendants"],
  ["mechanic auto mechanic automotive technician car repair", "Automotive service technicians and mechanics"],
  ["hvac technician ac repair heating technician", "Heating, air conditioning, and refrigeration mechanics and installers"],
  ["welder fabricator soldering", "Welders, cutters, solderers, and brazers"],
  ["machinist cnc operator machine setter", "Machinists"],
  ["public relations pr specialist communications specialist media relations", "Public relations specialists"],
  ["photographer photojournalist cameraman", "Photographers"],
  ["video editor film editor videographer", "Film and video editors"],
  ["data engineer big data engineer etl developer pipeline engineer", "Software developers"],
  ["mlops engineer machine learning operations ai infrastructure model deployment", "Software developers"],
  ["data architect enterprise data architect data modeler", "Database architects"],
  ["machine learning architect ai architect neural network lead", "Computer and information research scientists"],
  ["data analyst business intelligence analyst bi analyst", "Data scientists"],
  ["analytics engineer dbt developer data analytics engineer", "Data scientists"],
  ["applied scientist research scientist physics informed neural networks pinn", "Computer and information research scientists"],
  ["nlp engineer natural language processing rag engineer llm developer", "Computer and information research scientists"],
  ["computer vision engineer cv engineer machine vision", "Computer and information research scientists"],
  ["graph machine learning engineer gnn engineer spatial network analysis", "Computer and information research scientists"],
  ["ai ethicist ai safety researcher responsible ai", "Computer and information research scientists"],
  ["prompt engineer ai prompt developer", "Computer occupations, all other"],
];

const RISK_TERMS = [
  "layoff",
  "layoffs",
  "restructuring",
  "downsizing",
  "hiring freeze",
  "cost cutting",
  "automation",
  "automate",
  "ai",
  "productivity",
  "efficiency",
  "monitoring",
  "outsourcing",
  "offshoring",
  "closure",
  "bankruptcy",
];

const POSITIVE_TERMS = [
  "hiring",
  "expansion",
  "growth",
  "invest",
  "investment",
  "raise",
  "new jobs",
  "opening",
  "demand",
  "profit",
  "revenue",
];

const GENERIC_ROLE_TOKENS = new Set([
  "analyst",
  "manager",
  "specialist",
  "assistant",
  "associate",
  "engineer",
  "technician",
  "worker",
  "clerk",
  "administrator",
  "representative",
  "officer",
  "consultant",
  "coordinator",
  "planner",
  "advisor",
  "developer",
  "designer",
  "scientist",
  "sales",
]);

const GENERIC_ROLE_FALLBACKS = new Map([
  ["engineer", "Engineers, all other"],
  ["developer", "Software developers"],
  ["programmer", "Computer programmers"],
  ["analyst", "Business operations specialists, all other"],
  ["manager", "Managers, all other"],
  ["specialist", "Business operations specialists, all other"],
  ["technician", "Engineering technologists and technicians, except drafters, all other"],
  ["administrator", "Database administrators"],
  ["assistant", "Secretaries and administrative assistants, except legal, medical, and executive"],
  ["consultant", "Management analysts"],
  ["designer", "Designers, all other"],
  ["scientist", "Life scientists, all other"],
  ["teacher", "Elementary school teachers, except special education"],
  ["nurse", "Registered nurses"],
  ["attorney", "Lawyers"],
  ["lawyer", "Lawyers"],
  ["sales", "Sales representatives of services, except advertising, insurance, financial services, and travel"],
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFor(value) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 2)
    .map((token) => singularize(token));
}

function singularize(token) {
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ers")) return token.slice(0, -1);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

function toNumber(value) {
  return Number.parseFloat(String(value || "0").replace(/,/g, "")) || 0;
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseDelimitedLine(line, delimiter = ";") {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value.trim());
  return values;
}

function parseCsv(text, source = "CSV") {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = parseDelimitedLine(lines.shift() || "").map((header) => header.trim());
  return lines.map((line) => {
    const values = parseDelimitedLine(line);
    return {
      ...Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])),
      data_source: source,
    };
  });
}

async function loadBlsRows() {
  if (!blsRowsPromise) {
    blsRowsPromise = Promise.allSettled([
      fs.readFile(path.join(ROOT, "BLS_occupation_2024_2034.csv"), "utf8"),
      fs.readFile(path.join(ROOT, "US_BLS_Employment_subset.csv"), "utf8"),
    ]).then((results) => {
      const [official, local] = results;
      const rowsByCode = new Map();

      if (official.status === "fulfilled") {
        parseCsv(official.value, "BLS_occupation_2024_2034.csv").forEach((row) => {
          if (row.occupation_code) rowsByCode.set(row.occupation_code, row);
        });
      }

      if (local.status === "fulfilled") {
        parseCsv(local.value, "US_BLS_Employment_subset.csv").forEach((row) => {
          if (row.occupation_code) rowsByCode.set(row.occupation_code, row);
        });
      }

      return [...rowsByCode.values()].filter((row) => row.occupation_title && row.occupation_code);
    });
  }
  return blsRowsPromise;
}

function scoreOccupationText(queryTokens, row, aliasBoost = 0) {
  const title = normalize(row.occupation_title);
  const group = normalize(row.occupation_group);
  const code = normalize(row.occupation_code);
  const text = `${title} ${group} ${code}`;
  const titleTokens = new Set(tokensFor(title));
  const groupTokens = new Set(tokensFor(group));
  const queryText = queryTokens.join(" ");
  const exactTitle = queryText === title;
  const titleContainsQuery = queryText.length > 3 && title.includes(queryText);
  const queryContainsTitle = title.length > 3 && queryText.includes(title);

  return queryTokens.reduce((sum, token) => {
    if (titleTokens.has(token)) return sum + 8;
    if (title.includes(token)) return sum + 5;
    if (title.includes(`${token}er`) || title.includes(`${token}or`) || title.includes(`${token}ist`)) return sum + 4;
    if (groupTokens.has(token)) return sum + 3;
    if (group.includes(token)) return sum + 2;
    if (text.includes(token.slice(0, -1))) return sum + 1;
    return sum;
  }, (exactTitle ? 40 : 0) + (titleContainsQuery ? 22 : 0) + (queryContainsTitle ? 16 : 0) + aliasBoost);
}

function bestRowForText(text, blsRows, aliasBoost = 0) {
  const queryTokens = tokensFor(text);
  let best = blsRows[0];
  let bestScore = -1;

  blsRows.forEach((row) => {
    const score = scoreOccupationText(queryTokens, row, aliasBoost);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  });

  return { row: best, score: bestScore, tokenCount: queryTokens.length };
}

function findPreferredRole(query, blsRows) {
  const normalizedQuery = normalize(query);
  const exactTitle = blsRows.find((row) => normalize(row.occupation_title) === normalizedQuery);
  if (exactTitle) {
    return {
      row: exactTitle,
      confidence: 96,
      method: "exact BLS occupation title",
      alternatives: [],
      hint: {
        title: exactTitle.occupation_title,
        confidence: 96,
        terms: exactTitle.occupation_title,
        method: "exact BLS title",
      },
    };
  }

  const genericFallbackTitle = GENERIC_ROLE_TOKENS.has(normalizedQuery) && GENERIC_ROLE_FALLBACKS.get(normalizedQuery);
  const genericFallback = genericFallbackTitle && blsRows.find((row) => normalize(row.occupation_title) === normalize(genericFallbackTitle));
  if (genericFallback) {
    return {
      row: genericFallback,
      confidence: 68,
      method: `generic BLS fallback for "${normalizedQuery}"`,
      alternatives: [],
      hint: {
        title: genericFallback.occupation_title,
        confidence: 68,
        terms: normalizedQuery,
        method: "generic BLS fallback",
      },
    };
  }

  const aliasMatches = ROLE_HINTS.map(([terms, target]) => {
    const termTokens = terms
      .split(" ")
      .map(singularize)
      .filter((term) => term.length > 2 && !GENERIC_ROLE_TOKENS.has(term));
    const tokenHits = termTokens.filter((term) => normalizedQuery.includes(term)).length;
    const phraseHit = normalize(terms).includes(normalizedQuery) || normalizedQuery.includes(normalize(target));
    const hits = tokenHits + (phraseHit ? 2 : 0);
    return { target, hits, tokenHits, phraseHit, terms };
  })
    .filter((match) => match.hits >= 2 || (match.tokenHits >= 1 && match.phraseHit))
    .sort((a, b) => b.hits - a.hits);

  if (aliasMatches.length) {
    const alias = aliasMatches[0];
    const exact = blsRows.find((row) => normalize(row.occupation_title) === normalize(alias.target));
    if (exact) {
      return {
        row: exact,
        confidence: clamp(72 + alias.hits * 4),
        method: `alias: ${alias.target}`,
        alternatives: aliasMatches.slice(1, 4).map((item) => item.target),
        hint: {
          title: alias.target,
          confidence: clamp(72 + alias.hits * 4),
          terms: alias.terms,
          method: "local role hint",
        },
      };
    }

    const aliasBest = bestRowForText(`${alias.target} ${alias.terms}`, blsRows, 10);
    return {
      row: aliasBest.row,
      confidence: clamp(66 + alias.hits * 4 + aliasBest.score),
      method: `alias fuzzy: ${alias.target}`,
      alternatives: aliasMatches.slice(1, 4).map((item) => item.target),
      hint: {
        title: alias.target,
        confidence: clamp(66 + alias.hits * 4),
        terms: alias.terms,
        method: "local role hint fuzzy",
      },
    };
  }

  const best = bestRowForText(query, blsRows);
  return {
    row: best.row,
    confidence: clamp(38 + best.score * 5 + Math.min(best.tokenCount, 4) * 2),
    method: best.score > 0 ? "BLS title/group token similarity" : "default nearest sample",
    alternatives: blsRows
      .map((row) => ({ row, score: scoreOccupationText(tokensFor(query), row) }))
      .sort((a, b) => b.score - a.score)
      .slice(1, 4)
      .map((item) => item.row.occupation_title),
    hint: null,
  };
}

async function semanticallyRefineRole(query, initialMatch, blsRows) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || normalizedQuery.length < 3) {
    return {
      row: UNCLASSIFIED_ROLE,
      confidence: 0,
      method: "missing role input",
      alternatives: [],
      semantic: { status: "skipped", model: LLM_MODEL },
    };
  }

  const candidateMap = new Map();
  if (initialMatch?.row?.occupation_code && initialMatch.row.occupation_code !== "N/A") {
    candidateMap.set(initialMatch.row.occupation_code, { row: initialMatch.row, score: 999 });
  }

  blsRows
    .map((row) => ({ row, score: scoreOccupationText(tokensFor(query), row) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 48)
    .forEach((item) => candidateMap.set(item.row.occupation_code, item));

  const candidates = [...candidateMap.values()]
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({
      index,
      title: item.row.occupation_title,
      group: item.row.occupation_group,
      code: item.row.occupation_code,
      growth: item.row.emp_change_pct,
      aiRisk: item.row.ai_risk_category,
    }));

  const prompt = `You are a careful occupation classifier and validation layer. Pick the best BLS occupation for the user job title. Reject misleading lexical matches, especially cases where a short token or generic word such as "engineer", "analyst", or "manager" is the only connection. If none of the candidates are a plausible match, return index -1.
User job title: "${query}"
Initial heuristic match: "${initialMatch.row.occupation_title}" by ${initialMatch.method}
Candidates JSON: ${JSON.stringify(candidates)}
Return ONLY JSON: {"index": number, "confidence": 0-100, "reason": "short reason"}`;
  const result = await callSmallModel(prompt);
  if (result.status === "live") {
    if (result.data.index === -1 || result.data.confidence < 45 || !candidates[result.data.index]) {
      return {
        row: UNCLASSIFIED_ROLE,
        confidence: clamp(result.data.confidence || 0),
        method: `small model rejected match: ${result.data.reason || "no plausible BLS occupation"}`,
        alternatives: candidates.slice(0, 4).map((candidate) => candidate.title),
        hint: initialMatch.hint || null,
        semantic: { status: "live", model: result.model, reason: result.data.reason },
      };
    }

    const chosen = blsRows.find((row) => row.occupation_code === candidates[result.data.index].code) || initialMatch.row;
    return {
      row: chosen,
      confidence: clamp(result.data.confidence || initialMatch.confidence),
      method: `small model: ${result.data.reason || "semantic occupation match"}`,
      alternatives: candidates.filter((candidate) => candidate.code !== chosen.occupation_code).slice(0, 3).map((candidate) => candidate.title),
      hint: initialMatch.hint || null,
      semantic: { status: "live", model: result.model, reason: result.data.reason },
    };
  }

  const fallbackTokens = tokensFor(query);
  const fallbackScore = scoreOccupationText(fallbackTokens, initialMatch.row);
  const minRequiredScore = fallbackTokens.length <= 1 ? 8 : 12;
  if (initialMatch.method.startsWith("alias") && initialMatch.confidence >= 72) {
    return {
      ...initialMatch,
      method: `${initialMatch.method}; semantic model unavailable`,
      semantic: { status: result.status, model: result.model, error: result.error },
    };
  }

  if (fallbackScore < minRequiredScore || initialMatch.confidence < 58) {
    return {
      row: UNCLASSIFIED_ROLE,
      confidence: Math.min(45, clamp(initialMatch.confidence)),
      method: `heuristic fallback rejected weak match; start local model for semantic matching`,
      alternatives: candidates.slice(0, 4).map((candidate) => candidate.title),
      hint: initialMatch.hint || null,
      semantic: { status: result.status, model: result.model, error: result.error },
    };
  }

  return { ...initialMatch, semantic: { status: result.status, model: result.model, error: result.error } };
}

function classifyCompanyBase(value) {
  const normalizedCompany = normalize(value);
  const profile =
    COMPANY_PROFILES.find((candidate) =>
      candidate.keywords.some((keyword) => normalizedCompany.includes(normalize(keyword))),
    ) || COMPANY_PROFILES.at(-1);
  const ticker = Object.entries(profile.tickers).find(([name]) => normalizedCompany.includes(name))?.[1] || null;
  const confidence = profile.id === "general" ? 42 : 76;
  return {
    ...profile,
    name: value.trim() || "Unspecified company",
    ticker,
    confidence,
    lookupStatus: profile.id === "general" ? "needed" : "local-match",
    lookupSource: "Local keyword classifier",
  };
}

function profileFromText(text) {
  const normalizedText = normalize(text);
  const scored = COMPANY_PROFILES.filter((profile) => profile.id !== "general")
    .map((profile) => {
      const hits = profile.keywords.filter((keyword) => normalizedText.includes(normalize(keyword))).length;
      return { profile, hits };
    })
    .sort((a, b) => b.hits - a.hits);

  return scored[0]?.hits > 0 ? scored[0] : null;
}

async function semanticallyChooseCompanyProfile(companyName, lookupText, fallbackProfile) {
  const profiles = COMPANY_PROFILES.filter((profile) => profile.id !== "general").map((profile) => ({
    id: profile.id,
    label: profile.label,
    summary: profile.summary,
  }));
  const prompt = `You are classifying an employer into one industry profile for job-security analysis.
Company: "${companyName}"
Public lookup text: "${lookupText.slice(0, 1800)}"
Profiles JSON: ${JSON.stringify(profiles)}
Return ONLY JSON: {"id": "profile id", "confidence": 0-100, "reason": "short reason"}`;
  const result = await callSmallModel(prompt);
  if (result.status !== "live" || !result.data.id) {
    return { profile: fallbackProfile, confidence: fallbackProfile?.confidence || 48, semantic: { status: result.status, model: result.model, error: result.error } };
  }
  const profile = COMPANY_PROFILES.find((item) => item.id === result.data.id) || fallbackProfile;
  return {
    profile,
    confidence: clamp(result.data.confidence || 60),
    semantic: { status: "live", model: result.model, reason: result.data.reason },
  };
}

async function lookupCompanyEntity(companyName) {
  const search = new URL("https://en.wikipedia.org/w/api.php");
  search.searchParams.set("action", "query");
  search.searchParams.set("list", "search");
  search.searchParams.set("srsearch", companyName);
  search.searchParams.set("format", "json");
  search.searchParams.set("origin", "*");

  const data = await fetchJson(search);
  const page = data.query?.search?.[0];
  if (!page) return null;

  let summary = "";
  try {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.title)}`;
    const summaryData = await fetchJson(summaryUrl);
    summary = summaryData.extract || "";
  } catch {
    summary = "";
  }

  return {
    title: page.title,
    snippet: decodeXml(page.snippet || "").replace(/<[^>]+>/g, ""),
    summary,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`,
    source: "Wikipedia lookup",
  };
}

async function classifyCompany(value) {
  const base = classifyCompanyBase(value);
  try {
    const lookup = await lookupCompanyEntity(base.name);
    if (!lookup) return base.id === "general" ? { ...base, lookupStatus: "not-found" } : base;
    const inferred = profileFromText(`${lookup.title} ${lookup.snippet} ${lookup.summary}`);
    const semanticChoice = await semanticallyChooseCompanyProfile(
      base.name,
      `${lookup.title} ${lookup.snippet} ${lookup.summary}`,
      inferred?.profile || base,
    );

    if (base.id !== "general") {
      const semanticProfile = semanticChoice.semantic.status === "live" ? semanticChoice.profile : base;
      const confidenceLift = semanticChoice.semantic.status === "live" && semanticProfile.id === base.id ? 10 : inferred?.profile.id === base.id ? 8 : 2;
      return {
        ...semanticProfile,
        name: base.name,
        ticker: base.ticker || semanticProfile.ticker,
        confidence: clamp(base.confidence + confidenceLift),
        lookupStatus: "local-enriched",
        lookupSource: lookup.source,
        lookup,
        semantic: semanticChoice.semantic,
        summary: `${base.summary} Public lookup context for ${lookup.title}: ${lookup.summary || lookup.snippet}`,
      };
    }

    if (!inferred && semanticChoice.semantic.status !== "live") {
      return {
        ...base,
        confidence: 48,
        lookupStatus: "unclassified",
        lookupSource: lookup.source,
        lookup,
        summary: `${base.summary} A public lookup found ${lookup.title}, but the current classifier could not confidently map it to an industry profile.`,
      };
    }

    const selectedProfile = semanticChoice.profile || inferred.profile;
    return {
      ...selectedProfile,
      name: base.name,
      ticker: base.ticker,
      confidence: semanticChoice.semantic.status === "live" ? semanticChoice.confidence : clamp(58 + inferred.hits * 8),
      lookupStatus: "live-enriched",
      lookupSource: lookup.source,
      lookup,
      semantic: semanticChoice.semantic,
      summary: `${selectedProfile.summary} Public lookup matched ${lookup.title}: ${lookup.summary || lookup.snippet}`,
    };
  } catch (error) {
    if (base.id !== "general") {
      return {
        ...base,
        lookupError: error.message,
      };
    }
    return {
      ...base,
      lookupStatus: "unavailable",
      lookupError: error.message,
    };
  }
}

function roleCompanyFit(row, company) {
  const title = normalize(row.occupation_title);
  const group = normalize(row.occupation_group);
  const text = `${title} ${group}`;

  if (company.id === "finance" && /computer|programmer|web|database|network|information security|systems/.test(text)) {
    return {
      riskAdjustment: 4,
      summary:
        "For a banking or credit-union institution, this role is tied to digital banking platforms, cybersecurity, fraud prevention, compliance systems, data infrastructure, and internal automation. Security can be stronger than generic software work when the role owns regulated systems, but routine internal tooling can still be pressured by efficiency programs.",
    };
  }

  if (company.id === "finance" && /teller|loan|credit|bookkeeping|customer service|data entry|office/.test(text)) {
    return {
      riskAdjustment: 10,
      summary:
        "For a banking institution, this role sits near branch, lending, servicing, or back-office workflows that are sensitive to digital self-service, document automation, fraud tooling, and call-center consolidation.",
    };
  }

  if (company.id === "large-tech" && /computer|programmer|web|database|network|information security|systems/.test(text)) {
    return {
      riskAdjustment: 8,
      summary:
        "At a large technology platform, this role is close to the core product and infrastructure engine. That can create opportunity, but it also exposes the role to aggressive productivity targets, platform consolidation, AI coding tools, and team reprioritization.",
    };
  }

  if (company.id === "healthcare" && /medical|nursing|healthcare|therapy|phlebotomist/.test(text)) {
    return {
      riskAdjustment: -8,
      summary:
        "At a healthcare provider, this role is closely connected to patient care or regulated clinical workflow. Automation may change documentation and routing, but direct care demand and licensure tend to reduce replacement risk.",
    };
  }

  if (company.id === "retail" && /customer service|cashier|office|data entry|shipping|inventory|sales/.test(text)) {
    return {
      riskAdjustment: 8,
      summary:
        "At a retail or consumer-services employer, this role is tied to high-volume operations where scheduling, inventory, self-service, support routing, and fulfillment automation can materially change staffing levels.",
    };
  }

  if (company.id === "government-defense") {
    return {
      riskAdjustment: -3,
      summary:
        "For government, military, or defense-linked institutions, the role is shaped by budget cycles, procurement, compliance, and sometimes clearance requirements. These constraints can slow replacement but may also redirect work toward modernization programs.",
    };
  }

  return {
    riskAdjustment: 0,
    summary:
      "The role-company relationship is inferred from broad industry and occupation categories. More precise risk needs live postings, team-level news, filings, and employer-specific workforce signals.",
  };
}

function roleRiskModifier(row, company) {
  const title = normalize(row.occupation_title);
  const group = normalize(row.occupation_group);
  const text = `${title} ${group}`;
  const isTechRole = /computer|programmer|web|database|network|information security|systems|software|data/.test(text);
  const isFrontlineOps = /warehouse|shipping|receiving|inventory|courier|messenger|production|transportation|material moving|order clerk|dispatch/.test(text);
  const isCustomerOps = /customer service|call center|support|receptionist|information clerk|teller|loan interviewer|new accounts/.test(text);
  const isBackOffice = /data entry|bookkeeping|accounting clerk|billing|payroll|administrative|secretaries|office clerks|file clerks/.test(text);
  const isLicensedOrCare = /nursing|medical|healthcare|therapy|phlebotomist|dental|veterinary/.test(text);
  const isManagement = /manager|chief executives|supervisors/.test(text);

  let modifier = {
    automation: 0,
    layoff: 0,
    monitoring: 0,
    hiringResilience: 0,
    rationale: "No strong role-specific modifier was detected beyond the occupation and company baseline.",
  };

  if (company.id === "finance" && isTechRole) {
    modifier = {
      automation: 6,
      layoff: -3,
      monitoring: 4,
      hiringResilience: 8,
      rationale:
        "Technology roles in banking are exposed to AI developer productivity, but core banking, fraud, cybersecurity, payments, compliance, and data platforms create stronger role-specific resilience than generic internal tooling.",
    };
  } else if (company.id === "finance" && (isCustomerOps || isBackOffice)) {
    modifier = {
      automation: 14,
      layoff: 8,
      monitoring: 8,
      hiringResilience: -8,
      rationale:
        "Customer operations and back-office finance roles are close to digital self-service, document automation, fraud tooling, call deflection, and branch/process consolidation.",
    };
  } else if (company.id === "manufacturing" && isTechRole) {
    modifier = {
      automation: 4,
      layoff: -2,
      monitoring: 2,
      hiringResilience: 10,
      rationale:
        "Software and systems roles inside manufacturing often support controls, robotics, quality, scheduling, supply chain, and plant modernization, which can be more resilient than routine production work.",
    };
  } else if (company.id === "manufacturing" && isFrontlineOps) {
    modifier = {
      automation: 16,
      layoff: 6,
      monitoring: 6,
      hiringResilience: -6,
      rationale:
        "Frontline production, warehouse, and logistics roles in manufacturing are more directly exposed to robotics, labor planning, scanning, routing, and automated material handling.",
    };
  } else if (company.id === "retail" && isTechRole) {
    modifier = {
      automation: 5,
      layoff: 0,
      monitoring: 2,
      hiringResilience: 7,
      rationale:
        "Technology roles in retail support ecommerce, fulfillment, pricing, inventory, loyalty, and analytics systems, creating different risk than store or support roles.",
    };
  } else if (company.id === "retail" && (isCustomerOps || isFrontlineOps)) {
    modifier = {
      automation: 13,
      layoff: 6,
      monitoring: 10,
      hiringResilience: -5,
      rationale:
        "Retail customer, store, and fulfillment roles are close to self-service, workforce scheduling, inventory automation, loss-prevention tooling, and fulfillment optimization.",
    };
  } else if (company.id === "large-tech" && isTechRole) {
    modifier = {
      automation: 12,
      layoff: 7,
      monitoring: 5,
      hiringResilience: 3,
      rationale:
        "Technical roles at large technology companies can be strategically important, but they are also closest to AI coding tools, internal platform consolidation, stack ranking, and productivity mandates.",
    };
  } else if (company.id === "healthcare" && isLicensedOrCare) {
    modifier = {
      automation: -8,
      layoff: -8,
      monitoring: 0,
      hiringResilience: 14,
      rationale:
        "Licensed or patient-facing healthcare work has stronger direct-demand and regulatory buffers. AI may reshape documentation and triage more than replace the core role.",
    };
  } else if (company.id === "customer-operations" && isCustomerOps) {
    modifier = {
      automation: 18,
      layoff: 10,
      monitoring: 12,
      hiringResilience: -10,
      rationale:
        "Customer operations roles at support vendors are highly exposed to chat, voice, routing, QA automation, workforce analytics, and vendor consolidation.",
    };
  }

  if (company.maturityRisk >= 70 && !isManagement) {
    modifier.layoff += 6;
    modifier.rationale += " Company maturity/capital-structure risk adds layoff pressure for non-executive roles.";
  }

  return {
    ...modifier,
    automation: clamp(50 + modifier.automation) - 50,
    layoff: clamp(50 + modifier.layoff) - 50,
    monitoring: clamp(50 + modifier.monitoring) - 50,
    hiringResilience: clamp(50 + modifier.hiringResilience) - 50,
  };
}

function estimateFutureSecurity(row, company, scores, fit) {
  const digitalExposure = anthropicCoverageFor(row);
  const employmentGrowth = toNumber(row.emp_change_pct);
  const regulationBuffer = /healthcare|legal|government|defense|financial/.test(normalize(`${row.occupation_group} ${company.label}`)) ? 6 : 0;
  const physicalBuffer = /healthcare support|construction|production|installation|maintenance|repair|farming|transportation|personal care/.test(
    normalize(row.occupation_group),
  )
    ? 9
    : 0;
  const futureRisk = clamp(
    scores.aiExposure * 0.36 +
      digitalExposure * 0.22 +
      scores.laborRisk * 0.18 +
      scores.companyPressure * 0.16 -
      employmentGrowth * 0.8 +
      fit.riskAdjustment -
      regulationBuffer -
      physicalBuffer,
  );
  const security = clamp(100 - futureRisk);
  return {
    risk: futureRisk,
    security,
    rationale:
      "Inspired by Karpathy's BLS-first visual methodology: combine employment scale/growth, digital AI exposure, role-company fit, and buffers such as regulation, physical presence, or institutional friction. This is theoretical and directional, not a prediction of job disappearance.",
  };
}

function buildRelatedFields(row, blsRows, company, scores) {
  const group = normalize(row.occupation_group);
  const currentCode = row.occupation_code;
  const rows = blsRows
    .filter((candidate) => candidate.occupation_code !== currentCode)
    .map((candidate) => {
      const sameGroup = normalize(candidate.occupation_group) === group;
      const titleOverlap = tokensFor(row.occupation_title).filter((token) => normalize(candidate.occupation_title).includes(token)).length;
      const growth = toNumber(candidate.emp_change_pct);
      const aiExposure = clamp(toNumber(candidate.automation_risk_score) * 6 + anthropicCoverageFor(candidate) * 0.4);
      const security = clamp(100 - (aiExposure * 0.42 + clamp(50 - growth * 3) * 0.36 + scores.companyPressure * 0.12));
      return {
        title: candidate.occupation_title,
        group: candidate.occupation_group.trim(),
        code: candidate.occupation_code,
        employment2024: toNumber(candidate.employment_2024),
        growth,
        aiExposure,
        security,
        relevance: (sameGroup ? 40 : 0) + titleOverlap * 12 + Math.min(20, toNumber(candidate.employment_2024) / 100),
      };
    })
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 8);

  return rows;
}

function employmentTrendWithConfidence(row, company, roleModifier) {
  const start = toNumber(row.employment_2024);
  const end = toNumber(row.employment_2034);
  const midpoint = start + (end - start) / 2;
  const volatility = Math.max(
    2,
    Math.abs(toNumber(row.emp_change_pct)) * 0.65 +
      Math.abs(roleModifier.automation) * 0.22 +
      Math.abs(roleModifier.layoff) * 0.18 +
      (company.maturityRisk || 45) * 0.035,
  );
  const points = [
    ["2024", start, volatility * 0.35],
    ["2029", midpoint, volatility * 0.65],
    ["2034", end, volatility],
  ];

  return points.map(([label, value, spreadPct]) => {
    const spread = Math.max(0.8, value * (spreadPct / 100));
    return {
      label,
      value,
      low: Math.max(0, value - spread),
      high: value + spread,
    };
  });
}

function anthropicCoverageFor(row) {
  if (!row || row.occupation_title === "Unclassified role") return 55;
  const normalizedGroup = normalize(row.occupation_group);
  const match = Object.entries(ANTHROPIC_AI_COVERAGE).find(([group]) => normalize(group) === normalizedGroup);
  return match?.[1] || 55;
}

async function fetchJson(url, options = {}) {
  const cacheKey = `${url}:${JSON.stringify(options.headers || {})}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "JobSecurityCalculator/0.1 contact@example.com",
        accept: "application/json,text/plain,*/*",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    cache.set(cacheKey, { time: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}) {
  const cacheKey = `${url}:text:${JSON.stringify(options.headers || {})}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "JobSecurityCalculator/0.1 contact@example.com",
        accept: "application/rss+xml,text/xml,text/plain,*/*",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.text();
    cache.set(cacheKey, { time: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function callSmallModel(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(LLM_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        stream: false,
        options: { temperature: 0.1, num_predict: 320 },
        prompt,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const parsed = extractJsonObject(payload.response);
    if (!parsed) throw new Error("Model did not return JSON");
    return { status: "live", model: LLM_MODEL, data: parsed };
  } catch (error) {
    return { status: "fallback", model: LLM_MODEL, error: error.message, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((match) => {
    const item = match[1];
    const read = (tag) => decodeXml(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "");
    return {
      title: read("title"),
      url: read("link"),
      source: read("source") || "Google News RSS",
      date: read("pubDate") || null,
      snippet: read("title"),
    };
  });
}

function scoreSourceRelation(item, role, company) {
  const text = normalize(`${item.title || ""} ${item.snippet || ""} ${item.source || ""}`);
  const companyTokens = tokensFor(company.name).filter((token) => token.length > 2);
  const roleTokens = tokensFor(role.row.occupation_title).filter((token) => !["and", "except"].includes(token));
  const companyHits = companyTokens.filter((token) => text.includes(token)).length;
  const roleHits = roleTokens.filter((token) => text.includes(token)).length;
  const companySpecific = companyHits > 0;
  const roleSpecific = roleHits > 0;
  const sectorSpecific = normalize(company.label)
    .split(" ")
    .some((token) => token.length > 4 && text.includes(token));

  let weight = 0.6;
  if (sectorSpecific) weight = 0.8;
  if (roleSpecific) weight = 1;
  if (companySpecific) weight = 1.4;
  if (companySpecific && roleSpecific) weight = 1.8;

  return {
    relationWeight: weight,
    relation: companySpecific ? (roleSpecific ? "company-role" : "company") : roleSpecific ? "role" : sectorSpecific ? "sector" : "background",
  };
}

async function collectNews(role, company) {
  const companyQuery = `"${company.name}" (${role.row.occupation_title} OR jobs OR layoffs OR hiring OR AI OR automation)`;
  const sectorQuery = `"${company.label}" "${role.row.occupation_title}" layoffs hiring automation`;
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", companyQuery);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "8");
  url.searchParams.set("sort", "HybridRel");

  try {
    const data = await fetchJson(url);
    const articles = (data.articles || []).slice(0, 8).map((article) => {
      const item = {
        title: article.title,
        url: article.url,
        source: article.domain || article.sourceCommonName || "GDELT",
        date: article.seendate || article.datetime || null,
        snippet: article.title,
      };
      return { ...item, ...scoreSourceRelation(item, role, company) };
    });
    return { status: "live", articles, error: null, query: companyQuery };
  } catch (error) {
    try {
      const queries = [
        `${company.name} ${role.row.occupation_title} layoffs hiring AI automation`,
        sectorQuery,
      ];
      const rssArticles = [];
      for (const query of queries) {
        const rss = new URL("https://news.google.com/rss/search");
        rss.searchParams.set("q", query);
        rss.searchParams.set("hl", "en-US");
        rss.searchParams.set("gl", "US");
        rss.searchParams.set("ceid", "US:en");
        rssArticles.push(...parseRssItems(await fetchText(rss)));
      }
      const articles = rssArticles
        .map((item) => ({ ...item, ...scoreSourceRelation(item, role, company) }))
        .filter((item, index, list) => list.findIndex((candidate) => candidate.url === item.url) === index)
        .sort((a, b) => b.relationWeight - a.relationWeight)
        .slice(0, 8);
      return { status: articles.length ? "live" : "thin", articles, error: `GDELT fallback: ${error.message}`, query: companyQuery };
    } catch (fallbackError) {
      return { status: "unavailable", articles: [], error: `${error.message}; fallback ${fallbackError.message}` };
    }
  }
}

async function collectPostings(role, company) {
  const roleUrl = new URL("https://remotive.com/api/remote-jobs");
  roleUrl.searchParams.set("search", role.row.occupation_title);
  const companyUrl = new URL("https://remotive.com/api/remote-jobs");
  companyUrl.searchParams.set("company_name", company.name);

  try {
    const [roleData, companyData] = await Promise.allSettled([fetchJson(roleUrl), fetchJson(companyUrl)]);
    const roleJobs = roleData.status === "fulfilled" ? roleData.value.jobs || [] : [];
    const companyJobs = companyData.status === "fulfilled" ? companyData.value.jobs || [] : [];
    const jobs = [...companyJobs, ...roleJobs]
      .filter((job, index, list) => list.findIndex((candidate) => candidate.id === job.id) === index)
      .slice(0, 8)
      .map((job) => ({
        title: job.title,
        company: job.company_name,
        category: job.category,
        url: job.url,
        date: job.publication_date,
        source: "Remotive",
      }));
    return { status: "live", jobs, roleCount: roleJobs.length, companyCount: companyJobs.length, error: null };
  } catch (error) {
    return { status: "unavailable", jobs: [], roleCount: 0, companyCount: 0, error: error.message };
  }
}

function linkedInSearchUrl(query) {
  const url = new URL("https://www.linkedin.com/search/results/content/");
  url.searchParams.set("keywords", query);
  return url.toString();
}

async function collectLinkedInSignals(role, company) {
  const queries = [
    {
      kind: "company-role",
      query: `${company.name} ${role.row.occupation_title} hiring jobs layoffs automation`,
      url: linkedInSearchUrl(`${company.name} ${role.row.occupation_title} hiring jobs layoffs automation`),
    },
    {
      kind: "company-news",
      query: `${company.name} company news hiring layoffs automation`,
      url: linkedInSearchUrl(`${company.name} company news hiring layoffs automation`),
    },
    {
      kind: "role-news",
      query: `${role.row.occupation_title} hiring trends AI automation`,
      url: linkedInSearchUrl(`${role.row.occupation_title} hiring trends AI automation`),
    },
  ];

  const discovered = [];
  try {
    for (const item of queries) {
      const rss = new URL("https://news.google.com/rss/search");
      rss.searchParams.set("q", `site:linkedin.com ${item.query}`);
      rss.searchParams.set("hl", "en-US");
      rss.searchParams.set("gl", "US");
      rss.searchParams.set("ceid", "US:en");
      const items = parseRssItems(await fetchText(rss)).map((article) => ({
        ...article,
        source: article.source || "LinkedIn via public search",
        type: item.kind,
        linkedinSearchUrl: item.url,
        ...scoreSourceRelation(article, role, company),
      }));
      discovered.push(...items);
    }
  } catch (error) {
    return {
      status: "limited",
      items: queries.map((item) => ({
        title: `LinkedIn ${item.kind.replace("-", " ")} search`,
        url: item.url,
        source: "LinkedIn public search link",
        date: null,
        snippet: item.query,
        type: item.kind,
        relation: item.kind === "company-role" ? "company-role" : item.kind === "company-news" ? "company" : "role",
        relationWeight: item.kind === "company-role" ? 1.8 : item.kind === "company-news" ? 1.4 : 1,
      })),
      error: error.message,
    };
  }

  const deduped = discovered
    .filter((item, index, list) => item.url && list.findIndex((candidate) => candidate.url === item.url) === index)
    .sort((a, b) => (b.relationWeight || 1) - (a.relationWeight || 1))
    .slice(0, 8);

  return {
    status: deduped.length ? "live" : "limited",
    items: deduped.length
      ? deduped
      : queries.map((item) => ({
          title: `LinkedIn ${item.kind.replace("-", " ")} search`,
          url: item.url,
          source: "LinkedIn public search link",
          date: null,
          snippet: item.query,
          type: item.kind,
          relation: item.kind === "company-role" ? "company-role" : item.kind === "company-news" ? "company" : "role",
          relationWeight: item.kind === "company-role" ? 1.8 : item.kind === "company-news" ? 1.4 : 1,
        })),
    error: deduped.length ? null : "No public LinkedIn RSS items found; using direct public search links",
  };
}

async function lookupSecCompany(company) {
  const map = await fetchJson("https://www.sec.gov/files/company_tickers.json");
  const entries = Object.values(map);
  const normalizedCompany = normalize(company.name);
  return entries.find((entry) => {
    const tickerMatches = company.ticker && normalize(entry.ticker) === normalize(company.ticker);
    const titleMatches = normalizedCompany && normalize(entry.title).includes(normalizedCompany.split(" ")[0]);
    return tickerMatches || titleMatches;
  });
}

async function collectFilings(company) {
  try {
    const match = await lookupSecCompany(company);
    if (!match) return { status: "not-found", filings: [], error: null };

    const cik = String(match.cik_str).padStart(10, "0");
    const data = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const recent = data.filings?.recent || {};
    const filings = (recent.form || [])
      .map((form, index) => ({
        form,
        accessionNumber: recent.accessionNumber?.[index],
        filingDate: recent.filingDate?.[index],
        reportDate: recent.reportDate?.[index],
        primaryDocument: recent.primaryDocument?.[index],
        description: recent.primaryDocDescription?.[index],
        cik: String(match.cik_str),
        companyName: data.name || match.title,
      }))
      .filter((filing) => ["10-K", "10-Q", "8-K", "20-F", "6-K"].includes(filing.form))
      .slice(0, 8)
      .map((filing) => {
        const accessionPath = filing.accessionNumber.replace(/-/g, "");
        return {
          ...filing,
          url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${accessionPath}/${filing.primaryDocument}`,
          source: "SEC EDGAR",
        };
      });

    return { status: "live", filings, secName: data.name || match.title, ticker: match.ticker, error: null };
  } catch (error) {
    return { status: "unavailable", filings: [], error: error.message };
  }
}

function sentimentForTexts(items) {
  const weighted = items.map((item) => {
    const text = `${item.title || ""} ${item.snippet || ""}`.toLowerCase();
    const weight = item.relationWeight || 1;
    const riskHits = RISK_TERMS.reduce((sum, term) => sum + (text.match(new RegExp(`\\b${term}\\b`, "g")) || []).length, 0);
    const positiveHits = POSITIVE_TERMS.reduce((sum, term) => sum + (text.match(new RegExp(`\\b${term}\\b`, "g")) || []).length, 0);
    return { riskHits, positiveHits, weight };
  });
  const riskHits = weighted.reduce((sum, item) => sum + item.riskHits * item.weight, 0);
  const positiveHits = weighted.reduce((sum, item) => sum + item.positiveHits * item.weight, 0);
  const companySpecificWeight = items.reduce((sum, item) => sum + (item.relation === "company" || item.relation === "company-role" ? item.relationWeight || 1 : 0), 0);
  const riskScore = clamp(45 + riskHits * 9 - positiveHits * 5 + Math.min(8, companySpecificWeight));
  return {
    status: items.length ? "derived" : "thin",
    riskScore,
    riskHits: Math.round(riskHits * 10) / 10,
    positiveHits: Math.round(positiveHits * 10) / 10,
    summary:
      items.length === 0
        ? "Not enough live text was retrieved to derive public sentiment."
        : `Derived from ${items.length} public titles/snippets with company-specific items weighted highest: ${Math.round(riskHits * 10) / 10} weighted risk terms and ${Math.round(positiveHits * 10) / 10} weighted positive hiring or growth terms.`,
  };
}

function heuristicQuality(item, role, company) {
  const relation = scoreSourceRelation(item, role, company);
  const hasUrl = Boolean(item.url);
  const hasDate = Boolean(item.date || item.filingDate);
  const titleLength = String(item.title || "").length;
  const score = clamp(35 + relation.relationWeight * 22 + (hasUrl ? 10 : 0) + (hasDate ? 8 : 0) + (titleLength > 30 ? 8 : 0));
  return { score, reason: `${relation.relation} relevance with ${hasUrl ? "link" : "no link"} and ${hasDate ? "date" : "no date"}` };
}

async function assessSourceQuality(items, role, company) {
  const candidates = items.slice(0, 10).map((item, index) => ({
    index,
    title: item.title,
    source: item.source,
    type: item.type || item.form || "source",
    relation: item.relation,
    hasUrl: Boolean(item.url),
    date: item.date || item.filingDate || null,
  }));

  const prompt = `You are scoring source quality for a job-security analysis. Score whether each item is relevant, recent/specific, and useful for the company-role question.
Company: "${company.name}" (${company.label})
Role: "${role.row.occupation_title}"
Items JSON: ${JSON.stringify(candidates)}
Return ONLY JSON: {"scores":[{"index": number, "score": 0-100, "reason": "short reason"}]}`;
  const result = await callSmallModel(prompt);
  const byIndex = new Map();

  if (result.status === "live" && Array.isArray(result.data.scores)) {
    result.data.scores.forEach((item) => {
      if (Number.isInteger(item.index)) {
        byIndex.set(item.index, {
          score: clamp(item.score || 50),
          reason: item.reason || "Small model quality score",
          semantic: { status: "live", model: result.model },
        });
      }
    });
  }

  return items.map((item, index) => ({
    ...item,
    quality: byIndex.get(index) || { ...heuristicQuality(item, role, company), semantic: { status: result.status, model: result.model, error: result.error } },
  }));
}

function calculateRisk(row, company, live, fit, roleModifier) {
  const growth = toNumber(row.emp_change_pct);
  const automation = toNumber(row.automation_risk_score) * 10;
  const anthropic = anthropicCoverageFor(row);
  const aiExposure = clamp(automation * 0.55 + anthropic * 0.45);
  const laborRisk = clamp(50 - growth * 3 + (row.growth_category === "Declining" ? 18 : 0));
  const livePostingRisk = live.postings.jobs.length
    ? clamp(58 - Math.min(25, live.postings.companyCount * 4) - Math.min(18, live.postings.roleCount))
    : clamp((company.sentimentRisk + (100 - company.hiringSignal)) / 2);
  const filingsRisk = live.filings.filings.some((filing) => filing.form === "8-K") ? 58 : 44;
  const sentimentRisk = live.sentiment.riskScore;
  const linkedInRisk = live.linkedIn.items.length
    ? clamp(sentimentForTexts(live.linkedIn.items).riskScore)
    : 48;
  const adjustedLayoff = clamp(company.layoffMomentum + roleModifier.layoff + (company.maturityRisk || 0) * 0.08);
  const adjustedAutomation = clamp(company.automationPosture + roleModifier.automation);
  const adjustedMonitoring = clamp(company.monitoringRisk + roleModifier.monitoring);
  const adjustedHiring = clamp(company.hiringSignal + roleModifier.hiringResilience);
  const maturityRisk = company.maturityRisk || 45;
  const companyPressure = clamp(
    adjustedLayoff * 0.2 +
      adjustedAutomation * 0.19 +
      adjustedMonitoring * 0.1 +
      (100 - adjustedHiring) * 0.1 +
      maturityRisk * 0.07 +
      livePostingRisk * 0.14 +
      filingsRisk * 0.08 +
      sentimentRisk * 0.08 +
      linkedInRisk * 0.04 +
      fit.riskAdjustment,
  );

  return {
    score: clamp(aiExposure * 0.3 + laborRisk * 0.26 + companyPressure * 0.25 + livePostingRisk * 0.07 + sentimentRisk * 0.07 + linkedInRisk * 0.05),
    aiExposure,
    laborRisk,
    companyPressure,
    postingNewsRisk: livePostingRisk,
    filingsRisk,
    sentimentRisk,
    linkedInRisk,
    roleModifier,
    adjustedCompanySignals: {
      layoffMomentum: adjustedLayoff,
      automationPosture: adjustedAutomation,
      monitoringRisk: adjustedMonitoring,
      hiringSignal: adjustedHiring,
      maturityRisk,
    },
  };
}

function impactFor(score) {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function dedupeEvidence(items) {
  const seen = [];
  const stopWords = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "are", "was", "were", "has", "have", "job", "jobs"]);
  const canonicalTitle = (title) =>
    normalize(title)
      .replace(/\b(msn|yahoo|aol|newsweek|google news rss|linkedin|gdelt|sec|edgar|reuters|ap news|associated press)\b/g, "")
      .replace(/\b\d{1,2}\s*7\s*wall\s*st\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const titleTokens = (title) => canonicalTitle(title).split(" ").filter((token) => token.length > 2 && !stopWords.has(token));
  const similarity = (a, b) => {
    const left = new Set(titleTokens(a));
    const right = new Set(titleTokens(b));
    if (!left.size || !right.size) return 0;
    const intersection = [...left].filter((token) => right.has(token)).length;
    return intersection / Math.min(left.size, right.size);
  };

  return items.filter((item) => {
    const key = canonicalTitle(item.title) || normalize(`${item.type} ${item.source}`);
    const duplicate = seen.some((prior) => prior.key === key || similarity(prior.title, item.title) >= 0.78);
    if (duplicate) return false;
    seen.push({ key, title: item.title });
    return true;
  });
}

function buildEvidence(roleMatch, company, scores, live, fit, roleModifier) {
  const row = roleMatch.row;
  const evidence = [
    {
      title: `${row.occupation_title}: projected employment ${row.emp_change_pct}%`,
      body: `The matched occupation is ${row.occupation_title} (${row.occupation_code}). Employment moves from ${row.employment_2024}k in 2024 to ${row.employment_2034}k in 2034, a ${row.growth_category.toLowerCase()} labor-demand signal.`,
      impact: impactFor(scores.laborRisk),
      source: row.data_source || "BLS occupation data",
      type: "Labor statistics",
    },
    {
      title: `${row.ai_risk_category} AI category with score ${row.automation_risk_score}/10`,
      body: "The role AI signal combines the CSV automation risk field with the occupation group shown in the local Anthropic coverage graph.",
      impact: impactFor(scores.aiExposure),
      source: `${row.data_source || "BLS occupation data"} + local Anthropic AI coverage graph`,
      type: "AI exposure",
    },
  ];

  live.news.articles
    .slice()
    .sort((a, b) => (b.relationWeight || 1) - (a.relationWeight || 1))
    .slice(0, 4)
    .forEach((article) => {
    evidence.push({
      title: article.title,
      body: `Recent public news item included as ${article.relation || "background"} context. Company-specific items receive higher weight than peer or sector background. Source quality: ${article.quality?.score || "n/a"}/100 (${article.quality?.reason || "not scored"}).`,
      impact: impactFor(sentimentForTexts([article]).riskScore),
      source: article.source,
      url: article.url,
      date: article.date,
      type: `Live news (${article.relation || "background"})`,
    });
  });

  live.postings.jobs.slice(0, 3).forEach((job) => {
    evidence.push({
      title: `${job.title} at ${job.company}`,
      body: `Active remote posting in ${job.category || "uncategorized"}; postings support demand, but this source is remote-only and not a complete labor market sample. Source quality: ${job.quality?.score || "n/a"}/100 (${job.quality?.reason || "not scored"}).`,
      impact: "low",
      source: "Remotive",
      url: job.url,
      date: job.date,
      type: "Live job posting",
    });
  });

  live.filings.filings.slice(0, 3).forEach((filing) => {
    evidence.push({
      title: `${filing.form} filed ${filing.filingDate}`,
      body: `${filing.description || `Recent ${filing.form} filing for ${filing.companyName}.`} Source quality: ${filing.quality?.score || "n/a"}/100 (${filing.quality?.reason || "not scored"}).`,
      impact: filing.form === "8-K" ? "medium" : "low",
      source: "SEC EDGAR",
      url: filing.url,
      date: filing.filingDate,
      type: "Public filing",
    });
  });

  live.linkedIn.items.slice(0, 4).forEach((item) => {
    evidence.push({
      title: item.title,
      body: `LinkedIn public discovery item for ${item.type || "source"} context. Company-role LinkedIn hits are weighted higher than company-only or role-only hits. Source quality: ${item.quality?.score || "n/a"}/100 (${item.quality?.reason || "not scored"}).`,
      impact: impactFor(sentimentForTexts([item]).riskScore),
      source: item.source,
      url: item.url,
      date: item.date,
      type: `LinkedIn (${item.relation || item.type || "public"})`,
    });
  });

  evidence.push({
    title: `Role-company relationship: ${roleMatch.row.occupation_title} at ${company.label}`,
    body: `${fit.summary} Role-specific modifiers: automation ${roleModifier.automation >= 0 ? "+" : ""}${roleModifier.automation}, layoff ${roleModifier.layoff >= 0 ? "+" : ""}${roleModifier.layoff}, monitoring ${roleModifier.monitoring >= 0 ? "+" : ""}${roleModifier.monitoring}, hiring resilience ${roleModifier.hiringResilience >= 0 ? "+" : ""}${roleModifier.hiringResilience}. ${roleModifier.rationale}`,
    impact: impactFor(50 + fit.riskAdjustment * 3),
    source: company.lookup?.url || company.lookupSource || "Role-company fit rules",
    url: company.lookup?.url,
    type: "Role-company fit",
  });

  evidence.push({
    title: `${company.name} mapped to ${company.label}`,
    body: company.summary,
    impact: impactFor(scores.companyPressure),
    source: company.lookupSource || "Local company classifier plus live source adjustments",
    url: company.lookup?.url,
    type: "Company classification",
  });

  evidence.push({
    title: "Public sentiment derived from retrieved source text",
    body: live.sentiment.summary,
    impact: impactFor(scores.sentimentRisk),
    source: "Lexical sentiment layer over GDELT, Remotive, and SEC titles",
    type: "Derived sentiment",
  });

  if (!live.news.articles.length || !live.postings.jobs.length || !live.filings.filings.length || !live.linkedIn.items.length) {
    evidence.push({
      title: "Source coverage is incomplete",
      body: "At least one live source returned no items or was unavailable. The app keeps the analysis running and marks source status instead of hiding the uncertainty.",
      impact: "medium",
      source: "Runtime source health check",
      type: "Data quality",
    });
  }

  return dedupeEvidence(evidence);
}

async function analyze(roleInput, companyInput) {
  const blsRows = await loadBlsRows();
  const initialRoleMatch = findPreferredRole(roleInput, blsRows);
  const roleMatch = await semanticallyRefineRole(roleInput, initialRoleMatch, blsRows);
  const company = await classifyCompany(companyInput);
  const fit = roleCompanyFit(roleMatch.row, company);
  const roleModifier = roleRiskModifier(roleMatch.row, company);
  const [news, postings, filings] = await Promise.all([
    collectNews(roleMatch, company),
    collectPostings(roleMatch, company),
    collectFilings(company),
  ]);
  const linkedIn = await collectLinkedInSignals(roleMatch, company);
  const qualityItems = await assessSourceQuality(
    [
      ...news.articles,
      ...postings.jobs.map((job) => ({ ...job, title: `${job.title} at ${job.company}`, type: "job posting" })),
      ...filings.filings.map((filing) => ({ ...filing, title: `${filing.form} ${filing.description || ""}`, type: "filing", date: filing.filingDate })),
      ...linkedIn.items.map((item) => ({ ...item, title: item.title, type: `linkedin ${item.type || "source"}` })),
    ],
    roleMatch,
    company,
  );
  const newsQuality = qualityItems.slice(0, news.articles.length);
  const postingQuality = qualityItems.slice(news.articles.length, news.articles.length + postings.jobs.length);
  const filingQuality = qualityItems.slice(news.articles.length + postings.jobs.length, news.articles.length + postings.jobs.length + filings.filings.length);
  const linkedInQuality = qualityItems.slice(news.articles.length + postings.jobs.length + filings.filings.length);
  news.articles = news.articles.map((item, index) => ({ ...item, quality: newsQuality[index]?.quality }));
  postings.jobs = postings.jobs.map((item, index) => ({ ...item, quality: postingQuality[index]?.quality }));
  filings.filings = filings.filings.map((item, index) => ({ ...item, quality: filingQuality[index]?.quality }));
  linkedIn.items = linkedIn.items.map((item, index) => ({ ...item, quality: linkedInQuality[index]?.quality }));
  const sentiment = sentimentForTexts([
    ...news.articles,
    ...postings.jobs.map((job) => ({ title: `${job.title} ${job.company} ${job.category}` })),
    ...filings.filings.map((filing) => ({ title: `${filing.form} ${filing.description || ""}` })),
    ...linkedIn.items,
  ]);
  const live = { news, postings, filings, linkedIn, sentiment };
  const scores = calculateRisk(roleMatch.row, company, live, fit, roleModifier);
  const future = estimateFutureSecurity(roleMatch.row, company, scores, fit);
  const relatedFields = buildRelatedFields(roleMatch.row, blsRows, company, scores);
  const evidence = buildEvidence(roleMatch, company, scores, live, fit, roleModifier);

  return {
    mode: "live",
    analyzedAt: new Date().toISOString(),
    roleMatch: {
      title: roleMatch.row.occupation_title,
      code: roleMatch.row.occupation_code,
      group: roleMatch.row.occupation_group.trim(),
      confidence: roleMatch.confidence,
      method: roleMatch.method,
      alternatives: roleMatch.alternatives || [],
      row: roleMatch.row,
    },
    roleHint: roleMatch.hint,
    company: {
      name: company.name,
      label: company.label,
      confidence: company.confidence,
      summary: company.summary,
      ticker: company.ticker,
      lookupStatus: company.lookupStatus,
      lookupSource: company.lookupSource,
      lookup: company.lookup,
      roleFit: fit.summary,
      maturityRisk: company.maturityRisk || 45,
    },
    scores,
    roleModifier,
    future,
    relatedFields,
    sourceStatus: [
      { id: "csv", label: "BLS occupation table", status: "live", detail: `${blsRows.length} canonical rows loaded` },
      { id: "anthropic", label: "Anthropic AI coverage graph", status: "local", detail: "Local source" },
      {
        id: "company",
        label: "Company lookup",
        status: ["live-enriched", "local-enriched", "local-match"].includes(company.lookupStatus) ? "live" : company.lookupStatus === "not-found" ? "not-found" : "thin",
        detail: company.lookupStatus === "local-match" ? "Local classifier" : company.lookup?.title || company.lookupStatus,
      },
      {
        id: "semantic",
        label: "Small semantic model",
        status: roleMatch.semantic?.status === "live" || company.semantic?.status === "live" || qualityItems.some((item) => item.quality?.semantic?.status === "live") ? "live" : "thin",
        detail: roleMatch.semantic?.status === "live" || company.semantic?.status === "live" ? LLM_MODEL : "Heuristic fallback",
      },
      {
        id: "news",
        label: "News discovery",
        status: news.status,
        detail: news.status === "unavailable" ? `Unavailable: ${news.error}` : `${news.articles.length} items`,
      },
      {
        id: "postings",
        label: "Remotive postings",
        status: postings.status,
        detail: postings.status === "unavailable" ? `Unavailable: ${postings.error}` : `${postings.jobs.length} jobs`,
      },
      {
        id: "linkedin",
        label: "LinkedIn public discovery",
        status: linkedIn.status,
        detail: linkedIn.status === "limited" ? `Limited: ${linkedIn.items.length} public links` : `${linkedIn.items.length} items`,
      },
      {
        id: "filings",
        label: "SEC EDGAR filings",
        status: filings.status,
        detail: filings.status === "unavailable" ? `Unavailable: ${filings.error}` : `${filings.filings.length} filings`,
      },
      { id: "sentiment", label: "Public sentiment", status: sentiment.status, detail: `Risk ${sentiment.riskScore}` },
    ],
    trend: {
      employment: employmentTrendWithConfidence(roleMatch.row, company, roleModifier),
      risk: [
        ["AI", scores.aiExposure],
        ["Labor", scores.laborRisk],
      ["Company", scores.companyPressure],
        ["Postings", scores.postingNewsRisk],
        ["LinkedIn", scores.linkedInRisk],
        ["Filings", scores.filingsRisk],
      ["Sentiment", scores.sentimentRisk],
      ["Fit", clamp(50 + fit.riskAdjustment * 3)],
      ],
      wage: [
        ["Median", clamp(toNumber(roleMatch.row.median_wage_2024) / 2000)],
        ["Education", roleMatch.row.education_required.includes("Bachelor") ? 72 : 48],
        ["Growth", clamp(50 + toNumber(roleMatch.row.emp_change_pct) * 3)],
      ],
    },
    companyBars: [
      ["Layoff momentum", scores.adjustedCompanySignals.layoffMomentum],
      ["Automation posture", scores.adjustedCompanySignals.automationPosture],
      ["Hiring signal", scores.adjustedCompanySignals.hiringSignal],
      ["Maturity risk", scores.adjustedCompanySignals.maturityRisk],
      ["News sentiment", scores.sentimentRisk],
      ["LinkedIn", scores.linkedInRisk],
      ["Filing activity", scores.filingsRisk],
      ["Role fit", clamp(50 + fit.riskAdjustment * 3)],
    ],
    evidence,
    agentSteps: [
      ["Classify user input", `Mapped free-text role to ${roleMatch.row.occupation_title} and company to ${company.label}.`],
      ["Enrich company profile", `If the company was not locally recognized, queried a public company lookup and inferred industry from the returned description.`],
      ["Load labor baseline", "Read employment, wage, growth, education, and AI-risk fields from the local BLS CSV."],
      ["Collect live sources", "Queried company-weighted news, LinkedIn public discovery, Remotive postings, and SEC EDGAR filing metadata through the local backend."],
      ["Derive public sentiment", "Scored retrieved titles and snippets for layoff, automation, hiring, growth, and risk language, weighting company-specific items highest."],
      ["Cite every claim", "Evidence items retain source name, date when available, and outbound URL when the upstream source provides one."],
    ],
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const decoded = decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(ROOT, decoded));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, cacheEntries: cache.size, now: new Date().toISOString() });
    return;
  }

  if (requestUrl.pathname === "/api/analyze") {
    try {
      const role = requestUrl.searchParams.get("role") || "";
      const company = requestUrl.searchParams.get("company") || "";
      const payload = await analyze(role, company);
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  await serveStatic(request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Job Security Calculator running at http://${HOST}:${PORT}`);
});
