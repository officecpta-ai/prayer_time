#!/usr/bin/env bash
# 禱告時光 API - 部署到 Google Cloud Run
# 使用前：請先完成 docs/GCP_SETUP.md 的「一～五」步驟（gcloud 登入、專案、API、Secret、權限）
# OAuth：若 .env 中有 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、PUBLIC_BASE_URL，部署時會一併帶上；亦可改為用 Secret 掛載 GOOGLE_CLIENT_SECRET。

set -e

# 專案 ID（可從環境變數讀取，或改寫成你的預設值）
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-northeast1}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "請設定 GCP 專案 ID："
  echo "  export GCP_PROJECT_ID=prayer-time-486401"
  echo "  或直接修改此腳本中的 PROJECT_ID"
  echo ""
  echo "目前 gcloud 預設專案：$(gcloud config get-value project 2>/dev/null || echo '未設定')"
  read -r -p "輸入專案 ID（或留空使用 gcloud 預設）: " PROJECT_ID
  if [[ -z "$PROJECT_ID" ]]; then
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
  fi
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "錯誤：無法取得專案 ID。請執行 gcloud config set project prayer-time-486401"
  exit 1
fi

# 部署前檢查：gcloud 已登入、可存取專案
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  echo "錯誤：未偵測到 gcloud 登入。請先執行： gcloud auth login"
  exit 1
fi
if ! gcloud projects describe "$PROJECT_ID" --project "$PROJECT_ID" &>/dev/null; then
  echo "錯誤：無法存取專案 $PROJECT_ID。請確認專案 ID 正確且帳號具備權限。"
  exit 1
fi

echo "專案 ID: $PROJECT_ID"
echo "區域: $REGION"
echo "開始部署..."
echo ""

# 從專案根目錄執行（腳本在 scripts/deploy.sh）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# 從 .env 讀取 OAuth 變數（若存在），以便每次部署一併帶上
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

# 環境變數：Ragic + 選填 OAuth（若 .env 有 GOOGLE_CLIENT_ID、PUBLIC_BASE_URL，密鑰可用 .env 或 Secret）
ENV_VARS="RAGIC_BASE_URL=https://ap13.ragic.com/asiahope,RAGIC_BASIC_RAW=true,RAGIC_SUBSCRIPTION_FORM_URL=https://ap13.ragic.com/asiahope/gpt/4?ragic-web-embed=true&webaction=form&ver=new&version=2"
SECRETS_STR="RAGIC_API_KEY=ragic-api-key:latest"

if [[ -n "$GOOGLE_CLIENT_ID" && -n "$PUBLIC_BASE_URL" ]]; then
  ENV_VARS="${ENV_VARS},PUBLIC_BASE_URL=${PUBLIC_BASE_URL},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"
  if [[ -n "$GOOGLE_CLIENT_SECRET" ]]; then
    ENV_VARS="${ENV_VARS},GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}"
    echo "已從 .env 帶入 OAuth 變數（PUBLIC_BASE_URL、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET）"
  else
    GOOGLE_SECRET_NAME="${GOOGLE_CLIENT_SECRET_SECRET:-google-oauth-client-secret}"
    SECRETS_STR="${SECRETS_STR},GOOGLE_CLIENT_SECRET=${GOOGLE_SECRET_NAME}:latest"
    echo "已從 .env 帶入 OAuth 變數（PUBLIC_BASE_URL、GOOGLE_CLIENT_ID）；GOOGLE_CLIENT_SECRET 從 Secret「${GOOGLE_SECRET_NAME}」掛載"
  fi
fi

# 部署並擷取輸出的 Service URL（與終端機顯示一致，避免 describe 回傳不同格式）
DEPLOY_OUTPUT=$(gcloud run deploy prayer-time-api \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$SECRETS_STR" \
  --project "$PROJECT_ID" 2>&1)
echo "$DEPLOY_OUTPUT"

# 從部署輸出取得 Service URL（與上方顯示一致），若無則改用 describe
SERVICE_URL=$(echo "$DEPLOY_OUTPUT" | grep -E '^Service URL:' | sed 's|^Service URL:[[:space:]]*||' | head -1)
if [[ -z "$SERVICE_URL" ]]; then
  SERVICE_URL=$(gcloud run services describe prayer-time-api --region "$REGION" --format='value(status.url)' --project "$PROJECT_ID" 2>/dev/null)
fi
if [[ -n "$SERVICE_URL" && -f "$ROOT_DIR/openapi.yaml" ]]; then
  if sed -i.bak "s|  - url: .*|  - url: ${SERVICE_URL}|" "$ROOT_DIR/openapi.yaml" 2>/dev/null; then
    rm -f "$ROOT_DIR/openapi.yaml.bak"
    echo ""
    echo "已將 openapi.yaml 的 servers.url 更新為: $SERVICE_URL"
  fi
fi

if [[ -n "$SERVICE_URL" ]]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo ""
    echo "健康檢查通過：$SERVICE_URL/ 回傳 200"
  else
    echo ""
    echo "提醒：請手動確認服務是否正常（$SERVICE_URL/ 目前回傳: $HTTP_CODE）"
  fi
fi

echo ""
echo "部署完成。若未自動更新，請將上方「服務網址」複製到 openapi.yaml 的 servers 與 GPTs Action。"
