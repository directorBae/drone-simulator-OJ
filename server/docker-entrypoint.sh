#!/bin/sh
# 컨테이너 시작: DB 폴더 권한 정리 + HTTPS 인증서 준비 + 학생 코드 실행 사용자(sandbox)의 네트워크 차단
chmod 700 /data 2>/dev/null

# HTTPS 인증서: /certs/origin.pem · origin.key 가 없으면 자체 서명 인증서를 만듦 (Cloudflare SSL 'Full' 에서 사용 가능).
# Cloudflare 원본 인증서(Origin Certificate)로 바꾸면 'Full (strict)' 로 쓸 수 있음 — 파일만 바꾸고 재시작
mkdir -p /certs && chmod 700 /certs
if [ ! -s /certs/origin.pem ] || [ ! -s /certs/origin.key ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=droneoj-origin"     -keyout /certs/origin.key -out /certs/origin.pem >/dev/null 2>&1     && echo "HTTPS: 자체 서명 인증서를 만들었습니다 (/certs). Cloudflare 원본 인증서로 바꾸면 Full (strict) 가능"
fi
chmod 600 /certs/origin.key 2>/dev/null

blocked=1
for ipt in iptables ip6tables; do
  if ! "$ipt" -C OUTPUT -m owner --uid-owner sandbox -j REJECT 2>/dev/null; then
    "$ipt" -A OUTPUT -m owner --uid-owner sandbox -j REJECT 2>/dev/null || blocked=0
  fi
done
if [ "$blocked" = 1 ]; then
  echo "학생 코드(sandbox 사용자)의 네트워크를 막았습니다"
else
  echo "⚠ 학생 코드의 네트워크를 막지 못했습니다 — docker-compose.yml 에 cap_add: [NET_ADMIN] 이 필요합니다. 이대로면 학생 코드가 외부로 접속할 수 있습니다"
fi

exec "$@"
