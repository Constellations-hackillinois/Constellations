"""GET /status/{arxiv_id} - check pipeline processing status."""

from fastapi import APIRouter
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_ANON_KEY

router = APIRouter()


@router.get("/status/{arxiv_id:path}")
async def get_status(arxiv_id: str):
    """Check the processing status of a paper."""
    sb = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    result = (
        sb.table("paper_documents")
        .select("arxiv_id, status, error_message, pdf_pages, word_count, created_at, updated_at")
        .eq("arxiv_id", arxiv_id)
        .maybe_single()
        .execute()
    )

    if not result.data:
        return {"found": False, "arxiv_id": arxiv_id}

    return {"found": True, **result.data}
