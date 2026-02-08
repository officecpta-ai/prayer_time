# 禱告時光 API

禱告時光 GPTs 中介 API，串接 Ragic：手冊清單、每日內容、訂閱檢查、閱讀進度。

## 架構

- **GPTs** → Action（OAuth Google）→ 本 API（Cloud Run）→ Ragic API
- 認證：`Authorization: Bearer <Google OAuth token>`，後端向 Google 驗證並取得 email，用於訂閱與進度。

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
# 根路徑（應回傳 {"service":"禱告時光 API","status":"ok"}）
curl http://localhost:8080/

# 手冊清單（需 .env 有 RAGIC_API_KEY）
curl http://localhost:8080/books

# 每日內容（需 Bearer token；未訂閱會 403）
curl "http://localhost:8080/content?book_id=手冊ID" -H "Authorization: Bearer 你的Google_OAuth_token"

# 閱讀進度（需 Bearer token）
curl http://localhost:8080/progress -H "Authorization: Bearer 你的Google_OAuth_token"
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

### OAuth 代理測試（選用）

若已設定 OAuth 環境變數，可在瀏覽器開啟授權頁確認會導向 Google 登入：

- 授權 URL：`https://你的Cloud_Run網址/oauth/authorize`
- 登入完成後應導回 GPTs 或顯示錯誤頁（依 GPTs 設定）；後端 `/oauth/callback`、`/oauth/token` 由 GPTs 呼叫，一般不需手動測。

## 部署（Google Cloud Run）

**完整步驟**請看 [docs/GCP_SETUP.md](docs/GCP_SETUP.md)，包含：gcloud 安裝登入、建立專案、啟用 API、建立 Secret、授權、部署。

**快速部署**（完成 GCP 設定後，在專案根目錄執行）：

```bash
export GCP_PROJECT_ID=prayer-time-486401
./scripts/deploy.sh
```

若 `.env` 中已設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`PUBLIC_BASE_URL`，部署時會一併帶上 OAuth 變數，無需再單獨執行 `./scripts/update-cloudrun-env.sh`。

或手動執行 gcloud（需已建立 `ragic-api-key` Secret 並授權；OAuth 變數可事後用 `./scripts/update-cloudrun-env.sh` 更新）：

```bash
gcloud run deploy prayer-time-api --source . --region asia-northeast1 --allow-unauthenticated \
  --set-env-vars "RAGIC_BASE_URL=https://ap13.ragic.com/asiahope,RAGIC_BASIC_RAW=true,RAGIC_SUBSCRIPTION_FORM_URL=https://ap13.ragic.com/asiahope/gpt/4" \
  --set-secrets "RAGIC_API_KEY=ragic-api-key:latest"
```

部署完成後請將服務網址填到 `openapi.yaml` 的 `servers` 與 GPTs Action。可執行 `./scripts/health-check.sh [服務網址]` 或 `./scripts/health-check.sh`（需已設 `GCP_PROJECT_ID`）做健康檢查。

## Ragic 表單對應

- gpt/5：禱告手冊清單（book_id, book_name）
- gpt/3：禱告手冊內容（book_id, book_name, day, title, content）
- gpt/4：禱告手冊訂閱（user_email, book_id, is_active）；表單連結供未訂閱使用者填寫
- gpt/7：閱讀紀錄（user_email, book_id, book_name, reading_day, read_time）。本系統以閱讀紀錄作為唯一來源：每次閱讀新增一筆；閱讀進度（/progress）由最後一次閱讀紀錄推導。

## GPTs 設定要點

- 匯入 `openapi.yaml`，Server URL 填 Cloud Run 網址。
- **Actions 驗證**：選 OAuth；為通過「同網域」檢查，授權／權杖 URL 用本 API 的 OAuth 代理：
  - **授權 URL**：`https://你的Cloud_Run網址/oauth/authorize`
  - **權杖 URL**：`https://你的Cloud_Run網址/oauth/token`
  - **範圍**：`email openid profile`
  - 用戶端 ID、用戶端密碼：填 Google Cloud Console 建立的 OAuth 用戶端 ID 與密鑰。
- Cloud Run 需設定環境變數：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`PUBLIC_BASE_URL`（你的 Cloud Run 網址）。建議在專案根目錄 `.env` 中設定，執行 `./scripts/deploy.sh` 時會一併帶上。
- Instructions：未訂閱時依 API 回傳的 `subscription_form_url` 提供連結給使用者。
