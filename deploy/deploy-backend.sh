#!/usr/bin/env bash
#
# 백엔드(조회 Lambda) 코드 갱신 배포.
# server/*.mjs 만 zip 으로 묶어 Lambda 코드로 업로드한다. (SDK v3는 Lambda 런타임 내장이라 미포함)
# node_modules 는 zip 에 넣지 않는다.
#
# 사용:
#   deploy/deploy-backend.sh <FUNCTION_NAME> [REGION]
# 예:
#   deploy/deploy-backend.sh cw-alarm-discover ap-northeast-2
set -euo pipefail

FN="${1:?사용법: deploy-backend.sh <FUNCTION_NAME> [REGION]}"
REGION="${2:-ap-northeast-2}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ZIP="$TMP/backend.zip"

# server/ 의 mjs 만 담는다 (core.mjs / lambda.mjs / discover.mjs).
( cd server && zip -q -r "$ZIP" ./*.mjs )

aws lambda update-function-code \
  --function-name "$FN" \
  --zip-file "fileb://$ZIP" \
  --region "$REGION" \
  --output text --query 'LastModified'

echo "백엔드 배포 완료: $FN ($REGION)"
