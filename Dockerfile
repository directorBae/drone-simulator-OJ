# Drone OJ — Node 22 (내장 SQLite) + Python 3 (2일차 학생 코드 채점) 단일 컨테이너
FROM node:22-alpine
# python3: 학생 코드 실행 · iptables: 학생 코드의 네트워크 차단 · sandbox: 학생 코드를 실행하는 권한 없는 사용자
# 채점 칸마다 다른 사용자 sandbox1 … sandbox16 (uid · gid 10001 ~ 10016): 동시에 채점 중인 학생끼리 서로 영향 없게
RUN apk add --no-cache python3 iptables ip6tables openssl \
 && for i in $(seq 1 16); do addgroup -g $((10000 + i)) sandbox$i && adduser -D -H -s /sbin/nologin -u $((10000 + i)) -G sandbox$i sandbox$i; done
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY public ./public
COPY server ./server
# 학생 코드(sandbox)가 서버 코드 · 비공개 케이스 · DB 를 읽지 못하게: /app · /data 는 root 만.
# 실행기(harness.py)만 따로 꺼내 둠. 실행 폴더는 채점마다 만들어 sandbox 에게 넘김
RUN mkdir -p /opt/droneoj /data /certs /tmp/droneoj-runs \
 && cp server/harness.py /opt/droneoj/harness.py \
 && chmod 755 /opt/droneoj && chmod 644 /opt/droneoj/harness.py \
 && chmod -R go-rwx /app /data /certs && chmod 711 /tmp/droneoj-runs \
 && chmod 1771 /tmp /var/tmp \
 && chmod 700 server/docker-entrypoint.sh
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production \
    SANDBOX_USER=sandbox SANDBOX_HARNESS=/opt/droneoj/harness.py SANDBOX_DIR=/tmp/droneoj-runs PYTHON_BIN=/usr/bin/python3     TLS_CERT_FILE=/certs/origin.pem TLS_KEY_FILE=/certs/origin.key HTTPS_PORT=8443
VOLUME ["/data", "/certs"]
EXPOSE 8080 8443
WORKDIR /app/server
ENTRYPOINT ["/app/server/docker-entrypoint.sh"]
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
