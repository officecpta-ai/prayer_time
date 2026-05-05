#!/usr/bin/env bash
# 第一階門訓課程助理 API - 健康檢查（可單獨執行或供 CI 使用）
# 用法：./scripts/health-check.sh [服務網址]
#       或 export HEALTH_CHECK_URL=...

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 服務網址：參數 > 環境變數
SERVICE_URL="${1:-$HEALTH_CHECK_URL}"
if [[ -z "$SERVICE_URL" ]]; then
  echo "請提供服務網址："
  echo "  ./scripts/health-check.sh https://你的Zeabur網址"
  echo "  或 export HEALTH_CHECK_URL=https://你的Zeabur網址"
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
