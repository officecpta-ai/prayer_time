#!/usr/bin/env bash
# 第一階門訓課程助理 API - 健康檢查（可單獨執行或供 CI 使用）
# 用法：./scripts/health-check.sh [服務網址]
#       或 export HEALTH_CHECK_URL=... 或 GCP_PROJECT_ID + GCP_REGION（從 gcloud 取得網址）

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 服務網址：參數 > 環境變數 > 從 gcloud 取得
SERVICE_URL="${1:-$HEALTH_CHECK_URL}"
if [[ -z "$SERVICE_URL" ]]; then
  PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
  REGION="${GCP_REGION:-asia-northeast1}"
  if [[ -z "$PROJECT_ID" ]]; then
    echo "請提供服務網址："
    echo "  ./scripts/health-check.sh https://你的Cloud_Run網址"
    echo "  或 export HEALTH_CHECK_URL=..."
    echo "  或 export GCP_PROJECT_ID=...（搭配 gcloud 預設專案或 GCP_REGION）"
    exit 1
  fi
  SERVICE_URL=$(gcloud run services describe stage1-discipleship-assistant-api --region "$REGION" --format='value(status.url)' --project "$PROJECT_ID" 2>/dev/null)
fi

if [[ -z "$SERVICE_URL" ]]; then
  echo "錯誤：無法取得服務網址。"
  exit 1
fi

# 去掉結尾斜線
SERVICE_URL="${SERVICE_URL%/}"

echo "健康檢查：$SERVICE_URL"
ROOT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/" 2>/dev/null || echo "000")
BOOKS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/books" 2>/dev/null || echo "000")

echo "  /     → $ROOT_CODE"
echo "  /books → $BOOKS_CODE"

if [[ "$ROOT_CODE" == "200" ]]; then
  echo "結果：通過（根路徑回傳 200）"
  exit 0
else
  echo "結果：未通過（根路徑需回傳 200，目前 $ROOT_CODE）"
  exit 1
fi
