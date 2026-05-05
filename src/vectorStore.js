const { Pool } = require('pg');
const { getConfig } = require('./config');

const VECTOR_DIMENSIONS = 1536;
let _pool = null;

function quoteIdent(name, label) {
  const s = String(name || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    throw new Error(`${label} 格式不合法：${name}`);
  }
  return `"${s}"`;
}

function getQualifiedNames() {
  const { supabaseSchema, supabaseChunksTable, supabaseMatchFunction } = getConfig();
  const schema = quoteIdent(supabaseSchema, 'SUPABASE_DB_SCHEMA');
  const table = quoteIdent(supabaseChunksTable, 'SUPABASE_CHUNKS_TABLE');
  const fn = quoteIdent(supabaseMatchFunction, 'SUPABASE_MATCH_FUNCTION');
  return {
    schema,
    table,
    fn,
    fullTable: `${schema}.${table}`,
    fullFunction: `${schema}.${fn}`,
    embeddingIndex: `${supabaseChunksTable}_embedding_idx`,
    bookIdIndex: `${supabaseChunksTable}_book_id_idx`,
  };
}

function getPool() {
  if (_pool) return _pool;
  const { supabaseDbUrl, supabaseDbSsl } = getConfig();
  if (!supabaseDbUrl) {
    throw new Error('SUPABASE_DB_URL 未設定');
  }
  _pool = new Pool({
    connectionString: supabaseDbUrl,
    ssl: supabaseDbSsl ? { rejectUnauthorized: false } : false,
    max: 5,
  });
  return _pool;
}

function toVectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== VECTOR_DIMENSIONS) {
    throw new Error(`embedding 維度需為 ${VECTOR_DIMENSIONS}`);
  }
  const normalized = vector.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('embedding 含非數字值');
    return n;
  });
  return `[${normalized.join(',')}]`;
}

async function ensureVectorStore() {
  const pool = getPool();
  const { schema, fullTable, fullFunction, embeddingIndex, bookIdIndex } = getQualifiedNames();
  const embeddingIndexQuoted = quoteIdent(embeddingIndex, 'embedding index');
  const bookIdIndexQuoted = quoteIdent(bookIdIndex, 'book_id index');
  await pool.query(`create extension if not exists vector;`);
  await pool.query(`create schema if not exists ${schema};`);
  await pool.query(`
    create table if not exists ${fullTable} (
      id text primary key,
      book_id text not null,
      book_name text,
      day int not null,
      title text,
      chunk_index int not null,
      text text not null,
      embedding vector(${VECTOR_DIMENSIONS}) not null,
      updated_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    create index if not exists ${embeddingIndexQuoted}
      on ${fullTable} using ivfflat (embedding vector_cosine_ops)
      with (lists = 100);
  `);
  await pool.query(`
    create index if not exists ${bookIdIndexQuoted}
      on ${fullTable} (book_id);
  `);
  await pool.query(`
    create or replace function ${fullFunction}(
      query_embedding vector(${VECTOR_DIMENSIONS}),
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
    language sql
    stable
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
      from ${fullTable}
      where embedding is not null
        and (filter_book_id is null or ${fullTable}.book_id = filter_book_id)
      order by embedding <=> query_embedding asc
      limit greatest(match_count, 1);
    $$;
  `);
}

async function searchChunks(queryVector, opts = {}) {
  const pool = getPool();
  const { fullFunction } = getQualifiedNames();
  const matchCount = opts.matchCount ?? 5;
  const filterBookId = opts.filterBookId || null;
  const res = await pool.query(
    `select * from ${fullFunction}($1::vector, $2::int, $3::text)`,
    [toVectorLiteral(queryVector), matchCount, filterBookId]
  );
  return (res.rows || []).map((row) => ({
    id: row.id,
    score: Number(row.score || 0),
    book_id: row.book_id,
    book_name: row.book_name,
    day: row.day,
    title: row.title,
    chunk_index: row.chunk_index,
    text: row.text,
  }));
}

async function upsertChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return;
  const pool = getPool();
  const { fullTable } = getQualifiedNames();
  const values = [];
  const params = [];
  let idx = 1;
  for (const chunk of chunks) {
    values.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::vector, now())`
    );
    params.push(
      chunk.id,
      chunk.book_id,
      chunk.book_name || null,
      chunk.day,
      chunk.title || null,
      chunk.chunk_index,
      chunk.text,
      toVectorLiteral(chunk.embedding)
    );
  }
  await pool.query(
    `
      insert into ${fullTable} (
        id, book_id, book_name, day, title, chunk_index, text, embedding, updated_at
      ) values
      ${values.join(',\n')}
      on conflict (id) do update set
        book_id = excluded.book_id,
        book_name = excluded.book_name,
        day = excluded.day,
        title = excluded.title,
        chunk_index = excluded.chunk_index,
        text = excluded.text,
        embedding = excluded.embedding,
        updated_at = now();
    `,
    params
  );
}

async function listChunkIds() {
  const pool = getPool();
  const { fullTable } = getQualifiedNames();
  const res = await pool.query(`select id from ${fullTable}`);
  return (res.rows || []).map((row) => String(row.id));
}

async function deleteChunksById(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const pool = getPool();
  const { fullTable } = getQualifiedNames();
  await pool.query(`delete from ${fullTable} where id = any($1::text[])`, [ids]);
}

module.exports = {
  VECTOR_DIMENSIONS,
  ensureVectorStore,
  searchChunks,
  upsertChunks,
  listChunkIds,
  deleteChunksById,
};
