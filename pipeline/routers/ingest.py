"""POST /ingest - triggers the PDF processing pipeline."""

import logging

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_ANON_KEY
from utils.arxiv import extract_arxiv_id
from stages.download import download_pdf
from stages.markdown import convert_pdf_to_markdown
from stages.densify import densify_markdown
from stages.store import save_results, update_paper_status

logger = logging.getLogger(__name__)
router = APIRouter()


class IngestRequest(BaseModel):
    arxiv_id: str | None = None
    paper_url: str
    paper_title: str | None = None
    constellation_id: str


async def _run_pipeline(
    arxiv_id: str,
    paper_url: str,
    paper_title: str | None,
    constellation_id: str,
) -> None:
    """Execute the full pipeline as a background task."""
    try:
        # Stage 1: Download PDF
        logger.info("[pipeline] Stage 1: Downloading PDF for %s", arxiv_id)
        await update_paper_status(arxiv_id, "downloading")
        dl_result = await download_pdf(arxiv_id, paper_url)

        # Stage 2: Convert PDF to markdown via Gemini
        logger.info("[pipeline] Stage 2: Converting PDF to markdown for %s", arxiv_id)
        await update_paper_status(arxiv_id, "converting")
        md = await convert_pdf_to_markdown(dl_result["pdf_bytes"])

        # Stage 3: Densify markdown via Gemini
        logger.info("[pipeline] Stage 3: Densifying markdown for %s", arxiv_id)
        await update_paper_status(arxiv_id, "densifying")
        try:
            densified = await densify_markdown(md)
            logger.info("[pipeline] Densification complete for %s: %d -> %d chars", arxiv_id, len(md), len(densified))
        except Exception as e:
            logger.warning("[pipeline] Densification failed for %s, using raw markdown: %s", arxiv_id, e)
            densified = md  # Graceful degradation

        # Stage 4: Store results
        logger.info("[pipeline] Stage 4: Storing results for %s", arxiv_id)
        word_count = len(densified.split())
        await save_results(
            arxiv_id=arxiv_id,
            paper_title=paper_title,
            constellation_id=constellation_id,
            markdown=md,
            densified_markdown=densified,
            word_count=word_count,
        )
        logger.info("[pipeline] Pipeline complete for %s", arxiv_id)

    except Exception as e:
        logger.error("[pipeline] Pipeline failed for %s: %s", arxiv_id, e)
        await update_paper_status(arxiv_id, "failed", error_message=str(e))


@router.post("/ingest")
async def ingest(req: IngestRequest, background_tasks: BackgroundTasks):
    """Trigger the PDF ingestion pipeline for a paper."""
    arxiv_id = req.arxiv_id or extract_arxiv_id(req.paper_url)
    logger.info("[ingest] Received request: arxiv_id=%s, url=%s, constellation=%s", arxiv_id, req.paper_url, req.constellation_id)

    if not arxiv_id:
        logger.warning("[ingest] Skipping non-arxiv URL: %s", req.paper_url)
        return {"status": "skipped", "reason": "not_arxiv"}

    sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

    # Check for existing record
    existing = (
        sb.table("paper_documents")
        .select("status")
        .eq("arxiv_id", arxiv_id)
        .limit(1)
        .execute()
    )

    if existing.data and len(existing.data) > 0:
        current_status = existing.data[0]["status"]
        logger.info("[ingest] Existing record for %s: status=%s", arxiv_id, current_status)
        if current_status == "complete":
            # Already processed - just tag the constellation in Supermemory
            background_tasks.add_task(
                _tag_constellation, arxiv_id, req.constellation_id
            )
            return {"status": "already_complete", "arxiv_id": arxiv_id}
        if current_status in ("downloading", "converting", "densifying"):
            return {"status": "in_progress", "arxiv_id": arxiv_id}
        # If failed or pending, retry
        logger.info("[ingest] Retrying %s (was %s)", arxiv_id, current_status)
        sb.table("paper_documents").update({
            "status": "pending",
            "error_message": None,
        }).eq("arxiv_id", arxiv_id).execute()
    else:
        # Insert new record
        logger.info("[ingest] Creating new record for %s", arxiv_id)
        sb.table("paper_documents").insert({
            "arxiv_id": arxiv_id,
            "paper_url": req.paper_url,
            "paper_title": req.paper_title,
            "status": "pending",
        }).execute()

    background_tasks.add_task(
        _run_pipeline, arxiv_id, req.paper_url, req.paper_title, req.constellation_id
    )
    logger.info("[ingest] Pipeline started for %s", arxiv_id)
    return {"status": "started", "arxiv_id": arxiv_id}


async def _tag_constellation(arxiv_id: str, constellation_id: str) -> None:
    """Tag an already-processed paper with a new constellation ID in Supermemory."""
    from stages.store import _supermemory_request, SUPERMEMORY_CONTAINER_TAG

    logger.info("[ingest] Tagging %s with constellation %s", arxiv_id, constellation_id)
    try:
        list_result = await _supermemory_request("POST", "/v3/documents/list", {
            "containerTags": [SUPERMEMORY_CONTAINER_TAG],
            "filters": {
                "AND": [{"filterType": "metadata", "key": "doc_key", "value": arxiv_id}],
            },
        })
        docs = list_result.get("documents") or list_result.get("results") or []
        if docs:
            existing = docs[0]
            ids: list[str] = (existing.get("metadata") or {}).get("constellation_ids", [])
            if constellation_id not in ids:
                ids.append(constellation_id)
                await _supermemory_request("PATCH", f"/v3/documents/{existing['id']}", {
                    "metadata": {
                        **(existing.get("metadata") or {}),
                        "constellation_ids": ids,
                    },
                })
                logger.info("[ingest] Tagged %s with constellation %s", arxiv_id, constellation_id)
            else:
                logger.info("[ingest] %s already tagged with %s", arxiv_id, constellation_id)
        else:
            logger.warning("[ingest] No Supermemory doc found for %s to tag", arxiv_id)
    except Exception as e:
        logger.error("[ingest] Failed to tag constellation for %s: %s", arxiv_id, e)
