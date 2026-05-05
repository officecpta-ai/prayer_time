-- 第一階門訓課程助理 RAG：Supabase pgvector 表結構
-- 使用方式：
-- 1. 在 Supabase SQL Editor 執行本檔
-- 2. 將專案環境變數設為：
--    SUPABASE_DB_URL=<Direct connection Postgres URL>
--    SUPABASE_DB_SCHEMA=public
--    SUPABASE_CHUNKS_TABLE=prayer_chunks
--    SUPABASE_MATCH_FUNCTION=match_prayer_chunks

create extension if not exists vector;

create table if not exists prayer_chunks (
  id text primary key,
  book_id text not null,
  book_name text,
  day int not null,
  title text,
  chunk_index int not null,
  text text not null,
  embedding vector(1536),
  updated_at timestamptz default now()
);

-- 向量相似度搜尋索引（cosine distance）
create index if not exists prayer_chunks_embedding_idx
  on prayer_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 依 book_id 過濾的索引
create index if not exists prayer_chunks_book_id_idx on prayer_chunks (book_id);

-- RPC：向量相似度搜尋
create or replace function match_prayer_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  filter_book_id text default null
)
returns table (
  id text,
  score double precision,
  book_id text,
  book_name text,
  day int,
  title text,
  chunk_index int,
  text text
)
language sql stable
as $$
  select
    id,
    1 - (embedding <=> query_embedding) as score,
    book_id,
    book_name,
    day,
    title,
    chunk_index,
    text
  from prayer_chunks
  where embedding is not null
    and (filter_book_id is null or prayer_chunks.book_id = filter_book_id)
  order by embedding <=> query_embedding
  limit match_count;
$$;
