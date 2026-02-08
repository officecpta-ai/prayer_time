#!/usr/bin/env bash
# 建立/更新 prayer-time-line-api 需要的 Secret Manager secrets
#
# 會處理（預設名稱）：
# - ragic-api-key
# - line-channel-secret
# - line-channel-access-token
# - view-link-secret
# - openai-api-key（整本手冊 QA）
#
# 值來源優先序：
# 1) prayer-time-line-api/.env（若存在）
# 2) 環境變數：RAGIC_API_KEY / LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN / VIEW_LINK_SECRET
#    （選用）OPENAI_API_KEY
# 3) 互動式輸入（不回顯）
#
# 注意：
# - 此腳本不會輸出 secret 值
# - 若 secret 已存在，會略過 create，並新增一個 version

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-}"
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "錯誤：找不到 GCP 專案。請先 export GCP_PROJECT_ID=... 或 gcloud config set project ..."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 從 prayer-time-line-api/.env 讀取（若存在）
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

ensure_secret_exists() {
  local name="$1"
  if gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    return 0
  fi
  echo "建立 Secret：$name"
  gcloud secrets create "$name" --replication-policy="automatic" --project "$PROJECT_ID" >/dev/null
}

add_secret_version_from_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "略過（未提供值）：$name"
    return 0
  fi
  echo "新增版本：$name"
  # 不要 echo value；用 stdin 傳入
  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project "$PROJECT_ID" >/dev/null
}

prompt_secret() {
  local prompt="$1"
  local varname="$2"
  local current="${!varname:-}"
  if [[ -n "$current" ]]; then
    printf '%s' "$current"
    return 0
  fi

 local input=""
  # -s：不回顯；避免在螢幕/錄影中暴露
  read -r -s -p "$prompt" input
  echo ""
  printf '%s' "$input"
}

echo "GCP 專案：$PROJECT_ID"
echo "將建立/更新 prayer-time-line-api secrets..."
echo ""

# 1) Ragic API key
RAGIC_SECRET_NAME="${RAGIC_SECRET_NAME:-ragic-api-key}"
RAGIC_API_KEY_VALUE="$(prompt_secret '請輸入 RAGIC_API_KEY（不會顯示）：' 'RAGIC_API_KEY')"
ensure_secret_exists "$RAGIC_SECRET_NAME"
add_secret_version_from_value "$RAGIC_SECRET_NAME" "$RAGIC_API_KEY_VALUE"

# 2) LINE channel secret
LINE_CHANNEL_SECRET_SECRET_NAME="${LINE_CHANNEL_SECRET_SECRET_NAME:-line-channel-secret}"
LINE_CHANNEL_SECRET_VALUE="$(prompt_secret '請輸入 LINE_CHANNEL_SECRET（不會顯示）：' 'LINE_CHANNEL_SECRET')"
ensure_secret_exists "$LINE_CHANNEL_SECRET_SECRET_NAME"
add_secret_version_from_value "$LINE_CHANNEL_SECRET_SECRET_NAME" "$LINE_CHANNEL_SECRET_VALUE"

# 3) LINE channel access token
LINE_CHANNEL_ACCESS_TOKEN_SECRET_NAME="${LINE_CHANNEL_ACCESS_TOKEN_SECRET_NAME:-line-channel-access-token}"
LINE_CHANNEL_ACCESS_TOKEN_VALUE="$(prompt_secret '請輸入 LINE_CHANNEL_ACCESS_TOKEN（不會顯示）：' 'LINE_CHANNEL_ACCESS_TOKEN')"
ensure_secret_exists "$LINE_CHANNEL_ACCESS_TOKEN_SECRET_NAME"
add_secret_version_from_value "$LINE_CHANNEL_ACCESS_TOKEN_SECRET_NAME" "$LINE_CHANNEL_ACCESS_TOKEN_VALUE"

# 4) View link secret
VIEW_LINK_SECRET_SECRET_NAME="${VIEW_LINK_SECRET_SECRET_NAME:-view-link-secret}"
VIEW_LINK_SECRET_VALUE="$(prompt_secret '請輸入 VIEW_LINK_SECRET（不會顯示）：' 'VIEW_LINK_SECRET')"
ensure_secret_exists "$VIEW_LINK_SECRET_SECRET_NAME"
add_secret_version_from_value "$VIEW_LINK_SECRET_SECRET_NAME" "$VIEW_LINK_SECRET_VALUE"

# 5) OpenAI API key（選用；若未啟用 QA 可略過）
OPENAI_SECRET_NAME="${OPENAI_SECRET_NAME:-openai-api-key}"
OPENAI_API_KEY_VALUE="$(prompt_secret '（選用）請輸入 OPENAI_API_KEY（不會顯示；留空略過）：' 'OPENAI_API_KEY')"
ensure_secret_exists "$OPENAI_SECRET_NAME"
add_secret_version_from_value "$OPENAI_SECRET_NAME" "$OPENAI_API_KEY_VALUE"

echo ""
echo "完成。"
echo "提醒：請確保 Cloud Run 的執行身分（service account）具備讀取 secrets 的權限（Secret Manager Secret Accessor）。"

