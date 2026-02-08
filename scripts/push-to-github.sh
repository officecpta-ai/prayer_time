#!/usr/bin/env bash
# 上傳到 GitHub（請先到 https://github.com/new 建立空倉庫，再把下方 URL 改成你的）
# 用法：修改 REPO_URL 後執行 ./scripts/push-to-github.sh
set -e
cd "$(dirname "$0")/.."
REPO_URL="${GITHUB_REPO_URL:-https://github.com/你的用戶名/倉庫名.git}"
if [[ "$REPO_URL" == *"你的用戶名"* ]]; then
  echo "請先設定 GitHub 倉庫網址："
  echo "  export GITHUB_REPO_URL=https://github.com/你的用戶名/倉庫名.git"
  echo "  或編輯此腳本修改 REPO_URL"
  exit 1
fi
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git push -u origin main
echo "已推送到 $REPO_URL"
