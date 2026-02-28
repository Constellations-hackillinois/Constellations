"""Stage 4: Save results to Supabase paper_documents + upload to Supermemory."""

import logging
import re

import httpx
from supabase import create_client

from config import (
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPERMEMORY_API_KEY,
    SUPERMEMORY_CONTAINER_TAG,
    DENSIFIED_CACHE,
)

logger = logging.getLogger(__name__)

SUPERMEMORY_BASE = "https://api.supermemory.ai"


def _get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def _sanitize_custom_id(key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", key)


async def _supermemory_request(
    method: str, path: str, body: dict | None = None
) -> dict:
    """Make an authenticated request to Supermemory API."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(
            method,
            f"{SUPERMEMORY_BASE}{path}",
            json=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {SUPERMEMORY_API_KEY}",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def update_paper_status(
    arxiv_id: str,
    status: str,
    error_message: str | None = None,
    **extra_fields,
) -> None:
    """Update the paper_documents row in Supabase."""
    logger.info("[store] Updating %s status to '%s'", arxiv_id, status)
    sb = _get_supabase()
    data = {"status": status, **extra_fields}
    if error_message:
        data["error_message"] = error_message
    sb.table("paper_documents").update(data).eq("arxiv_id", arxiv_id).execute()


async def save_results(
    arxiv_id: str,
    paper_title: str | None,
    constellation_id: str,
    markdown: str,
    densified_markdown: str,
    word_count: int,
) -> None:
    """
    Save all pipeline outputs to Supabase and upload densified markdown to Supermemory.
    """
    # Save densified markdown to cache file
    cache_path = DENSIFIED_CACHE / f"{arxiv_id.replace('/', '_')}.md"
    cache_path.write_text(densified_markdown, encoding="utf-8")
    logger.info("[store] Cached densified markdown: %s", cache_path)

    # Update paper_documents in Supabase
    sb = _get_supabase()
    sb.table("paper_documents").update({
        "status": "complete",
        "markdown": markdown,
        "densified_markdown": densified_markdown,
        "word_count": word_count,
    }).eq("arxiv_id", arxiv_id).execute()
    logger.info("[store] Supabase paper_documents updated for %s", arxiv_id)

    # Upload densified markdown to Supermemory (replacing URL-based ingestion)
    doc_key = arxiv_id
    custom_id = _sanitize_custom_id(doc_key)

    try:
        # Check if document already exists in Supermemory
        list_result = await _supermemory_request("POST", "/v3/documents/list", {
            "containerTags": [SUPERMEMORY_CONTAINER_TAG],
            "filters": {
                "AND": [{"filterType": "metadata", "key": "doc_key", "value": doc_key}],
            },
        })
        docs = list_result.get("documents") or list_result.get("results") or []

        if docs:
            existing = docs[0]
            ids: list[str] = (existing.get("metadata") or {}).get("constellation_ids", [])
            if constellation_id not in ids:
                ids.append(constellation_id)
            # Patch existing doc with densified content
            await _supermemory_request("PATCH", f"/v3/documents/{existing['id']}", {
                "content": densified_markdown,
                "metadata": {
                    "doc_key": doc_key,
                    "constellation_ids": ids,
                    "paper_title": paper_title,
                    "processed": True,
                },
            })
            logger.info("[store] Patched Supermemory doc for %s", arxiv_id)
        else:
            # Create new document with densified content
            title_prefix = f"# {paper_title}\n\n" if paper_title else ""
            await _supermemory_request("POST", "/v3/documents", {
                "content": title_prefix + densified_markdown,
                "containerTag": SUPERMEMORY_CONTAINER_TAG,
                "customId": custom_id,
                "metadata": {
                    "doc_key": doc_key,
                    "constellation_ids": [constellation_id],
                    "paper_title": paper_title,
                    "processed": True,
                },
            })
            logger.info("[store] Created Supermemory doc for %s", arxiv_id)

    except Exception as e:
        logger.error("[store] Supermemory upload failed for %s: %s", arxiv_id, e)
        # Don't fail the whole pipeline - paper is still saved in Supabase
        raise
