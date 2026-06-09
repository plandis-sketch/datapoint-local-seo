# creatify-mcp

A local **stdio MCP server** that wraps the [Creatify.ai](https://creatify.ai) REST
API so you can generate AI ad videos from an MCP client (e.g. Claude). It speaks
to the live Creatify API over HTTP — no hosting, no web server of its own.

Creatify is **credit-metered and asynchronous**: video jobs are *create-then-poll*,
never synchronous. The create tool kicks off a render and returns an ID; a separate
tool polls that ID. Nothing here blocks waiting on a render.

---

## 1. Requirements & install

```bash
cd creatify-mcp
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # mcp[cli] + httpx
```

## 2. Credentials (never hardcoded)

The server reads two static API credentials from the environment on every request.
Get them from your Creatify dashboard settings page.

```bash
export CREATIFY_API_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   # NB: this is a UUID
export CREATIFY_API_KEY=your-api-key
```

They are sent as the headers `X-API-ID` and `X-API-KEY`. If either is missing the
server prints a clear error at startup and exits; individual tools return a clear
error result rather than crashing.

Optional overrides: `CREATIFY_BASE_URL` (default `https://api.creatify.ai/api`),
`CREATIFY_HTTP_TIMEOUT` (default `60` seconds).

## 3. Smoke-test against the live API first (Step 5)

Before registering, confirm auth works and a job round-trips, using raw curl:

```bash
./test_api.sh                       # uses https://example.com
./test_api.sh https://your-site.com # your own URL
```

It runs the same four calls the server makes (credits → create link → create video
→ poll). **Steps 2–3 spend credits** (1 for the link + 5 per 30s of video). If the
credits call returns a number, auth is good. If it returns `401/403`, your
credentials are wrong — fix them before going further.

## 4. Run / register the server

Run it directly (stdio transport):

```bash
python server.py
# or, with the MCP CLI dev inspector:
mcp dev server.py
```

Register it with Claude Code as a stdio server, passing the env vars through:

```bash
claude mcp add creatify \
  --env CREATIFY_API_ID=$CREATIFY_API_ID \
  --env CREATIFY_API_KEY=$CREATIFY_API_KEY \
  -- /absolute/path/to/creatify-mcp/.venv/bin/python /absolute/path/to/creatify-mcp/server.py
```

Equivalent `.mcp.json` / `claude_desktop_config.json` entry:

```json
{
  "mcpServers": {
    "creatify": {
      "command": "/absolute/path/to/creatify-mcp/.venv/bin/python",
      "args": ["/absolute/path/to/creatify-mcp/server.py"],
      "env": {
        "CREATIFY_API_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "CREATIFY_API_KEY": "your-api-key"
      }
    }
  }
}
```

Use the venv's Python interpreter path so the `mcp` and `httpx` deps resolve.

---

## 5. Tools exposed

### `get_remaining_credits()`
Sanity check that proves auth works. No arguments.
→ `GET /api/remaining_credits/`. Returns `{ remaining_credits: <number> }`.

### `create_url_to_video(url, ...)`
Full create flow, fired async. Internally:
1. `POST /api/links/` with `{"url": url}` → returns a link `id` (UUID).
2. `POST /api/link_to_videos/` with `{"link": <link id>, ...options}` → returns the
   video job `id` (UUID) + initial `status`.

Returns `{ link_id, video_id, status, credits_used }`. **Does not wait** for the
render — poll `video_id` with `check_video_status`.

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `url` | **yes** | — | The page to turn into a video ad. |
| `aspect_ratio` | no | `9x16` | `9x16`, `16x9`, or `1x1`. |
| `video_length` | no | `15` | `15`, `30`, `45`, or `60` seconds. |
| `language` | no | `en` | ISO code (`en`, `es`, `fr`, `de`, `ja`, …). |
| `visual_style` | no | Creatify default (`AvatarBubbleTemplate`) | Template name, e.g. `DynamicProductTemplate`, `FullScreenTemplate`. |
| `script_style` | no | Creatify default (`DiscoveryWriter`) | e.g. `BenefitsV2`, `ProblemSolutionV2`, `CallToActionV2`. |
| `target_platform` | no | Creatify default (`tiktok`) | e.g. `instagram`, `youtube`. |
| `target_audience` | no | Creatify default | Free text, e.g. `young adults`. |
| `name` | no | — | Optional video name. |
| `override_avatar` | no | — | Avatar id (from `GET /api/personas/`). |
| `override_voice` | no | — | Voice id (from `GET /api/voices/`). |
| `override_script` | no | — | Supply your own script. |
| `model_version` | no | `standard` | `standard`, `aurora_v1`, `aurora_v1_fast`. |
| `webhook_url` | no | — | Gets a POST on job success/failure. |
| `no_caption` | no | — | `true` to disable captions. |
| `no_background_music` | no | — | `true` to disable background music. |

Only options you actually set are sent, so Creatify's own defaults apply otherwise.

### `check_video_status(video_id)`
→ `GET /api/link_to_videos/{video_id}/`. Returns
`{ status, progress, video_output, video_thumbnail, failed_reason, duration, credits_used, is_done }`.

`status` ∈ `pending → in_queue → running → done | failed | rejected`.
When `status == "done"`, `video_output` holds the final video URL.

---

## 6. Adding more endpoints later

Ad Clone, AI Shorts, AI Avatar, Product-to-Video, etc. all follow the same
**create / poll / list** shape, so adding one is mechanical:

1. Find the endpoint in the docs index <https://docs.creatify.ai/llms.txt>. Each
   `.md` page embeds its OpenAPI YAML (request body fields, required params,
   response schema) — that's the source of truth.
2. Add a `create_*` tool that `POST`s to the create endpoint and returns the job
   `id` + `status` (do **not** block on the render).
3. Add a `check_*_status` tool that `GET`s `/{id}/` and returns status + output URL.
4. Reuse the existing `_request()` helper — it already handles auth headers,
   non-2xx status+body passthrough, and network errors uniformly.

Example endpoint families (all under the same `X-API-ID` / `X-API-KEY` auth):

| Feature | Create | Poll | List |
|---------|--------|------|------|
| AI Shorts | `POST /api/ai_shorts/` | `GET /api/ai_shorts/{id}/` | `GET /api/ai_shorts/` |
| Ad Clone | `POST /api/ads_clone/` | `GET /api/ads_clone/{id}/` | `GET /api/ads_clone/` |
| AI Avatar (lipsync) | `POST /api/lipsyncs/` | `GET /api/lipsyncs/{id}/` | `GET /api/lipsyncs/` |
| Product to Video | `POST /api/product_to_videos/{id}/gen_video/` | `GET /api/product_to_videos/{id}/` | `GET /api/product_to_videos/` |

(Routes above verified against each endpoint's embedded OpenAPI YAML on
<https://docs.creatify.ai>.)

Many of these also have `…/preview` + `…/render` two-phase variants — check the
specific `.md` page before wiring them up.
