-- Constellations schema

create table constellations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  constellation_id uuid not null references constellations(id) on delete cascade,
  parent_article_id uuid references articles(id) on delete set null,
  title text not null,
  url text not null,
  summary text,
  depth int not null default 0,
  created_at timestamptz not null default now()
);

create index articles_constellation_idx on articles(constellation_id);
create index articles_parent_idx on articles(parent_article_id);

-- Auto-update updated_at on constellations
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger constellations_updated_at
  before update on constellations
  for each row execute function update_updated_at();

-- Paper processing pipeline
create table paper_documents (
  id uuid primary key default gen_random_uuid(),
  arxiv_id text unique not null,
  paper_url text not null,
  paper_title text,
  status text not null default 'pending',  -- pending|downloading|extracting|converting|densifying|complete|failed
  error_message text,
  raw_text text,
  markdown text,
  densified_markdown text,
  pdf_pages int,
  word_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger paper_documents_updated_at
  before update on paper_documents
  for each row execute function update_updated_at();
