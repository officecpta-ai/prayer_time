#!/usr/bin/env bash
# prayer-time-line-api - 部署到 Google Cloud Run（獨立於 prayer-time-api）
#
# 必要 Secrets：
# - ragic-api-key
# - line-channel-secret
# - line-channel-access-token
# - view-link-secret
#
# 必要 Env：
# - RAGIC_BASE_URL（預設 https://ap13.ragic.com/asiahope）
# - RAGIC_BASIC_RAW=true|false（預設 true）
# - PUBLIC_BASE_URL（建議設定為 Cloud Run 服務網址，用來產生 /view 連結）

set -e

PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-northeast1}"

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo '')
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "錯誤：請先設定 GCP 專案：export GCP_PROJECT_ID=... 或 gcloud config set project ..."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# 從 prayer-time-line-api/.env 讀取（若存在）
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

ENV_VARS="RAGIC_BASE_URL=${RAGIC_BASE_URL:-https://ap13.ragic.com/asiahope},RAGIC_BASIC_RAW=${RAGIC_BASIC_RAW:-true}"
if [[ -n "${PUBLIC_BASE_URL:-}" ]]; then
  ENV_VARS="${ENV_VARS},PUBLIC_BASE_URL=${PUBLIC_BASE_URL}"
fi
if [[ -n "${RAGIC_SUBSCRIBE_FORM_URL:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_SUBSCRIBE_FORM_URL=${RAGIC_SUBSCRIBE_FORM_URL}"
fi

# Ragic 欄位 ID（非機密；建議一起帶到 Cloud Run，避免日後表單調整）
if [[ -n "${RAGIC_READING_RECORD_FIELD_LINE_USER_ID:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_LINE_USER_ID=${RAGIC_READING_RECORD_FIELD_LINE_USER_ID}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_LINE_DISPLAY_NAME:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_LINE_DISPLAY_NAME=${RAGIC_READING_RECORD_FIELD_LINE_DISPLAY_NAME}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_USER_EMAIL:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_USER_EMAIL=${RAGIC_READING_RECORD_FIELD_USER_EMAIL}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_BOOK_ID:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_BOOK_ID=${RAGIC_READING_RECORD_FIELD_BOOK_ID}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_BOOK_NAME:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_BOOK_NAME=${RAGIC_READING_RECORD_FIELD_BOOK_NAME}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_READING_DAY:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_READING_DAY=${RAGIC_READING_RECORD_FIELD_READING_DAY}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_READ_TIME:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_READ_TIME=${RAGIC_READING_RECORD_FIELD_READ_TIME}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_USER_NAME:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_USER_NAME=${RAGIC_READING_RECORD_FIELD_USER_NAME}"
fi
if [[ -n "${RAGIC_READING_RECORD_FIELD_CHURCH:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_READING_RECORD_FIELD_CHURCH=${RAGIC_READING_RECORD_FIELD_CHURCH}"
fi
if [[ -n "${RAGIC_SUBSCRIPTION_FIELD_USER_NAME:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_SUBSCRIPTION_FIELD_USER_NAME=${RAGIC_SUBSCRIPTION_FIELD_USER_NAME}"
fi
if [[ -n "${RAGIC_SUBSCRIPTION_FIELD_CHURCH:-}" ]]; then
  ENV_VARS="${ENV_VARS},RAGIC_SUBSCRIPTION_FIELD_CHURCH=${RAGIC_SUBSCRIPTION_FIELD_CHURCH}"
fi

# Vertex / Firestore（整本手冊 QA）
if [[ -n "${VERTEX_PROJECT_ID:-}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_PROJECT_ID=${VERTEX_PROJECT_ID}"
fi
if [[ -n "${VERTEX_LOCATION:-}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_LOCATION=${VERTEX_LOCATION}"
fi
if [[ -n "${VERTEX_INDEX_ID:-}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_INDEX_ID=${VERTEX_INDEX_ID}"
fi
if [[ -n "${VERTEX_INDEX_ENDPOINT_ID:-}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_INDEX_ENDPOINT_ID=${VERTEX_INDEX_ENDPOINT_ID}"
fi
if [[ -n "${VERTEX_DEPLOYED_INDEX_ID:-}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_DEPLOYED_INDEX_ID=${VERTEX_DEPLOYED_INDEX_ID}"
fi
if [[ -n "${VERTEX_PUBLIC_ENDPOINT_DOMAIN:-}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_PUBLIC_ENDPOINT_DOMAIN=${VERTEX_PUBLIC_ENDPOINT_DOMAIN}"
fi
if [[ -n "${FIRESTORE_CHUNKS_COLLECTION:-}" ]]; then
  ENV_VARS="${ENV_VARS},FIRESTORE_CHUNKS_COLLECTION=${FIRESTORE_CHUNKS_COLLECTION}"
fi
if [[ -n "${OPENAI_EMBED_MODEL:-}" ]]; then
  ENV_VARS="${ENV_VARS},OPENAI_EMBED_MODEL=${OPENAI_EMBED_MODEL}"
fi
if [[ -n "${OPENAI_QA_MODEL:-}" ]]; then
  ENV_VARS="${ENV_VARS},OPENAI_QA_MODEL=${OPENAI_QA_MODEL}"
fi

SECRETS_STR="RAGIC_API_KEY=ragic-api-key:latest,LINE_CHANNEL_SECRET=line-channel-secret:latest,LINE_CHANNEL_ACCESS_TOKEN=line-channel-access-token:latest,VIEW_LINK_SECRET=view-link-secret:latest,OPENAI_API_KEY=openai-api-key:latest"

echo "專案 ID: $PROJECT_ID"
echo "區域: $REGION"
echo "開始部署 prayer-time-line-api..."
echo ""

gcloud run deploy prayer-time-line-api \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$SECRETS_STR" \
  --project "$PROJECT_ID"

