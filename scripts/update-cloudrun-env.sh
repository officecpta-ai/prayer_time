#!/usr/bin/env bash
# 更新 Cloud Run 服務的 OAuth 代理環境變數（不重新建置）
# 使用前：請在 .env 或 export 中設定 GOOGLE_CLIENT_ID、PUBLIC_BASE_URL；GOOGLE_CLIENT_SECRET 可選（若用 Secret 掛載則留空）

set -e

PROJECT_ID="${GCP_PROJECT_ID:-prayer-time-486401}"
REGION="${GCP_REGION:-asia-northeast1}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://prayer-time-api-43747267943.asia-northeast1.run.app}"

# 從專案根目錄的 .env 讀取（若存在）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"

if [[ -z "$GOOGLE_CLIENT_ID" ]]; then
  echo "請設定 GOOGLE_CLIENT_ID（.env 或 export）。"
  exit 1
fi

OAuth_ENV_VARS="PUBLIC_BASE_URL=$PUBLIC_BASE_URL,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
if [[ -n "$GOOGLE_CLIENT_SECRET" ]]; then
  OAuth_ENV_VARS="${OAuth_ENV_VARS},GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
fi

echo "專案: $PROJECT_ID | 區域: $REGION"
echo "PUBLIC_BASE_URL: $PUBLIC_BASE_URL"
echo "更新 Cloud Run 環境變數（OAuth 代理）..."
echo ""

gcloud run services update prayer-time-api \
  --region "$REGION" \
  --update-env-vars "$OAuth_ENV_VARS" \
  --project "$PROJECT_ID"

echo ""
echo "已更新。請在 GPTs 驗證中填："
echo "  授權 URL: ${PUBLIC_BASE_URL}/oauth/authorize"
echo "  權杖 URL: ${PUBLIC_BASE_URL}/oauth/token"
echo "  範圍: email openid profile"
echo "  Google OAuth 用戶端「授權的重新導向 URI」需包含: ${PUBLIC_BASE_URL}/oauth/callback"
