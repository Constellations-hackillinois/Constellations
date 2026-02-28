export interface Constellation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: string;
  constellation_id: string;
  parent_article_id: string | null;
  title: string;
  url: string;
  summary: string | null;
  depth: number;
  created_at: string;
}
