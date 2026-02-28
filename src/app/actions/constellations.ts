"use server";

import { supabase } from "@/lib/supabase";

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
}

export interface SerializedGraph {
  nextId: number;
  nodes: SerializedNode[];
}

function rowToConstellation(row: ConstellationRow): SavedConstellation {
  return {
    id: row.id,
    name: row.name || row.title,
    topic: row.topic,
    paperTitle: row.paper_title ?? undefined,
    paperUrl: row.paper_url ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
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

export async function upsertConstellation(c: SavedConstellation): Promise<void> {
  const now = new Date(c.createdAt).toISOString();
  const { error } = await supabase.from("constellations").upsert(
    {
      id: c.id,
      title: c.name,
      name: c.name,
      topic: c.topic,
      paper_title: c.paperTitle ?? null,
      paper_url: c.paperUrl ?? null,
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
  const { data: existing } = await supabase
    .from("constellations")
    .select("graph_data")
    .eq("id", id)
    .single();

  let graphPatch: SerializedGraph | undefined;
  const graph = (existing as { graph_data: SerializedGraph | null } | null)?.graph_data;
  if (graph && graph.nodes) {
    const origin = graph.nodes.find((n) => n.depth === 0);
    if (origin) {
      origin.label = name;
      origin.paperTitle = name;
      graphPatch = graph;
    }
  }

  const { error } = await supabase
    .from("constellations")
    .update({
      name,
      title: name,
      updated_at: new Date().toISOString(),
      ...(graphPatch ? { graph_data: graphPatch } : {}),
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
  const { error } = await supabase
    .from("constellations")
    .update({ graph_data: graph, updated_at: new Date().toISOString() })
    .eq("id", constellationId);

  if (error) {
    console.error("[constellations] saveGraphData error:", error);
  }
}

export async function loadGraphData(constellationId: string): Promise<SerializedGraph | null> {
  const { data, error } = await supabase
    .from("constellations")
    .select("graph_data")
    .eq("id", constellationId)
    .single();

  if (error) {
    console.error("[constellations] loadGraphData error:", error);
    return null;
  }

  return (data as { graph_data: SerializedGraph | null }).graph_data;
}
