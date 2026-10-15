#!/usr/bin/env bash
#
# 백엔드 Lambda 최초 생성 (CloudFormation).
# server/*.mjs 를 zip 해서 S3에 올리고 backend.yaml 스택을 배포한다.
# 이후 "코드만" 수정할 때는 deploy-backend.sh 로 빠르게 갱신(스택 미경유).
#
# 사용:
#   [DISCOVER_API_TOKEN=<토큰>] deploy/setup-backend.sh <STACK> <ARTIFACT_BUCKET> [REGION] [ALLOWED_ORIGIN]
# 예:
#   deploy/setup-backend.sh cw-alarm-gen-backend cw-alarm-generator ap-northeast-2 'https://d123.cloudfront.net'
set -euo pipefail

STACK="${1:?사용법: setup-backend.sh <STACK> <ARTIFACT_BUCKET> [REGION] [ALLOWED_ORIGIN]}"
BUCKET="${2:?코드 zip 을 올릴 S3 버킷 (프론트 버킷 재사용 가능)}"
REGION="${3:-ap-northeast-2}"
ORIGIN="${4:-*}"
# DISCOVER_API_TOKEN 이 "설정됐지만 빈 값"이면 인증 비활성화, 아예 없으면 랜덤 생성.
TOKEN="${DISCOVER_API_TOKEN-$(openssl rand -hex 32)}"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
( cd server && zip -q -r "$TMP/backend.zip" ./*.mjs )
KEY="backend/backend-$(date +%s).zip"
aws s3 cp "$TMP/backend.zip" "s3://$BUCKET/$KEY" --region "$REGION"

# CloudFront 배포 ARN(선택): 환경변수 DISTRIBUTION_ARN 로 전달하면 그 배포만 호출 허용.
DIST_ARN="${DISTRIBUTION_ARN:-}"
# assume 허용/대상 역할 이름 (환경변수로 조정, 기본 monitoring-readonly).
ROLE_NAMES="${ALLOWED_ROLE_NAMES:-monitoring-readonly}"
ASSUME_ROLE="${ASSUME_ROLE_NAME:-monitoring-readonly}"

# --- 웹 Slack OAuth (선택) ---
# SLACK_CLIENT_ID + SLACK_CLIENT_SECRET + SESSION_SECRET 이 모두 있으면 로그인 게이트가 켜진다.
# 시크릿은 여기 하드코딩하지 말고 실행 시 환경변수로 주입한다.
SLACK_ID="${SLACK_CLIENT_ID:-}"
SLACK_SECRET="${SLACK_CLIENT_SECRET:-}"
# SESSION_SECRET 이 "설정됐지만 빈 값"이면 그대로(=OAuth 끔), 아예 없고 SLACK_ID가 있으면 랜덤 생성.
if [ -n "${SESSION_SECRET+x}" ]; then
  SESSION="$SESSION_SECRET"
elif [ -n "$SLACK_ID" ]; then
  SESSION="$(openssl rand -hex 32)"
else
  SESSION=""
fi
APP_URL="${APP_BASE_URL:-https://cw.dlgus.fitcloud.co.kr}"
BROKER_URL="${BROKER_API_URL:-}"

aws cloudformation deploy \
  --template-file deploy/backend.yaml \
  --stack-name "$STACK" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    CodeS3Bucket="$BUCKET" CodeS3Key="$KEY" \
    ApiToken="$TOKEN" AllowedOrigin="$ORIGIN" \
    DistributionArn="$DIST_ARN" \
    AllowedRoleNames="$ROLE_NAMES" AssumeRoleName="$ASSUME_ROLE" \
    SlackClientId="$SLACK_ID" SlackClientSecret="$SLACK_SECRET" \
    SessionSecret="$SESSION" AppBaseUrl="$APP_URL" BrokerApiUrl="$BROKER_URL" \
  --region "$REGION"

echo "----------------------------------------"
if [ -z "$TOKEN" ]; then
  echo "인증: 비활성화 (토큰 없음 — 누구나 유효한 역할 ARN으로 호출 가능)"
else
  echo "접근 토큰 (안전하게 보관, 조회 UI에 입력): $TOKEN"
fi
echo "----------------------------------------"
aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output table
