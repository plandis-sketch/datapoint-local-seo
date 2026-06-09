#!/usr/bin/env bash
#
# Step 5 — live API smoke test with raw curl, run on the machine where your
# CREATIFY_API_ID / CREATIFY_API_KEY env vars are exported.
#
# It exercises the exact same three calls the MCP server makes:
#   1. GET  /api/remaining_credits/      (proves auth works)
#   2. POST /api/links/                  (create a link from a URL)
#   3. POST /api/link_to_videos/         (create the video job)
#   4. GET  /api/link_to_videos/{id}/    (poll the job once)
#
# Usage:
#   ./test_api.sh                       # uses https://example.com as the test URL
#   ./test_api.sh https://your-site.com # use your own URL
#
# NOTE: steps 2-3 SPEND CREDITS (1 for the link + 5 per 30s of video).
# Comment out the create section if you only want to verify auth.

set -uo pipefail

BASE_URL="${CREATIFY_BASE_URL:-https://api.creatify.ai/api}"
TEST_URL="${1:-https://example.com}"

if [[ -z "${CREATIFY_API_ID:-}" || -z "${CREATIFY_API_KEY:-}" ]]; then
  echo "ERROR: CREATIFY_API_ID and/or CREATIFY_API_KEY are not set in the environment." >&2
  echo "Export them first:  export CREATIFY_API_ID=... CREATIFY_API_KEY=..." >&2
  exit 1
fi

auth=(-H "X-API-ID: ${CREATIFY_API_ID}" -H "X-API-KEY: ${CREATIFY_API_KEY}")

echo "=================================================================="
echo "1) GET ${BASE_URL}/remaining_credits/   (auth check)"
echo "=================================================================="
curl -sS -w "\n--- HTTP %{http_code} ---\n" "${auth[@]}" "${BASE_URL}/remaining_credits/"

echo
echo "=================================================================="
echo "2) POST ${BASE_URL}/links/   (create link from ${TEST_URL})"
echo "=================================================================="
link_json="$(curl -sS "${auth[@]}" -H "Content-Type: application/json" \
  -d "{\"url\": \"${TEST_URL}\"}" "${BASE_URL}/links/")"
echo "${link_json}"

# Extract the link id without requiring jq (falls back to jq if present).
if command -v jq >/dev/null 2>&1; then
  link_id="$(printf '%s' "${link_json}" | jq -r '.id // empty')"
else
  link_id="$(printf '%s' "${link_json}" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi
echo "link_id = ${link_id:-<none>}"

if [[ -z "${link_id:-}" ]]; then
  echo "No link id returned — stopping before video creation." >&2
  exit 1
fi

echo
echo "=================================================================="
echo "3) POST ${BASE_URL}/link_to_videos/   (create 15s 9x16 video job)"
echo "=================================================================="
video_json="$(curl -sS "${auth[@]}" -H "Content-Type: application/json" \
  -d "{\"link\": \"${link_id}\", \"aspect_ratio\": \"9x16\", \"video_length\": 15}" \
  "${BASE_URL}/link_to_videos/")"
echo "${video_json}"

if command -v jq >/dev/null 2>&1; then
  video_id="$(printf '%s' "${video_json}" | jq -r '.id // empty')"
else
  video_id="$(printf '%s' "${video_json}" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi
echo "video_id = ${video_id:-<none>}"

if [[ -z "${video_id:-}" ]]; then
  echo "No video id returned — stopping before poll." >&2
  exit 1
fi

echo
echo "=================================================================="
echo "4) GET ${BASE_URL}/link_to_videos/${video_id}/   (poll once)"
echo "=================================================================="
curl -sS -w "\n--- HTTP %{http_code} ---\n" "${auth[@]}" "${BASE_URL}/link_to_videos/${video_id}/"
echo
echo "Done. Re-run step 4 until \"status\":\"done\" and \"video_output\" is populated."
