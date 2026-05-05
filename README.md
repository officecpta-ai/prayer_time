# 第一階門訓課程助理 API

第一階門訓課程助理 GPTs 中介 API，串接 `Ragic`、`OpenAI` 與 `Supabase pgvector`：提供手冊清單、每日內容、閱讀進度，以及整本手冊 QA。

## 架構

- **GPTs** → Action → 本 API（Zeabur）→ `Ragic`
- 本 API → `OpenAI`（embedding + chat）
- 本 API → `Supabase pgvector`（QA 向量搜尋）
- 認證：query 參數 `email`，用於訂閱與進度

## 端點

| 端點 | 方法 | 認證 | 說明 |
|------|------|------|------|
| `/books` | GET | 選填 | 手冊清單 |
| `/email/books` | GET | 必填 | 依 email 查詢已訂閱手冊 |
| `/content` | GET | 必填 | `book_id`（必填）、`day`（選填，1–31，預設今天）；未訂閱仍回傳 200（`subscribed:false` + `error`） |
| `/progress` | GET | 必填 | 當前使用者閱讀進度（由閱讀紀錄推導） |
| `/reading-record/last-day` | GET | 必填 | 某一本手冊上次閱讀天數與下一天 |
| `/titles` | GET | 必填 | 1–31 天標題清單 |
| `/qa` | GET / POST | 必填 | 整本手冊 QA（RAG） |
| `/companion/log` | POST | 必填 | 陪談／靈修紀錄寫入 |
| `/internal/sync-ragic-to-qdrant` | POST | secret | 內部同步端點，沿用舊名稱，實際同步到 Supabase |

## 本地開發

1. 複製 `.env.example` 為 `.env`
2. 至少填入：
   - `RAGIC_API_KEY`
   - `OPENAI_API_KEY`
   - `SUPABASE_DB_URL`
3. 安裝依賴並啟動：

```bash
npm install
npm run dev
```

預設埠號為 `8080`。

## 本地測試

在另一個終端機執行：

```bash
# 根路徑（應回傳 {"service":"第一階門訓課程助理 API","status":"ok"}）
curl http://localhost:8080/

# 手冊清單（需 .env 有 RAGIC_API_KEY）
curl http://localhost:8080/books

# 已訂閱書單（需 email）
curl "http://localhost:8080/email/books?email=訂閱email"

# 每日內容（會寫入閱讀紀錄）
curl "http://localhost:8080/content?email=訂閱email&book_id=手冊ID"

# 閱讀進度（需 email）
curl "http://localhost:8080/progress?email=訂閱email"
```

## Zeabur + Supabase 部署

完整步驟請看 [docs/ZEABUR_SUPABASE_SETUP.md](docs/ZEABUR_SUPABASE_SETUP.md)。

重點如下：

1. 在 Supabase 執行 [docs/supabase-schema.sql](docs/supabase-schema.sql)
2. 在 Zeabur 以本 repo 的 [Dockerfile](Dockerfile) 建立服務
3. 設定必要 env / secrets：
   - `RAGIC_BASE_URL`
   - `RAGIC_API_KEY`
   - `RAGIC_API_KEY_IN_QUERY`
   - `RAGIC_BASIC_RAW`
   - `OPENAI_API_KEY`
   - `OPENAI_EMBED_MODEL`
   - `OPENAI_CHAT_MODEL`
   - `SUPABASE_DB_URL`
   - `SUPABASE_DB_SCHEMA`
   - `SUPABASE_CHUNKS_TABLE`
   - `SUPABASE_MATCH_FUNCTION`
   - `SUPABASE_DB_SSL`
   - `SYNC_VECTOR_SECRET`
4. 部署完成後，用 `./scripts/health-check.sh https://你的Zeabur網址` 驗證
5. 再將 `openapi.yaml` 與 GPTs Action 的 Server URL 更新為 Zeabur 網址

## 向量同步

同步入口沿用既有名稱：

```bash
node scripts/sync-ragic-to-qdrant.js
```

或由排程觸發：

```bash
curl -X POST "https://你的服務網址/internal/sync-ragic-to-qdrant" \
  -H "Authorization: Bearer 你的SYNC_VECTOR_SECRET"
```

這個端點會：

- 從 `Ragic gpt/3` 拉整本手冊內容
- 分 chunk
- 用 `OpenAI` 產生 embedding
- upsert 到 `Supabase pgvector`
- 刪除已不存在的 orphan chunks

## 健康檢查

```bash
./scripts/health-check.sh https://你的服務網址
```

通過時會印出 `/` 與 `/books` 的 HTTP 狀態碼，且 exit code 為 `0`；未通過為 `1`，可給 CI 使用。

## Ragic 表單對應

- `gpt/5`：禱告手冊清單（`book_id`, `book_name`）
- `gpt/3`：禱告手冊內容（`book_id`, `book_name`, `day`, `title`, `content`）
- `gpt/9`：Wix 訂閱資料（`name`, `Email`, `mobile`, `course_name`, `price_amount`, `start_date`, `end_date`, `orderNumbe`, `ticketNumber`）；驗證使用 Email 與起訖日
- `gpt/7`：閱讀紀錄（`user_email`, `book_id`, `book_name`, `reading_day`, `read_time`）
- `gpt/10`：對話／陪談紀錄

## GPTs 設定要點

- 匯入 `openapi.yaml`
- Server URL 改填 Zeabur 網址（切換期間可保留 Cloud Run 作回滾）
- **Actions 驗證**：選「無」或 API Key（本 API 使用 query 參數 `email` 驗證）
- Instructions：未訂閱時僅回覆尚未訂閱，不提供註冊連結

## Legacy GCP

若仍需 Cloud Run 回滾或比對舊流程，可參考 [docs/GCP_SETUP.md](docs/GCP_SETUP.md)。該文件現在僅作 legacy / rollback 參考，不再是主要部署方式。
