#!/usr/bin/env bash
# 冒烟测试：启动服务后验证关键端点。
# 用法：bash scripts/smoke.sh [base-url] [login-id] [password]
set -u

BASE="${1:-http://127.0.0.1:3000}"
LOGIN="${2:-me}"
PASSWORD="${3:-demo1234}"
# cookie jar 落在项目内：mktemp 会给 MSYS 风格的 /tmp/... 路径，
# Windows 版 curl 认不了，每个请求都会以 000 失败。
mkdir -p .data
JAR=".data/smoke-cookies-$$.txt"
: > "$JAR"
CURL=(curl -s --noproxy '*' -b "$JAR" -c "$JAR")

pass=0
fail=0

check() { # check <名称> <期望状态码> <实际状态码> <响应体>
  local name="$1" want="$2" got="$3" body="$4"
  if [ "$want" = "$got" ]; then
    pass=$((pass + 1))
    printf '  \033[32mPASS\033[0m %-28s %s\n' "$name" "$got"
  else
    fail=$((fail + 1))
    printf '  \033[31mFAIL\033[0m %-28s 期望 %s，实际 %s\n' "$name" "$want" "$got"
    printf '       %s\n' "$(printf '%s' "$body" | head -c 300)"
  fi
}

req() { # req <方法> <路径> [JSON数据] -> 设置 CODE/BODY
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    BODY=$("${CURL[@]}" -X "$method" -w '\n%{http_code}' \
      -H 'Content-Type: application/json' \
      --data-raw "$data" "$BASE$path")
  else
    BODY=$("${CURL[@]}" -X "$method" -w '\n%{http_code}' "$BASE$path")
  fi
  CODE=$(printf '%s' "$BODY" | tail -n1)
  BODY=$(printf '%s' "$BODY" | sed '$d')
}

echo "== 健康检查 =="
req GET /api/health; check "/api/health" 200 "$CODE" "$BODY"
printf '     %s\n' "$(printf '%s' "$BODY" | head -c 200)"
req GET /api/ready; check "/api/ready" 200 "$CODE" "$BODY"
printf '     %s\n' "$(printf '%s' "$BODY" | head -c 200)"

echo
echo "== 未登录访问应被拒绝 =="
req GET /api/entries; check "匿名 GET /api/entries" 401 "$CODE" "$BODY"

echo
echo "== 登录 =="
CSRF=$("${CURL[@]}" "$BASE/api/auth/csrf" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
if [ -z "$CSRF" ]; then
  echo "  无法获取 csrfToken，登录中止"
  exit 1
fi
# 登录是 Auth.js 的表单回调，只能走 form-urlencoded
LOGIN_BODY=$("${CURL[@]}" -X POST -w '\n%{http_code}' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-raw "csrfToken=$CSRF&loginId=$LOGIN&password=$PASSWORD&callbackUrl=$BASE/timeline&json=true" \
  "$BASE/api/auth/callback/credentials")
CODE=$(printf '%s' "$LOGIN_BODY" | tail -n1)
check "凭证登录" 302 "$CODE" "$LOGIN_BODY"

echo
echo "== 已登录接口 =="
TODAY=$(date +%F)

req GET "/api/entries?limit=5"; check "GET /api/entries" 200 "$CODE" "$BODY"
printf '     首条: %s\n' "$(printf '%s' "$BODY" | head -c 220)"

req GET "/api/entries?limit=2"
CURSOR=$(printf '%s' "$BODY" | sed -n 's/.*"nextCursor":"\([^"]*\)".*/\1/p')
if [ -n "$CURSOR" ]; then
  req GET "/api/entries?limit=2&cursor=$CURSOR"
  check "游标翻页" 200 "$CODE" "$BODY"
  printf '     第二页首条: %s\n' "$(printf '%s' "$BODY" | head -c 160)"
else
  echo "  SKIP 游标翻页（数据不足一页）"
fi

req POST /api/entries "{\"content\":\"冒烟测试记录 #冒烟\",\"entryDate\":\"$TODAY\",\"occurredAt\":\"${TODAY}T10:00:00.000Z\"}"
check "POST /api/entries" 201 "$CODE" "$BODY"
ENTRY_ID=$(printf '%s' "$BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

if [ -n "$ENTRY_ID" ]; then
  req GET "/api/entries/$ENTRY_ID"; check "GET /api/entries/:id" 200 "$CODE" "$BODY"
  req DELETE "/api/entries/$ENTRY_ID"; check "DELETE /api/entries/:id" 200 "$CODE" "$BODY"
  req POST "/api/entries/$ENTRY_ID/restore" ""; check "POST restore（撤销删除）" 200 "$CODE" "$BODY"
else
  echo "  SKIP 详情/删除/恢复（未取到 entry id）"
fi

YEAR=$(date +%Y); MONTH=$(date +%m)
req GET "/api/calendar?year=$YEAR&month=$MONTH"; check "GET /api/calendar" 200 "$CODE" "$BODY"
printf '     %s\n' "$(printf '%s' "$BODY" | head -c 200)"

req GET "/api/photos?limit=5"; check "GET /api/photos" 200 "$CODE" "$BODY"
req GET "/api/search?q=%E6%97%A5%E5%B8%B8&limit=5"; check "GET /api/search" 200 "$CODE" "$BODY"
req GET "/api/tags"; check "GET /api/tags" 200 "$CODE" "$BODY"
req GET "/api/memories/on-this-day"; check "GET /api/memories/on-this-day" 200 "$CODE" "$BODY"
req GET /api/settings; check "GET /api/settings" 200 "$CODE" "$BODY"
req GET /api/reviews; check "GET /api/reviews" 200 "$CODE" "$BODY"

req POST /api/export '{"kind":"json"}'; check "POST /api/export（导出 JSON）" 201 "$CODE" "$BODY"
printf '     %s\n' "$(printf '%s' "$BODY" | head -c 200)"
req POST /api/export '{"kind":"markdown"}'; check "POST /api/export（导出 Markdown）" 201 "$CODE" "$BODY"
req POST /api/export '{"kind":"zip"}'; check "POST /api/export（导出 ZIP）" 201 "$CODE" "$BODY"
ZIP_ID=$(printf '%s' "$BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -n "$ZIP_ID" ]; then
  DL=$("${CURL[@]}" -D .data/_dl_headers -o .data/_dl_body -w '%{http_code}|%{size_download}' "$BASE/api/export/$ZIP_ID")
  DL_CODE=${DL%%|*}; DL_SIZE=${DL##*|}
  check "GET /api/export/:id（下载）" 200 "$DL_CODE" ""
  if [ "$DL_SIZE" -gt 100 ]; then
    pass=$((pass + 1)); printf '  \033[32mPASS\033[0m %-28s %s bytes\n' "导出包非空" "$DL_SIZE"
  else
    fail=$((fail + 1)); printf '  \033[31mFAIL\033[0m %-28s 只有 %s bytes\n' "导出包非空" "$DL_SIZE"
  fi
  rm -f .data/_dl_headers .data/_dl_body
else
  echo "  SKIP 下载（未取到导出 id）"
fi
req POST /api/entries '{"content":'; check "畸形 JSON 应返回 400" 400 "$CODE" "$BODY"

req GET /api/auth/session; check "GET /api/auth/session" 200 "$CODE" "$BODY"
printf '     %s\n' "$(printf '%s' "$BODY" | head -c 200)"

rm -f "$JAR"
echo
echo "== 汇总：通过 $pass，失败 $fail =="
[ "$fail" -eq 0 ]
