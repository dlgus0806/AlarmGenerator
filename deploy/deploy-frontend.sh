#!/usr/bin/env bash
#
# 프론트엔드 빌드 → S3 업로드 → CloudFront 무효화.
# 최초 인프라는 deploy/frontend.yaml (CloudFormation)로 한 번 만든 뒤, 이 스크립트로 갱신 배포한다.
#
# 사용:
#   deploy/deploy-frontend.sh <BUCKET> <DISTRIBUTION_ID> [VITE_DISCOVER_API]
#
# 예:
#   deploy/deploy-frontend.sh cw-alarm-gen-web-123456789012 E1ABCDEF23 https://discover.example.com
set -euo pipefail

BUCKET="${1:?사용법: deploy-frontend.sh <BUCKET> <DISTRIBUTION_ID> [VITE_DISCOVER_API]}"
DIST_ID="${2:?CloudFront Distribution ID 가 필요합니다}"
DISCOVER_API="${3:-}"

# 빌드 (백엔드 주소를 빌드에 주입)
if [ -n "$DISCOVER_API" ]; then
  echo "VITE_DISCOVER_API=$DISCOVER_API 로 빌드합니다."
  VITE_DISCOVER_API="$DISCOVER_API" npm run build
else
  echo "VITE_DISCOVER_API 미지정 — 같은 오리진(/api)로 호출하도록 빌드합니다."
  npm run build
fi

# 해시 붙은 assets 는 길게 캐시, index.html 은 항상 새로 받게 no-cache.
aws s3 sync dist/ "s3://$BUCKET/" --delete \
  --exclude index.html \
  --cache-control 'public,max-age=31536000,immutable'
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control 'no-cache'

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null
echo "배포 완료. CloudFront 무효화 요청됨."
