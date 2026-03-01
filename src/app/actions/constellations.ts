"use server";

import { supabase } from "@/lib/supabase";
import {
  normalizePaperTitle,
  normalizePaperUrl,
  normalizeRequiredTitle,
  reconcilePaperTitleRecords,
} from "@/lib/papers";

export interface ConstellationRow {
  id: string;
  title: string;
  name: string;
  topic: string;
  paper_title: string | null;
  paper_url: string | null;
  created_at: string;
  updated_at: string;
  graph_data: SerializedGraph | null;
}

export interface SavedConstellation {
  id: string;
  name: string;
  topic: string;
  paperTitle?: string;
  paperUrl?: string;
  createdAt: number;
}

export interface SerializedNode {
  id: number;
  label: string;
  depth: number;
  parentId: number | null;
  angle: number;
  x: number;
  y: number;
  children: number[];
  messages: { role: "user" | "ai"; text: string; icon?: "bookOpen" | "search" }[];
  paperTitle: string | null;
  paperUrl: string | null;
  isFrontier?: boolean;
  frontierReason?: string | null;
}

export interface SerializedGraph {
  nextId: number;
  nodes: SerializedNode[];
}

function rowToConstellation(row: ConstellationRow): SavedConstellation {
  const normalizedName = normalizeRequiredTitle(row.name || row.title, row.name || row.title || "Untitled");
  const normalizedTopic = normalizeRequiredTitle(row.topic, normalizedName);

  return {
    id: row.id,
    name: normalizedName,
    topic: normalizedTopic,
    paperTitle: normalizePaperTitle(row.paper_title) ?? undefined,
    paperUrl: normalizePaperUrl(row.paper_url) ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function sanitizeGraph(
  graph: SerializedGraph | null,
  rootOverride?: { paperTitle?: string | null; paperUrl?: string | null; rootLabel?: string | null }
): SerializedGraph | null {
  if (!graph) return null;

  const originalNodes = graph.nodes;
  const normalizedRootLabel = rootOverride?.rootLabel
    ? normalizeRequiredTitle(rootOverride.rootLabel, rootOverride.rootLabel)
    : null;

  const normalizedNodes = reconcilePaperTitleRecords(originalNodes, rootOverride).map((node, index) => {
    const originalNode = originalNodes[index];
    const originalLabel = originalNode?.label ?? node.label;
    const originalPaperTitle = normalizePaperTitle(originalNode?.paperTitle);
    const normalizedLabel = normalizePaperTitle(originalLabel);
    const shouldSyncLabel =
      node.paperTitle &&
      (node.depth > 0 ||
        (normalizedLabel &&
          (normalizedLabel === originalPaperTitle || normalizedLabel === node.paperTitle)));

    return {
      ...node,
      label:
        node.depth === 0 && normalizedRootLabel
          ? normalizedRootLabel
          : shouldSyncLabel && node.paperTitle
            ? node.paperTitle
            : originalLabel,
    };
  });

  return {
    ...graph,
    nodes: normalizedNodes,
  };
}

export async function fetchConstellations(): Promise<SavedConstellation[]> {
  const { data, error } = await supabase
    .from("constellations")
    .select("id, title, name, topic, paper_title, paper_url, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[constellations] fetch error:", error);
    return [];
  }

  return (data as ConstellationRow[]).map(rowToConstellation);
}

/** Collect all paper titles and labels from a graph for search. */
function graphSearchableStrings(row: {
  name?: string | null;
  topic?: string | null;
  paper_title?: string | null;
  graph_data?: SerializedGraph | null;
}): string[] {
  const out: string[] = [];
  if (row.name) out.push(row.name.toLowerCase());
  if (row.topic) out.push(row.topic.toLowerCase());
  if (row.paper_title) out.push(row.paper_title.toLowerCase());
  const graph = row.graph_data;
  if (graph?.nodes) {
    for (const node of graph.nodes) {
      if (node.paperTitle) out.push(node.paperTitle.toLowerCase());
      if (node.label) out.push(node.label.toLowerCase());
    }
  }
  return out;
}

/** Search saved constellations by name, topic, or any paper in the graph (case-insensitive). */
export async function searchConstellations(query: string): Promise<SavedConstellation[]> {
  const q = query.trim().toLowerCase();
  const { data, error } = await supabase
    .from("constellations")
    .select("id, title, name, topic, paper_title, paper_url, created_at, updated_at, graph_data")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[constellations] search fetch error:", error);
    return [];
  }

  const rows = data as ConstellationRow[];
  const list = rows.map(rowToConstellation);

  if (!q) return list;

  return list.filter((c, i) => {
    const row = rows[i];
    if (!row) return false;
    const searchable = graphSearchableStrings(row);
    return searchable.some((s) => s.includes(q));
  });
}

export async function upsertConstellation(c: SavedConstellation): Promise<void> {
  const now = new Date(c.createdAt).toISOString();
  const name = normalizeRequiredTitle(c.name, c.name || "Untitled");
  const topic = normalizeRequiredTitle(c.topic, name);
  const paperTitle = normalizePaperTitle(c.paperTitle);
  const paperUrl = normalizePaperUrl(c.paperUrl);

  const { error } = await supabase.from("constellations").upsert(
    {
      id: c.id,
      title: name,
      name,
      topic,
      paper_title: paperTitle,
      paper_url: paperUrl,
      created_at: now,
      updated_at: now,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("[constellations] upsert error:", error);
  }
}

export async function renameConstellation(id: string, name: string): Promise<void> {
  const normalizedName = normalizeRequiredTitle(name, name || "Untitled");

  const { error } = await supabase
    .from("constellations")
    .update({
      name: normalizedName,
      title: normalizedName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[constellations] rename error:", error);
  }
}

export async function deleteConstellation(id: string): Promise<void> {
  const { error } = await supabase
    .from("constellations")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[constellations] delete error:", error);
  }
}

export async function saveGraphData(constellationId: string, graph: SerializedGraph): Promise<void> {
  const normalizedGraph = sanitizeGraph(graph);
  const { error } = await supabase
    .from("constellations")
    .update({ graph_data: normalizedGraph, updated_at: new Date().toISOString() })
    .eq("id", constellationId);

  if (error) {
    console.error("[constellations] saveGraphData error:", error);
  }
}

export async function loadGraphData(constellationId: string): Promise<SerializedGraph | null> {
  const { data, error } = await supabase
    .from("constellations")
    .select("graph_data, paper_title, paper_url, title, name")
    .eq("id", constellationId)
    .single();

  if (error) {
    console.error("[constellations] loadGraphData error:", error);
    return null;
  }

  const row = data as {
    graph_data: SerializedGraph | null;
    paper_title: string | null;
    paper_url: string | null;
    title: string | null;
    name: string | null;
  };

  return sanitizeGraph(row.graph_data, {
    paperTitle: row.paper_title,
    paperUrl: row.paper_url,
    rootLabel: row.paper_title || row.name || row.title,
  });
}
