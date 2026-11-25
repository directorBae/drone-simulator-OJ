# Drone OJ — Node 22 (내장 SQLite) + Python 3 (2일차 학생 코드 채점) 단일 컨테이너
FROM node:22-alpine
# python3: 학생 코드 실행 · iptables: 학생 코드의 네트워크 차단 · sandbox: 학생 코드를 실행하는 권한 없는 사용자
RUN apk add --no-cache python3 iptables ip6tables \
 && adduser -D -H -s /sbin/nologin -u 10001 sandbox
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY public ./public
COPY server ./server
# 학생 코드(sandbox)가 서버 코드 · 비공개 케이스 · DB 를 읽지 못하게: /app · /data 는 root 만.
# 실행기(harness.py)만 따로 꺼내 둠. 실행 폴더는 채점마다 만들어 sandbox 에게 넘김
RUN mkdir -p /opt/droneoj /data /tmp/droneoj-runs \
 && cp server/harness.py /opt/droneoj/harness.py \
 && chmod 755 /opt/droneoj && chmod 644 /opt/droneoj/harness.py \
 && chmod -R go-rwx /app /data && chmod 711 /tmp/droneoj-runs \
 && chmod 700 server/docker-entrypoint.sh
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production \
    SANDBOX_USER=sandbox SANDBOX_HARNESS=/opt/droneoj/harness.py SANDBOX_DIR=/tmp/droneoj-runs PYTHON_BIN=/usr/bin/python3
VOLUME ["/data"]
EXPOSE 8080
WORKDIR /app/server
ENTRYPOINT ["/app/server/docker-entrypoint.sh"]
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
