# 第一階門訓課程助理 API

第一階門訓課程助理 GPTs 中介 API，串接 Ragic：手冊清單、每日內容、訂閱檢查、閱讀進度。

## 架構

- **GPTs** → Action → 本 API（Cloud Run）→ Ragic API
- 認證：query 參數 `email`，用於訂閱與進度。

## 端點

| 端點 | 方法 | 認證 | 說明 |
|------|------|------|------|
| `/books` | GET | 選填 | 手冊清單 |
| `/content` | GET | 必填 | `book_id`（必填）、`day`（選填，1–31，預設今天）；未訂閱仍回傳 200（`subscribed:false` + `error`） |
| `/progress` | GET | 必填 | 當前使用者閱讀進度（由閱讀紀錄推導） |

## 本地開發

1. 複製 `.env.example` 為 `.env`，填寫 `RAGIC_API_KEY`。
2. `npm install && npm run dev`
3. 埠號預設 8080。

**測試時**：`npm run dev` 會佔用終端機並持續運行。請在**另一個**終端機執行下列指令，不要關閉跑 `npm run dev` 的那個視窗。

## 如何測試

### 本地測試（本機 8080）

1. 在一個終端機執行：`npm run dev`
2. 在**另一個**終端機執行：

```bash
# 根路徑（應回傳 {"service":"第一階門訓課程助理 API","status":"ok"}）
curl http://localhost:8080/

# 手冊清單（需 .env 有 RAGIC_API_KEY）
curl http://localhost:8080/books

# 每日內容（需 email；未訂閱會 403）
curl "http://localhost:8080/content?email=訂閱email&book_id=手冊ID"

# 閱讀進度（需 email）
curl "http://localhost:8080/progress?email=訂閱email"
```

### 部署後測試（Cloud Run）

```bash
# 方式一：指定服務網址
./scripts/health-check.sh https://你的Cloud_Run網址

# 方式二：由 gcloud 取得網址（需已登入且設好 GCP_PROJECT_ID）
export GCP_PROJECT_ID=prayer-time-486401
./scripts/health-check.sh
```

通過時會印出 `/` 與 `/books` 的 HTTP 狀態碼，且 exit code 為 0；未通過為 1，可給 CI 使用。

## 部署（Google Cloud Run）

**完整步驟**請看 [docs/GCP_SETUP.md](docs/GCP_SETUP.md)，包含：gcloud 安裝登入、建立專案、啟用 API、建立 Secret、授權、部署。

**快速部署**（完成 GCP 設定後，在專案根目錄執行）：

```bash
export GCP_PROJECT_ID=prayer-time-486401
./scripts/deploy.sh
```

或手動執行 gcloud（需已建立 `ragic-api-key` Secret 並授權）：

```bash
gcloud run deploy stage1-discipleship-assistant-api --source . --region asia-northeast1 --allow-unauthenticated \
  --set-env-vars "RAGIC_BASE_URL=https://ap13.ragic.com/asiahope,RAGIC_BASIC_RAW=true" \
  --set-secrets "RAGIC_API_KEY=ragic-api-key:latest"
```

部署完成後請將服務網址填到 `openapi.yaml` 的 `servers` 與 GPTs Action。可執行 `./scripts/health-check.sh [服務網址]` 或 `./scripts/health-check.sh`（需已設 `GCP_PROJECT_ID`）做健康檢查。

## Ragic 表單對應

- gpt/5：禱告手冊清單（book_id, book_name）
- gpt/3：禱告手冊內容（book_id, book_name, day, title, content）
- gpt/9：Wix 訂閱資料（name, Email, mobile, course_name, price_amount, start_date, end_date, orderNumbe, ticketNumber）；驗證使用 Email 與起訖日
- gpt/7：閱讀紀錄（user_email, book_id, book_name, reading_day, read_time）。本系統以閱讀紀錄作為唯一來源：每次閱讀新增一筆；閱讀進度（/progress）由最後一次閱讀紀錄推導。

## GPTs 設定要點

- 匯入 `openapi.yaml`，Server URL 填 Cloud Run 網址。
- **Actions 驗證**：選「無」或 API Key（本 API 使用 query 參數 email 驗證）。
- Instructions：未訂閱時僅回覆尚未訂閱，不提供註冊連結。
