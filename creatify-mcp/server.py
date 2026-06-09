#!/usr/bin/env python3
"""Creatify.ai MCP server.

A local stdio MCP server that wraps the Creatify.ai REST API so AI ad videos
can be generated from an MCP client (e.g. Claude).

Auth is two static headers on every request, read from the environment:
    CREATIFY_API_ID  -> X-API-ID
    CREATIFY_API_KEY -> X-API-KEY

Credentials are NEVER hardcoded. They are read from os.environ at request time.

Creatify is async + credit-metered: video jobs are create-then-poll, never
synchronous. `create_url_to_video` kicks off a job and returns its ID;
`check_video_status` polls that ID. Nothing here blocks waiting on a render.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

# Base URL is overridable for testing, but defaults to the live API.
BASE_URL = os.environ.get("CREATIFY_BASE_URL", "https://api.creatify.ai/api").rstrip("/")

# Generous timeout: these are create/poll calls, not long renders. We never
# block on a render, so per-request timeouts stay small.
HTTP_TIMEOUT = float(os.environ.get("CREATIFY_HTTP_TIMEOUT", "60"))

mcp = FastMCP("creatify")


def _credentials() -> tuple[str, str]:
    """Read the two API credentials from the environment.

    Raises RuntimeError with a clear message naming any missing variable.
    """
    api_id = os.environ.get("CREATIFY_API_ID")
    api_key = os.environ.get("CREATIFY_API_KEY")
    missing = [
        name
        for name, value in (("CREATIFY_API_ID", api_id), ("CREATIFY_API_KEY", api_key))
        if not value
    ]
    if missing:
        raise RuntimeError(
            "Missing required environment variable(s): "
            + ", ".join(missing)
            + ". Export them before starting the server "
            "(e.g. `export CREATIFY_API_ID=... CREATIFY_API_KEY=...`)."
        )
    return api_id, api_key  # type: ignore[return-value]


def _headers() -> dict[str, str]:
    api_id, api_key = _credentials()
    return {
        "X-API-ID": api_id,
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }


async def _request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Make one HTTP call to the Creatify API and return a structured result.

    Every HTTP call goes through here so error handling is uniform:
      - success  -> {"ok": True, "status_code": int, "data": <parsed body>}
      - HTTP 4xx/5xx -> {"ok": False, "status_code": int, "body": <raw text>, ...}
        (the raw response body is always surfaced so the caller can see exactly
        what Creatify complained about)
      - network/credential failure -> {"ok": False, "error": <message>}
    """
    url = f"{BASE_URL}/{path.lstrip('/')}"

    try:
        headers = _headers()
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.request(
                method, url, headers=headers, json=json, params=params
            )
    except httpx.HTTPError as exc:
        return {"ok": False, "error": f"HTTP request to {url} failed: {exc!r}"}

    if resp.status_code // 100 != 2:
        # Non-2xx: hand back the status code AND the raw body verbatim.
        return {
            "ok": False,
            "status_code": resp.status_code,
            "body": resp.text,
            "method": method,
            "url": url,
        }

    try:
        data: Any = resp.json()
    except ValueError:
        data = {"raw": resp.text}

    return {"ok": True, "status_code": resp.status_code, "data": data}


@mcp.tool()
async def get_remaining_credits() -> dict[str, Any]:
    """Return the workspace's remaining Creatify credits.

    Sanity-check tool: a successful number here proves the X-API-ID / X-API-KEY
    auth headers are valid. Maps to GET /api/remaining_credits/.
    """
    result = await _request("GET", "/remaining_credits/")
    if not result.get("ok"):
        return result
    data = result["data"]
    return {
        "ok": True,
        "remaining_credits": data.get("remaining_credits"),
        "raw": data,
    }


@mcp.tool()
async def create_url_to_video(
    url: str,
    aspect_ratio: str = "9x16",
    video_length: int = 15,
    language: str = "en",
    visual_style: str | None = None,
    script_style: str | None = None,
    target_platform: str | None = None,
    target_audience: str | None = None,
    name: str | None = None,
    override_avatar: str | None = None,
    override_voice: str | None = None,
    override_script: str | None = None,
    model_version: str | None = None,
    webhook_url: str | None = None,
    no_caption: bool | None = None,
    no_background_music: bool | None = None,
) -> dict[str, Any]:
    """Create an AI ad video from a URL (the full create flow, kicked off async).

    Two API calls, in order:
      1. POST /api/links/        body {"url": <url>}  -> returns a link `id` (UUID)
      2. POST /api/link_to_videos/ body {"link": <link id>, ...options} -> returns
         the video job `id` (UUID) + `status`

    Returns the link id, the video job id, and the initial status. This does NOT
    wait for the render — poll the returned `video_id` with `check_video_status`.

    Required:
      url            The page to turn into a video ad.

    Common options (all have Creatify-side defaults; only `url` is mandatory):
      aspect_ratio   "9x16" (default here), "16x9", or "1x1".
      video_length   15 (default), 30, 45, or 60 seconds.
      language       ISO code, e.g. "en" (default), "es", "fr", "de", "ja", ...
      visual_style   Template name, e.g. "AvatarBubbleTemplate" (Creatify default),
                     "DynamicProductTemplate", "FullScreenTemplate", ...
      script_style   e.g. "DiscoveryWriter" (Creatify default), "BenefitsV2",
                     "ProblemSolutionV2", "CallToActionV2", ...
      target_platform   e.g. "tiktok" (Creatify default), "instagram", "youtube".
      target_audience   Free text, e.g. "young adults".
      name              Optional name for the video.
      override_avatar   Avatar id (from GET /api/personas/) to force a specific avatar.
      override_voice    Voice id (from GET /api/voices/) to force a specific voice.
      override_script   Provide your own script instead of an AI-generated one.
      model_version     "standard" (default), "aurora_v1", or "aurora_v1_fast".
      webhook_url       URL that receives a POST on job success/failure.
      no_caption           True to disable captions.
      no_background_music  True to disable background music.
    """
    # --- Step 1: create the link --------------------------------------------
    link_result = await _request("POST", "/links/", json={"url": url})
    if not link_result.get("ok"):
        return {"step": "create_link", **link_result}

    link_id = link_result["data"].get("id")
    if not link_id:
        return {
            "ok": False,
            "step": "create_link",
            "error": "Link created but no `id` was returned.",
            "raw": link_result["data"],
        }

    # --- Step 2: create the video from the link -----------------------------
    body: dict[str, Any] = {
        "link": link_id,
        "aspect_ratio": aspect_ratio,
        "video_length": video_length,
        "language": language,
    }
    optional = {
        "visual_style": visual_style,
        "script_style": script_style,
        "target_platform": target_platform,
        "target_audience": target_audience,
        "name": name,
        "override_avatar": override_avatar,
        "override_voice": override_voice,
        "override_script": override_script,
        "model_version": model_version,
        "webhook_url": webhook_url,
        "no_caption": no_caption,
        "no_background_music": no_background_music,
    }
    # Only send options the caller actually set, so Creatify's own defaults apply.
    body.update({key: value for key, value in optional.items() if value is not None})

    video_result = await _request("POST", "/link_to_videos/", json=body)
    if not video_result.get("ok"):
        return {"step": "create_video", "link_id": link_id, **video_result}

    data = video_result["data"]
    return {
        "ok": True,
        "link_id": link_id,
        "video_id": data.get("id"),
        "status": data.get("status"),
        "credits_used": data.get("credits_used"),
        "hint": "Poll `video_id` with check_video_status until status is 'done'.",
    }


@mcp.tool()
async def check_video_status(video_id: str) -> dict[str, Any]:
    """Poll a URL-to-Video job and report its status.

    Maps to GET /api/link_to_videos/{video_id}/.

    `status` is one of: pending, in_queue, running, done, failed, rejected.
    When `status` == "done", `video_output` holds the final video URL.
    On failure, `failed_reason` explains why.
    """
    result = await _request("GET", f"/link_to_videos/{video_id}/")
    if not result.get("ok"):
        return result

    data = result["data"]
    status = data.get("status")
    return {
        "ok": True,
        "video_id": data.get("id"),
        "status": status,
        "progress": data.get("progress"),
        "video_output": data.get("video_output") if status == "done" else None,
        "video_thumbnail": data.get("video_thumbnail"),
        "failed_reason": data.get("failed_reason"),
        "duration": data.get("duration"),
        "credits_used": data.get("credits_used"),
        "is_done": status == "done",
    }


def main() -> None:
    """Validate credentials, then run the stdio MCP server."""
    try:
        _credentials()
    except RuntimeError as exc:
        print(f"[creatify-mcp] startup error: {exc}", file=sys.stderr)
        sys.exit(1)
    mcp.run()


if __name__ == "__main__":
    main()
