#!/usr/bin/env bash
# 範例：用 Google Cloud Scheduler 每天觸發「Ragic → Qdrant」同步
#
# 前置：
# 1) Cloud Run 服務已部署，且環境變數含 RAGIC_*、OPENAI_API_KEY、QDRANT_*、SYNC_QDRANT_SECRET
# 2) 將下列變數改成你的值後執行（或複製指令到 Cloud Console 操作）
#
# export GCP_PROJECT_ID=你的專案
# export REGION=asia-northeast1
# export SERVICE_URL="https://你的服務-xxxxx.asia-northeast1.run.app"
# export SYNC_QDRANT_SECRET="自行產生的長隨機字串（須與 Cloud Run 上 SYNC_QDRANT_SECRET 相同）"

set -e
: "${GCP_PROJECT_ID:?請設 GCP_PROJECT_ID}"
: "${REGION:?請設 REGION}"
: "${SERVICE_URL:?請設 SERVICE_URL}"
: "${SYNC_QDRANT_SECRET:?請設 SYNC_QDRANT_SECRET}"

JOB_NAME="${JOB_NAME:-sync-ragic-to-qdrant-daily}"

gcloud scheduler jobs create http "$JOB_NAME" \
  --project="$GCP_PROJECT_ID" \
  --location="$REGION" \
  --schedule="0 2 * * *" \
  --uri="${SERVICE_URL}/internal/sync-ragic-to-qdrant" \
  --http-method=POST \
  --headers="X-Sync-Secret=${SYNC_QDRANT_SECRET}" \
  --time-zone="Asia/Taipei" \
  --attempt-deadline=15m \
  --description="每日將 Ragic gpt/3 同步到 Qdrant"

echo "已建立排程 $JOB_NAME（每天台北時間 02:00）。改時間請調整 --schedule。"
