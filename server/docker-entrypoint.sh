#!/bin/sh
# 컨테이너 시작: DB 폴더 권한 정리 + 학생 코드 실행 사용자(sandbox)의 네트워크 차단
chmod 700 /data 2>/dev/null

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
