# Google Analytics MCP Server — Full Setup & Context Guide

This is the complete, self-contained guide for getting the Google Analytics
MCP server running on a machine, written so you (or anyone) can set it up on a
fresh computer and understand *why* each step exists. It captures everything we
worked through, including the gotchas.

If you just want the short version, see [`README.md`](./README.md). This file is
the "full context" version.

---

## 1. What this is

A **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server
(`mcp/ga-server.mjs`) that connects Google Analytics 4 (GA4) data to MCP clients
like **Claude Desktop** and **Claude Code**. You ask questions in plain language
("how many users last week for property X?") and it runs the corresponding GA4
report.

- Built in **Node.js** with `@modelcontextprotocol/sdk` + Google's official GA4
  `@google-analytics/data` and `@google-analytics/admin` client libraries.
- Modeled on Google's official (Python) `analytics-mcp`, but in Node so it fits
  this repo's stack.
- **Read-only** — it can read reports/config but can never change GA settings.
- Talks to clients over **stdio** (the client launches the process and pipes
  JSON-RPC in/out).

### Tools it exposes

| Tool | Purpose |
| --- | --- |
| `list_account_summaries` | List every GA4 account/property the credentials can access. Start here to find property IDs. |
| `get_property_details` | Config for one property (time zone, currency, industry). |
| `get_metadata` | Valid dimensions/metrics for a property, including custom ones. |
| `run_report` | Standard GA4 report — dimensions, metrics, date range, filters, ordering, limit. |
| `run_realtime_report` | Realtime report (~last 30 minutes). |

---

## 2. The key architecture decision: ONE server for MANY GA4 accounts

**You do NOT build a separate server per GA4 account.** This single server +
single service account handles unlimited GA4 accounts:

- Every reporting tool takes a `property` ID parameter, so the server is
  **multi-tenant by design**. `list_account_summaries` returns every property
  the service account can see; you pass whichever property you want per call.
- A single **service account** can be added as a **Viewer** on unlimited GA4
  accounts. Onboarding a new account = one step: add the service account's email
  as a Viewer in that GA4 account. No new server, no new key, no redeploy.

**At scale, two things to remember:**
1. **API quota is shared at the Google Cloud _project_ level.** All accounts run
   through the one service account in one GCP project, drawing from that
   project's [GA Data API quota](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas).
   Fine for normal use; request an increase or split heavy clients into separate
   GCP projects if you ever hammer it.
2. **MCP is for LLM/agent clients.** If a "dashboard" is Claude/agent-powered,
   MCP is right. If it's a traditional charts-and-widgets web app, that backend
   should usually call the GA4 Data API **directly** (same `@google-analytics/data`
   library this server wraps) rather than going through an MCP/LLM layer.

---

## 3. Our current credentials (reference)

These are the values we set up. **The JSON key file is a secret — never commit
it to git or share it publicly.** The project ID and service account email are
not secret.

| Item | Value |
| --- | --- |
| Google Cloud project ID | `emerald-result-500920-i9` |
| Service account email | `ga-mcp@emerald-result-500920-i9.iam.gserviceaccount.com` |
| Service account key file | `emerald-result-500920-i9-4e15a2fde004.json` (keep this safe) |

To use this on another computer you must **securely copy the JSON key file** to
that machine (AirDrop, a password manager's secure file storage, an encrypted
drive — *not* email or git). You can also create a brand-new key for the same
service account from the Cloud console (Service Accounts → Keys → Add Key) so
each machine has its own.

---

## 4. Setup on a fresh computer (step by step)

### 4.1 Prerequisites
- **Node.js 18+** (we used Node 22). Check with `node --version`.
- **git**.
- The service account JSON key file copied to the machine (see §3).

### 4.2 Clone the repo and install
```bash
git clone https://github.com/plandis-sketch/datapoint-local-seo.git
cd datapoint-local-seo
git checkout claude/google-analytics-mcp-server-gp7psa
npm install
```
`npm install` should finish in a few seconds and end with `added NNN packages`.

> **Note:** an earlier version of this repo listed `puppeteer` as a dependency,
> which made `npm install` hang for minutes downloading Chromium. That's been
> removed. If you're ever on an old checkout and it hangs, cancel and run
> `PUPPETEER_SKIP_DOWNLOAD=1 npm install`.

### 4.3 Point the server at the service account key
Move the key somewhere stable (not Downloads) so the path doesn't break later,
e.g.:
```bash
mkdir -p ~/.config
mv ~/Downloads/emerald-result-500920-i9-4e15a2fde004.json ~/.config/ga-mcp-key.json
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/ga-mcp-key.json"
```
> The `export` only lasts for the current terminal session. The permanent home
> for this path is the Claude client config in §6 — that's what matters for
> day-to-day use. The `export` is just for the smoke test below.

### 4.4 Enable the APIs (once per Google Cloud project — already done for ours)
- Analytics Data API: https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com
- Analytics Admin API: https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com

### 4.5 Grant the service account access to GA4 data
For **each** GA4 account you want to read:
1. https://analytics.google.com → **Admin** (gear, bottom-left).
2. **Account Access Management** → blue **+** → **Add users**.
3. Paste `ga-mcp@emerald-result-500920-i9.iam.gserviceaccount.com`, role
   **Viewer**, uncheck "Notify by email", **Add**.

### 4.6 Smoke test
Run from inside the repo folder:
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_account_summaries","arguments":{}}}' | node mcp/ga-server.mjs | tail -1
```
- Accounts listed → **fully working.**
- `"accountCount": 0, "accounts": []` with no error → **auth works**, the service
  account just hasn't been added as a Viewer to any GA4 account yet (§4.5).

---

## 5. Connect to Claude Code

From the repo root (so `$(pwd)` resolves correctly):
```bash
claude mcp add google-analytics \
  --env GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/ga-mcp-key.json" \
  -- node "$(pwd)/mcp/ga-server.mjs"
```
Then in Claude Code, ask: *"List my Google Analytics properties."*

---

## 6. Connect to Claude Desktop

Edit the config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-analytics": {
      "command": "node",
      "args": ["/absolute/path/to/datapoint-local-seo/mcp/ga-server.mjs"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/Users/YOU/.config/ga-mcp-key.json"
      }
    }
  }
}
```
Use **absolute paths** (Claude Desktop doesn't expand `~` or `$(pwd)`). Restart
Claude Desktop; the GA tools appear in the tools menu.

---

## 7. Onboarding a new GA4 account later

1. Add `ga-mcp@emerald-result-500920-i9.iam.gserviceaccount.com` as a **Viewer**
   in that GA4 account (§4.5).
2. That's it. Nothing to redeploy. Run `list_account_summaries` and the new
   property appears.

---

## 8. Example prompts

- "List my Google Analytics properties."
- "For property 123456789, how many active users and sessions in the last 7 days,
  by day?"
- "Top 10 landing pages by sessions last month for property 123456789."
- "How many users are on the site right now, by country?"

---

## 9. Troubleshooting (every issue we actually hit)

| Symptom | Cause & Fix |
| --- | --- |
| `npm install` hangs for minutes on a spinner | Old checkout still had `puppeteer` downloading Chromium. Cancel, then `PUPPETEER_SKIP_DOWNLOAD=1 npm install`. (Already removed on this branch.) |
| `npm error code EACCES ... ~/.npm/_cacache ... root-owned files` | npm cache permissions. Run the exact command npm prints, e.g. `sudo chown -R 501:20 "$HOME/.npm"`, then re-install. |
| Smoke test prints a blank line | `node_modules` wasn't installed (the install above failed). Fix the install first. Drop the `2>/dev/null` to see real errors. |
| `Error: Could not load the default credentials` | No credentials. Set `GOOGLE_APPLICATION_CREDENTIALS` to the key file path. |
| `Error: Request had insufficient authentication scopes` | Used `gcloud` user login without the analytics scope. **Use the service account instead** (this guide) — it avoids the problem entirely. |
| **"This app is blocked"** in the browser during `gcloud auth ... login` | Google blocks gcloud's default OAuth client from sensitive scopes like Analytics (common on Workspace accounts). **Don't use user login — use the service account** (this guide). |
| `"accountCount": 0, "accounts": []` (no error) | Auth works; the service account isn't a Viewer on any GA4 account yet. Add it (§4.5). May take a minute to propagate. |
| `PERMISSION_DENIED` on a specific property | Service account lacks access to *that* property. Add it as a Viewer there. |
| `... API has not been used in project ... or it is disabled` | Enable the Data API and Admin API (§4.4). |
| `Invalid dimension/metric name` | Run `get_metadata` for that property to see valid field names. |
| `AutopaginateTrueWarning` on screen | Harmless library notice on stderr. Ignore it. |

---

## 10. Security notes

- **Never commit the service account JSON key.** The repo's `.gitignore` blocks
  `.env`, `*service-account*.json`, and `google-credentials*.json`, but a key
  with a different name (like ours) could slip through — keep it **outside** the
  repo folder (e.g. `~/.config/ga-mcp-key.json`).
- Treat the key like a password. If it leaks, delete it in the Cloud console
  (Service Accounts → Keys) and create a new one.
- The service account only ever has **Viewer** access to GA, so worst case is
  read-only exposure of analytics data — but still, guard the key.

---

## 11. File map

| File | What it is |
| --- | --- |
| `mcp/ga-server.mjs` | The MCP server. |
| `mcp/README.md` | Short setup reference. |
| `mcp/SETUP.md` | This full-context guide. |
| `mcp/.mcp.json.example` | Example project-scoped MCP client config. |
| `package.json` | Has the deps and the `npm run mcp` script. |
