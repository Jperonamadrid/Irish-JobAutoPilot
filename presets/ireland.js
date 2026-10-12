// Job sources for people searching in Ireland. Company boards were verified by calling each
// board API on 2026-09-28 (SmartRecruiters and Personio boards on 2026-10-12). Boards found
// automatically at runtime are cached in data/boards.json.
module.exports = {
  "id": "ireland",
  "label": "Ireland (Dublin and remote EMEA)",
  "country": "Ireland",
  "countryCode": "IE",
  "defaultCity": "Dublin",
  "linkedinLocation": "Dublin, County Dublin, Ireland",
  "joobleLocation": "Dublin, Ireland",
  "workableLocations": [
    "Ireland"
  ],
  "stepstoneSites": [
    "www.irishjobs.ie",
    "www.jobs.ie"
  ],
  "stepstoneArea": "in-dublin",
  "names": {
    "teamwork": "Teamwork",
    "openai": "OpenAI",
    "clickup": "ClickUp",
    "wayflyer": "Wayflyer",
    "workhuman": "Workhuman",
    "evervault": "Evervault",
    "notion": "Notion",
    "supabase": "Supabase",
    "ramp": "Ramp",
    "linear": "Linear",
    "oyster": "Oyster",
    "paddle": "Paddle",
    "snowflake": "Snowflake",
    "cartrawler": "CarTrawler",
    "kitmanlabs": "Kitman Labs",
    "airapps": "Air Apps",
    "clickhouse": "ClickHouse",
    "cohere": "Cohere",
    "railway": "Railway",
    "camunda": "Camunda",
    "posthog": "PostHog",
    "n8n": "n8n",
    "synthesia": "Synthesia",
    "elevenlabs": "ElevenLabs",
    "zapier": "Zapier",
    "redis": "Redis",
    "doppler": "Doppler",
    "temporal": "Temporal",
    "docker": "Docker",
    "1password": "1Password",
    "vanta": "Vanta",
    "drata": "Drata",
    "neon": "Neon",
    "deepl": "DeepL",
    "pleo": "Pleo",
    "qonto": "Qonto",
    "persona": "Persona",
    "render": "Render",
    "secureframe": "Secureframe",
    "pipedrive": "Pipedrive",
    "sysdig": "Sysdig",
    "contentsquare": "Contentsquare"
  },
  "boards": {
    "greenhouse": [
      "stripe",
      "intercom",
      "datadog",
      "toast",
      "udemy",
      "qualtrics",
      "tines",
      "coinbase",
      "twilio",
      "cloudflare",
      "airbnb",
      "dropbox",
      "asana",
      "elastic",
      "mongodb",
      "okta",
      "squarespace",
      "flipdish",
      "hubspotjobs",
      "gitlab",
      "sumup",
      "grafanalabs",
      "anthropic",
      "databricks",
      "learnupon",
      "pinterest",
      "newrelic",
      "qualio",
      "zoominfo",
      "typeform",
      "truelayer",
      "canonical",
      "huntress",
      "expel",
      "planetscale",
      "remotecom",
      "mozilla",
      "wikimedia",
      "monzo",
      "cockroachlabs",
      "tailscale",
      "honeycomb",
      "gocardless",
      "netlify",
      "collibra",
      "lokalise",
      "launchdarkly",
      "cognite",
      "workato",
      "chainguard",
      "nearform",
      "bitpanda",
      "celonis",
      "veriff",
      "proton"
    ],
    "ashby": [
      "wayflyer",
      "workhuman",
      "evervault",
      "notion",
      "supabase",
      "openai",
      "ramp",
      "linear",
      "clickup",
      "oyster",
      "paddle",
      "snowflake",
      "clickhouse",
      "cohere",
      "railway",
      "camunda",
      "posthog",
      "n8n",
      "synthesia",
      "elevenlabs",
      "zapier",
      "redis",
      "doppler",
      "temporal",
      "docker",
      "1password",
      "vanta",
      "drata",
      "neon",
      "deepl",
      "pleo",
      "qonto",
      "persona",
      "render",
      "secureframe"
    ],
    "lever": [
      "kitmanlabs",
      "cartrawler",
      "pipedrive",
      "sysdig",
      "contentsquare"
    ],
    "workable": [
      "davy"
    ],
    "smartrecruiters": [
      "Version1",
      "ServiceNow",
      "Primark"
    ],
    "recruitee": [],
    "personio": [
      "teamwork"
    ],
    "workday": [
      {
        "tenant": "mastercard",
        "wd": "wd1",
        "site": "CorporateCareers"
      },
      {
        "tenant": "citi",
        "wd": "wd5",
        "site": "2"
      },
      {
        "tenant": "accenture",
        "wd": "wd103",
        "site": "AccentureCareers"
      },
      {
        "tenant": "workday",
        "wd": "wd5",
        "site": "Workday"
      },
      {
        "tenant": "fil",
        "wd": "wd3",
        "site": "001"
      },
      {
        "tenant": "fmr",
        "wd": "wd1",
        "site": "FidelityCareers"
      },
      {
        "tenant": "zendesk",
        "wd": "wd1",
        "site": "zendesk"
      },
      {
        "tenant": "alto",
        "wd": "wd1",
        "site": "FuzeHealthCareerSite"
      },
      {
        "tenant": "abcfinancial",
        "wd": "wd5",
        "site": "ABCFinancialServices"
      }
    ]
  },
  "discovered": {
    "cargurus": {
      "ats": "greenhouse",
      "company": "CarGurus"
    },
    "airapps": {
      "ats": "ashby",
      "company": "Air Apps"
    },
    "platform-engineering": {
      "ats": "ashby",
      "company": "Platform Engineering"
    },
    "crusoe": {
      "ats": "ashby",
      "company": "Crusoe"
    },
    "virtu": {
      "ats": "greenhouse",
      "company": "Virtu Financial"
    },
    "fuseenergy": {
      "ats": "workable",
      "company": "Fuse Energy"
    },
    "indra-uk": {
      "ats": "workable",
      "company": "Indra Group UK & Ireland"
    },
    "tekenable": {
      "ats": "workable",
      "company": "TEKenable"
    },
    "securityriskadvisors": {
      "ats": "workable",
      "company": "Security Risk Advisors"
    },
    "inizio": {
      "ats": "greenhouse",
      "company": "Inizio"
    }
  }
};
