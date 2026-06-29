# Google Analytics MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes your Google Analytics 4 (GA4) data to MCP clients such as
**Claude Desktop** and **Claude Code**. It lets you ask questions like
_"How many users did I have yesterday?"_ or _"What were my top landing pages
last month?"_ in plain language.

It's written in Node.js so it fits this project's stack. It mirrors the
capabilities of [Google's official `analytics-mcp`](https://github.com/googleanalytics/google-analytics-mcp)
server (which is Python).

> **Read-only.** This server can only read reports and configuration. It can't
> change any Google Analytics settings.

## Tools

| Tool | What it does |
| --- | --- |
| `list_account_summaries` | Lists all GA4 accounts/properties you can access. Start here to find your **property ID**. |
| `get_property_details` | Configuration for one property (time zone, currency, industry, etc.). |
| `get_metadata` | Lists the dimensions and metrics available for a property, including custom ones. Use it to find valid field names. |
| `run_report` | Runs a standard GA4 report (dimensions, metrics, date range, filters, ordering, limit). |
| `run_realtime_report` | Runs a realtime report (~last 30 minutes). |

## Prerequisites

1. **A Google Cloud project** with these APIs enabled:
   - Google Analytics Data API
   - Google Analytics Admin API
2. **Node.js 18+** (the repo targets Node 18/22).
3. **Credentials** with the `https://www.googleapis.com/auth/analytics.readonly`
   scope (see below).

## Authentication

The server uses **Application Default Credentials (ADC)**. Pick one option:

### Option A — Service account (recommended for servers)

1. In Google Cloud Console, create a **service account** and download its JSON
   key.
2. In Google Analytics, add the service account's email
   (`...@...iam.gserviceaccount.com`) as a **Viewer** on the property/account
   (Admin → Account/Property Access Management).
3. Point the server at the key file via the `GOOGLE_APPLICATION_CREDENTIALS`
   environment variable.

### Option B — Your own user account (quick local testing)

```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform
```

## Install

```bash
npm install
```

## Run it standalone (sanity check)

```bash
npm run mcp
# -> "Google Analytics MCP server running on stdio"
```

The server speaks the MCP protocol over **stdio**, so it's meant to be launched
by an MCP client rather than used directly. Press Ctrl-C to stop.

## Connect to Claude Code

Add it as an MCP server (run from the repo root so the path resolves):

```bash
claude mcp add google-analytics \
  --env GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json \
  -- node "$(pwd)/mcp/ga-server.mjs"
```

Or add it to a project-scoped `.mcp.json` (see `.mcp.json.example` in this
folder) and let Claude Code pick it up.

## Connect to Claude Desktop

Edit your `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-analytics": {
      "command": "node",
      "args": ["/absolute/path/to/datapoint-local-seo/mcp/ga-server.mjs"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/service-account.json"
      }
    }
  }
}
```

Restart Claude Desktop. The Google Analytics tools will appear in the tools menu.

## Example prompts

- "List my Google Analytics properties."
- "For property 123456789, how many active users and sessions did I get in the
  last 7 days, broken down by day?"
- "What were my top 10 landing pages by sessions last month for property
  123456789?"
- "How many users are on the site right now, by country?"

## Troubleshooting

- **`Could not load the default credentials`** — ADC isn't configured. Set
  `GOOGLE_APPLICATION_CREDENTIALS` or run the `gcloud` command above.
- **`PERMISSION_DENIED`** — the authenticated identity doesn't have access to
  that GA property. Add it as a Viewer in GA's Access Management.
- **`API has not been used in project ... or it is disabled`** — enable the
  Analytics Data API and Admin API in your Google Cloud project.
- **Invalid dimension/metric name** — run `get_metadata` for the property to see
  valid field names.
