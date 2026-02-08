#!/usr/bin/env bash
# 用法：./scripts/test-content-with-email.sh "您的訂閱Email"
# 會先呼叫 /email/books 取書單，再用第一本書觸發 /content（day=1），方便看 RAGIC_DEBUG log
set -e
EMAIL="${1:?請提供訂閱 Email，例如: ./scripts/test-content-with-email.sh \"your@email.com\"}"
BASE="${BASE_URL:-http://localhost:8080}"
ENCODED=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$EMAIL")
echo "→ GET /email/books?email=..."
BOOKS=$(curl -s "${BASE}/email/books?email=${ENCODED}")
echo "$BOOKS"
BOOK_ID=$(node -e "const b=JSON.parse(process.argv[1]); const arr=b.subscribed_books; console.log(arr&&arr[0]?arr[0].book_id:'')" "$BOOKS")
if [ -z "$BOOK_ID" ]; then
  echo "此 Email 尚無訂閱書單，無法觸發 /content。"
  exit 1
fi
echo ""
echo "→ GET /content?email=...&book_id=$BOOK_ID&day=1"
curl -s "${BASE}/content?email=${ENCODED}&book_id=${BOOK_ID}&day=1"
echo ""
echo "請看執行 API 的終端機是否有 [content] 訂閱表讀到 userInfo 與 [createReadingRecord] 寫入欄位 的 log。"
