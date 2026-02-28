#!/usr/bin/env python3
"""Normalize stored paper titles across constellations and paper_documents."""

from __future__ import annotations

import argparse
import json
import os
import sys
from copy import deepcopy
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT / "pipeline"))

from utils.titles import canonical_paper_key, normalize_paper_title, normalize_paper_url  # noqa: E402


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise SystemExit(
            "Missing Supabase credentials. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, "
            "and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY."
        )
    return create_client(url, key)


def normalize_required_title(value: str | None, fallback: str = "Untitled") -> str:
    normalized = normalize_paper_title(value)
    if normalized:
        return normalized

    trimmed = (value or "").strip()
    if trimmed and not trimmed.startswith("["):
        return trimmed

    return fallback


def should_sync_label_to_paper_title(label: str | None, next_paper_title: str | None, previous_paper_title: str | None, depth: int | None) -> bool:
    if not next_paper_title:
        return False
    if (depth or 0) > 0:
        return True

    normalized_label = normalize_paper_title(label)
    normalized_previous_title = normalize_paper_title(previous_paper_title)
    normalized_next_title = normalize_paper_title(next_paper_title)
    return bool(
        normalized_label
        and (
            (normalized_previous_title and normalized_label == normalized_previous_title)
            or (normalized_next_title and normalized_label == normalized_next_title)
        )
    )


def normalize_graph(
    graph: dict | None,
    root_paper_title: str | None,
    root_paper_url: str | None,
    root_label: str | None,
) -> tuple[dict | None, dict]:
    stats = {
        "graph_changed": False,
        "graph_nodes_changed": 0,
        "titles_cleared": 0,
        "conflicts_coalesced": 0,
        "label_changes": 0,
    }
    if not graph or not isinstance(graph, dict):
        return graph, stats

    original_nodes = graph.get("nodes")
    if not isinstance(original_nodes, list):
        return graph, stats

    normalized_nodes = [deepcopy(node) for node in original_nodes]
    root_override_title = normalize_paper_title(root_paper_title)
    root_override_url = normalize_paper_url(root_paper_url)
    root_override_key = canonical_paper_key(root_override_url)
    normalized_root_label = normalize_required_title(root_label, root_label or "Untitled") if root_label else None

    title_by_key: dict[str, str] = {}
    raw_titles_by_key: dict[str, set[str]] = {}

    if root_override_title and root_override_key:
        title_by_key[root_override_key] = root_override_title

    for original_node, node in zip(original_nodes, normalized_nodes):
        previous_title = original_node.get("paperTitle")
        next_title = normalize_paper_title(previous_title)
        if previous_title is not None and str(previous_title).strip() and next_title is None:
            stats["titles_cleared"] += 1

        node["paperTitle"] = next_title
        node["paperUrl"] = normalize_paper_url(original_node.get("paperUrl"))

        key = canonical_paper_key(node.get("paperUrl"))
        if key:
            raw_titles = raw_titles_by_key.setdefault(key, set())
            if next_title:
                raw_titles.add(next_title)
                if key not in title_by_key:
                    title_by_key[key] = next_title

    stats["conflicts_coalesced"] = sum(1 for titles in raw_titles_by_key.values() if len(titles) > 1)

    for original_node, node in zip(original_nodes, normalized_nodes):
        if node.get("depth") == 0 and root_override_url and not node.get("paperUrl"):
            node["paperUrl"] = root_override_url

        key = canonical_paper_key(node.get("paperUrl"))
        if (
            node.get("depth") == 0
            and root_override_title
            and (not key or not root_override_key or key == root_override_key or not node.get("paperTitle"))
        ):
            node["paperTitle"] = root_override_title

        canonical_key = canonical_paper_key(node.get("paperUrl"))
        if canonical_key and title_by_key.get(canonical_key):
            node["paperTitle"] = title_by_key[canonical_key]

        original_label = original_node.get("label")
        if node.get("depth") == 0 and normalized_root_label:
            node["label"] = normalized_root_label
            if node["label"] != original_label:
                stats["label_changes"] += 1
        elif should_sync_label_to_paper_title(
            original_label,
            node.get("paperTitle"),
            original_node.get("paperTitle"),
            node.get("depth"),
        ):
            node["label"] = node.get("paperTitle")
            if node["label"] != original_label:
                stats["label_changes"] += 1
        else:
            node["label"] = original_label

        if (
            node.get("paperTitle") != original_node.get("paperTitle")
            or node.get("paperUrl") != original_node.get("paperUrl")
            or node.get("label") != original_node.get("label")
        ):
            stats["graph_nodes_changed"] += 1

    normalized_graph = {
        **graph,
        "nodes": normalized_nodes,
    }
    stats["graph_changed"] = normalized_graph != graph
    return normalized_graph, stats


def process_constellations(supabase, apply_changes: bool, batch_size: int, stats: dict) -> None:
    offset = 0
    while True:
        result = (
            supabase.table("constellations")
            .select("id, title, name, topic, paper_title, paper_url, graph_data")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return

        for row in rows:
            stats["constellations_scanned"] += 1
            normalized_name = normalize_required_title(row.get("name") or row.get("title"), row.get("name") or row.get("title") or "Untitled")
            normalized_topic = normalize_required_title(row.get("topic"), normalized_name)
            normalized_row_title = normalize_paper_title(row.get("paper_title"))
            if row.get("paper_title") is not None and str(row.get("paper_title")).strip() and normalized_row_title is None:
                stats["titles_cleared"] += 1

            normalized_graph, graph_stats = normalize_graph(
                row.get("graph_data"),
                normalized_row_title,
                row.get("paper_url"),
                normalized_name,
            )

            stats["graph_nodes_changed"] += graph_stats["graph_nodes_changed"]
            stats["graphs_changed"] += int(graph_stats["graph_changed"])
            stats["conflicts_coalesced"] += graph_stats["conflicts_coalesced"]
            stats["label_changes"] += graph_stats["label_changes"]
            stats["titles_cleared"] += graph_stats["titles_cleared"]

            payload = {}
            if normalized_name != row.get("name"):
                payload["name"] = normalized_name
                stats["constellation_name_fields_changed"] += 1
            if normalized_name != row.get("title"):
                payload["title"] = normalized_name
                stats["constellation_title_fields_changed"] += 1
            if normalized_topic != row.get("topic"):
                payload["topic"] = normalized_topic
                stats["constellation_topic_fields_changed"] += 1
            if normalized_row_title != row.get("paper_title"):
                payload["paper_title"] = normalized_row_title
                stats["constellation_row_titles_changed"] += 1
            if normalized_graph != row.get("graph_data"):
                payload["graph_data"] = normalized_graph

            if payload:
                stats["constellations_changed"] += 1
                if apply_changes:
                    supabase.table("constellations").update(payload).eq("id", row["id"]).execute()

        offset += len(rows)


def process_paper_documents(supabase, apply_changes: bool, batch_size: int, stats: dict) -> None:
    offset = 0
    while True:
        result = (
            supabase.table("paper_documents")
            .select("id, paper_title")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return

        for row in rows:
            stats["paper_documents_scanned"] += 1
            normalized_title = normalize_paper_title(row.get("paper_title"))
            if row.get("paper_title") is not None and str(row.get("paper_title")).strip() and normalized_title is None:
                stats["titles_cleared"] += 1

            if normalized_title != row.get("paper_title"):
                stats["paper_documents_changed"] += 1
                stats["paper_document_titles_changed"] += 1
                if apply_changes:
                    supabase.table("paper_documents").update({
                        "paper_title": normalized_title,
                    }).eq("id", row["id"]).execute()

        offset += len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write changes back to Supabase.")
    parser.add_argument("--batch-size", type=int, default=200, help="Rows to scan per batch.")
    args = parser.parse_args()

    supabase = get_supabase_client()
    stats = {
        "constellations_scanned": 0,
        "constellations_changed": 0,
        "constellation_name_fields_changed": 0,
        "constellation_row_titles_changed": 0,
        "constellation_title_fields_changed": 0,
        "constellation_topic_fields_changed": 0,
        "graphs_changed": 0,
        "graph_nodes_changed": 0,
        "label_changes": 0,
        "paper_documents_scanned": 0,
        "paper_documents_changed": 0,
        "paper_document_titles_changed": 0,
        "titles_cleared": 0,
        "conflicts_coalesced": 0,
        "mode": "apply" if args.apply else "dry-run",
    }

    process_constellations(supabase, args.apply, args.batch_size, stats)
    process_paper_documents(supabase, args.apply, args.batch_size, stats)

    print(json.dumps(stats, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
