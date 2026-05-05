# Google Cloud 設定步驟（第一階門訓課程助理 API，Legacy / Rollback）

本專案目前的主要部署方式已改為 `Zeabur + Supabase`，請優先閱讀 [ZEABUR_SUPABASE_SETUP.md](./ZEABUR_SUPABASE_SETUP.md)。

本文件保留給以下情境使用：

- 舊版 Cloud Run 服務回滾
- Zeabur 切換期間的比對驗證
- 尚未完成最終切換前的暫時維運

---

## 一、安裝 Google Cloud CLI（gcloud）

### macOS 安裝方式

**方式 A：用官方安裝腳本（建議）**

1. 打開**本機終端機**（Terminal.app 或 iTerm，在專案目錄外執行），執行：
   ```bash
   curl https://sdk.cloud.google.com | bash
   ```
2. 依畫面提示操作（若問「是否要修改 shell 設定檔以加入 PATH」，建議選 **Y**）。
3. **重新開啟終端機**，或執行：
   ```bash
   source ~/.zshrc
   ```
   再執行 `gcloud version` 確認安裝成功。

   **非互動安裝**（一路用預設、不問問題）可執行：
   ```bash
   CLOUDSDK_CORE_DISABLE_PROMPTS=1 curl https://sdk.cloud.google.com | bash -s -- --disable-prompts
   ```
   完成後一樣重新開啟終端機或 `source ~/.zshrc`，再執行 `gcloud version`。

**方式 B：用 Homebrew（若已安裝 Homebrew）**

```bash
brew install --cask google-cloud-sdk
```

安裝後重新開啟終端機，執行 `gcloud version` 確認。

**方式 C：手動下載**

1. 前往：https://cloud.google.com/sdk/docs/install
2. 選「macOS」與你的處理器（Intel 或 Apple Silicon）。
3. 下載並執行安裝程式，依指示完成後重新開啟終端機。

### 登入與設定專案

1. **登入**
   ```bash
   gcloud auth login
   ```
   - 瀏覽器會開啟，用你的 Google 帳號登入並授權。

2. **設定預設專案**（建立專案後再做）
   ```bash
   gcloud config set project prayer-time-486401
   ```
   - 專案 ID 可在 [GCP 主控台](https://console.cloud.google.com/) 頂部「選取專案」旁看到。

---

## 二、建立 GCP 專案

1. 打開 [Google Cloud Console](https://console.cloud.google.com/)。
2. 頂部點「選取專案」→「新增專案」。
3. 專案名稱填「第一階門訓課程助理」（或自訂），記下系統產生的**專案 ID**。
4. 點「建立」。
5. 在終端機設定預設專案：
   ```bash
   gcloud config set project prayer-time-486401
   ```

---

## 三、啟用需要的 API

在終端機執行（以下已使用專案 ID `prayer-time-486401`，若不同請替換）：

```bash
gcloud services enable run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com --project=prayer-time-486401
```

- `run.googleapis.com`：Cloud Run
- `secretmanager.googleapis.com`：Secret Manager（存 Ragic API Key）
- `artifactregistry.googleapis.com`：建置映像用（`gcloud run deploy --source` 會用到）

若已設好 `gcloud config set project`，可簡化為：

```bash
gcloud services enable run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
```

---

## 四、建立 Secret（Ragic API Key）

1. **在 GCP 主控台建立**
   - 左側選單「安全性」→「Secret Manager」。
   - 點「建立密鑰」。
   - 名稱：`ragic-api-key`。
   - 密鑰值：貼上你本地 `.env` 裡的 `RAGIC_API_KEY`（只貼金鑰字串，不要貼 `RAGIC_API_KEY=`）。
   - 點「建立版本」。

2. **或用指令建立**（需先有金鑰字串）
   ```bash
   echo -n "你的RAGIC_API_KEY字串" | gcloud secrets create ragic-api-key --data-file=- --project=prayer-time-486401
   ```
   - 若 Secret 已存在，改為新增版本：
   ```bash
   echo -n "你的RAGIC_API_KEY字串" | gcloud secrets versions add ragic-api-key --data-file=- --project=prayer-time-486401
   ```

---

## 五、授予 Cloud Run 使用 Secret 的權限

部署時 Cloud Run 會讀取 `ragic-api-key`，該專案的 **Cloud Run 服務帳號** 需要有對應 Secret 的存取權。

1. 查詢專案編號（數字）：
   ```bash
   gcloud projects describe prayer-time-486401 --format='value(projectNumber)'
   ```
   記下輸出的數字（例如 `123456789012`）。

2. 授予 Ragic API Key 權限（請把 `專案編號` 換成上一步的數字）：
   ```bash
   gcloud secrets add-iam-policy-binding ragic-api-key \
     --member="serviceAccount:專案編號-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor" \
     --project=prayer-time-486401
   ```

---

## 六、部署到 Cloud Run

在專案根目錄（`第一階門訓課程助理`）執行：

```bash
./scripts/deploy.sh
```

- 第一次會問是否啟用 API，選 `Y`。
- 部署完成後，終端機會顯示 **服務網址**（例如 `https://stage1-discipleship-assistant-api-xxxxx-an.a.run.app`），請複製下來給 GPTs 的 openapi `servers` 使用。

或手動執行（以下已使用專案 ID `prayer-time-486401`、區域 `asia-northeast1`，若不同請替換）：

```bash
gcloud run deploy stage1-discipleship-assistant-api \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars "RAGIC_BASE_URL=https://ap13.ragic.com/asiahope,RAGIC_BASIC_RAW=true" \
  --set-secrets "RAGIC_API_KEY=ragic-api-key:latest" \
  --project prayer-time-486401
```

---

## 七、驗證部署

在瀏覽器或終端機開啟：

- `https://你的Cloud_Run網址/` → 應看到 `{"service":"第一階門訓課程助理 API","status":"ok"}`
- `https://你的Cloud_Run網址/books` → 應看到手冊清單 JSON

---

## 常見問題

- **權限錯誤**：確認已執行「五、授予 Cloud Run 使用 Secret 的權限」。
- **Secret 找不到**：確認 Secret 名稱是 `ragic-api-key`，且專案正確。
- **建置失敗**：確認已在專案根目錄執行，且 `Dockerfile`、`package.json` 存在；可先本地執行 `docker build -t test .` 測試。
