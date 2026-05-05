# Zeabur + Supabase 部署說明

本專案目前的建議部署方式為：

- `Zeabur`：承載 Node/Express API
- `Supabase pgvector`：承載整本手冊 QA 向量資料
- `Ragic`：承載手冊內容、訂閱、閱讀紀錄、對話紀錄
- `OpenAI`：embedding 與回答生成

## 一、先準備 Supabase

1. 在 Supabase 建立專案。
2. 到 SQL Editor 執行 [supabase-schema.sql](./supabase-schema.sql)。
3. 到 `Project Settings -> Database` 取得 **Direct connection** 的 Postgres 連線字串。

建議使用 `SSL` 連線，因此 Zeabur 上的 `SUPABASE_DB_SSL` 保持預設即可。

## 二、準備 Zeabur 服務

1. 在 Zeabur 建立新的 Service。
2. 直接連接此 Git repository。
3. 使用 repo 內的 [Dockerfile](../Dockerfile) 部署。

本專案會使用：

- `npm install`
- `npm start`
- 平台注入的 `PORT`

## 三、設定環境變數

至少需要設定：

```bash
RAGIC_BASE_URL=https://ap13.ragic.com/asiahope
RAGIC_API_KEY=你的Ragic金鑰
RAGIC_BASIC_RAW=true

OPENAI_API_KEY=你的OpenAI金鑰
OPENAI_EMBED_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini

SUPABASE_DB_URL=你的SupabaseDirectConnection
SUPABASE_DB_SCHEMA=public
SUPABASE_CHUNKS_TABLE=prayer_chunks
SUPABASE_MATCH_FUNCTION=match_prayer_chunks
SUPABASE_DB_SSL=true

SYNC_VECTOR_SECRET=自行產生的長隨機字串
```

若你已沿用舊排程，也可暫時保留 `SYNC_QDRANT_SECRET`，程式仍會相容讀取。

## 四、首次同步向量資料

部署成功後，需要先把 `Ragic gpt/3` 的內容同步到 Supabase pgvector。

方式一：本機執行

```bash
node scripts/sync-ragic-to-qdrant.js
```

方式二：直接打內部同步端點

```bash
curl -X POST "https://你的Zeabur網址/internal/sync-ragic-to-qdrant" \
  -H "Authorization: Bearer 你的SYNC_VECTOR_SECRET"
```

## 五、驗證服務

先確認基礎端點：

```bash
./scripts/health-check.sh https://你的Zeabur網址
```

再確認實際業務流程：

```bash
curl "https://你的Zeabur網址/email/books?email=訂閱email"
curl "https://你的Zeabur網址/content?email=訂閱email&book_id=手冊ID"
curl "https://你的Zeabur網址/progress?email=訂閱email"
```

最後再測試 QA：

```bash
curl "https://你的Zeabur網址/qa?email=訂閱email&question=請總結這本手冊的重點"
```

## 六、切換 GPTs Action

1. 先保留現有 Cloud Run 運作。
2. 確認 Zeabur 服務正常後，將 `openapi.yaml` 的 `servers.url` 改成 Zeabur 網址。
3. 在 GPTs Actions 內同步更新 Server URL。
4. 用真實測試帳號再做一次 smoke test。
5. 穩定後才停用舊 Cloud Run。

## 七、排程建議

遷移期間只能保留一個排程來源，不要同時讓：

- Cloud Scheduler
- Zeabur / n8n / 外部 cron

一起打 `POST /internal/sync-ragic-to-qdrant`。

若你已在 Zeabur 部署 `n8n`，最簡單的方式是用 `n8n Cron -> HTTP Request`：

- Method: `POST`
- URL: `https://你的Zeabur網址/internal/sync-ragic-to-qdrant`
- Header: `Authorization: Bearer 你的SYNC_VECTOR_SECRET`

## 八、Legacy GCP 回滾

如果 Zeabur 切換後有異常：

1. 將 GPTs Action URL 改回 Cloud Run
2. 關閉 Zeabur / n8n 的同步排程
3. 恢復 Cloud Scheduler

舊版 Cloud Run 相關步驟仍保留在 [GCP_SETUP.md](./GCP_SETUP.md) 供 rollback 參考。
