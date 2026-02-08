# prayer-time-line-api

獨立 Cloud Run 服務（與既有 GPTs API 並行），用於支援 LINE OA：

- 使用者識別：`line_user_id = event.source.userId`（不使用 email、不導入 LINE Login）
- Ragic：
  - 訂閱表 `gpt/4`：用 `line_user_id + book_id + is_active(Yes)` 判斷訂閱
  - 閱讀紀錄表 `gpt/7`：每次閱讀寫入一筆（台灣時區 `read_time`）
    - 選用：若要一併寫入 LINE display name，請在 `gpt/7` 新增欄位（例如 `line_display_name` / `display_name`），並設定 `RAGIC_READING_RECORD_FIELD_LINE_DISPLAY_NAME`
- LINE 回覆策略（Hybrid）：
  - 組 `fullText = title + content`，把 `[br][/br]` 換成換行
  - `fullText.length <= 3000`：先嘗試用 LINE reply 一則文字訊息（不切段）
    - 若 reply 失敗：fallback 回 web view 連結
  - `fullText.length > 3000`：直接回 web view 連結
  - 不使用 Push message
- Web view：
  - `GET /view?u=<base64url(line_user_id)>&book_id=...&day=...&exp=...&sig=...`
  - `exp` 有效期 15 分鐘（Unix seconds）
  - `sig = base64url(HMAC_SHA256(VIEW_LINK_SECRET, u|book_id|day|exp))`
  - `/view` 驗證後檢查訂閱、抓內容、回手機友善 HTML；成功回傳後寫入 `gpt/7` 閱讀紀錄

## 整本手冊 QA（RAG）

本服務支援在使用者讀完內容後，以自然語言提問「整本手冊」相關問題（不貼原文，只做解釋）。

架構：
- Ragic `gpt/3` → 拆 chunk → OpenAI embeddings（`text-embedding-3-small` 1536 維）→ Firestore + Vertex AI Vector Search
- 使用者提問 → embeddings → Vector Search 找相似 chunk → OpenAI (`gpt-4.1-mini`) 生成「解釋型」回答（不逐字引用）

初始化同步（本機執行一次即可，之後可排程增量同步）：

1) 先完成 Vertex/Firestore 設定與環境變數（見 `.env.example`）
2) 執行：

```bash
./scripts/sync-ragic-to-vector.js
```

## 快速開始（本機）

1. 進入資料夾：`cd prayer-time-line-api`
2. 複製環境檔：`cp .env.example .env`，填好：
   - `RAGIC_API_KEY`
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `VIEW_LINK_SECRET`
3. 安裝與啟動：
   - `npm install`
   - `npm run dev`

## 本機測試：curl 模擬 LINE webhook（含簽章）

LINE 的 `X-Line-Signature` 需使用「原始 request body」計算：

```bash
export LINE_CHANNEL_SECRET='你的channelSecret'

RAW='{"destination":"xxxxxxxxxx","events":[{"type":"message","message":{"type":"text","id":"1","text":"/books"},"timestamp":0,"source":{"type":"user","userId":"Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},"replyToken":"00000000000000000000000000000000","mode":"active"}]}'

SIG=$(printf '%s' "$RAW" | openssl dgst -sha256 -hmac "$LINE_CHANNEL_SECRET" -binary | openssl base64 | tr -d '\n')

curl -i http://localhost:8080/line/webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: $SIG" \
  --data "$RAW"
```

注意：
- 測試用的 `replyToken` 不會真的回覆成功（這是正常的），但你可以先用它確認 webhook 驗簽與流程是否運作。
- 請勿在終端機或 log 貼上真實的 `userId`、token、secret。

## 產生 /view 測試連結（本機）

```bash
export LINE_USER_ID='Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
export BOOK_ID='your-book-id'
export DAY='1'
export VIEW_LINK_SECRET='你的VIEW_LINK_SECRET'

node -e '
const crypto=require("crypto");
const b64url=(buf)=>Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const lineUserId=process.env.LINE_USER_ID;
const u=b64url(Buffer.from(lineUserId,"utf8"));
const bookId=process.env.BOOK_ID;
const day=process.env.DAY;
const exp=Math.floor(Date.now()/1000)+15*60;
const msg=[u,bookId,day,String(exp)].join("|");
const sig=b64url(crypto.createHmac("sha256", process.env.VIEW_LINK_SECRET).update(msg).digest());
console.log(`http://localhost:8080/view?u=${encodeURIComponent(u)}&book_id=${encodeURIComponent(bookId)}&day=${encodeURIComponent(day)}&exp=${exp}&sig=${encodeURIComponent(sig)}`);
'
```

## 部署到 Cloud Run

在 `prayer-time-line-api/` 下執行：

```bash
export GCP_PROJECT_ID=你的專案ID
export GCP_REGION=asia-northeast1
# 建立 / 更新 Secrets（會提示你輸入，不回顯）
./scripts/create-secrets.sh
./scripts/deploy.sh
```

部署後：
- 設定 LINE Developer Console 的 Webhook URL 指向：`https://<CloudRunURL>/line/webhook`
- 建議把 `PUBLIC_BASE_URL` 設為 Cloud Run 服務網址（產生 /view 連結會更穩）

