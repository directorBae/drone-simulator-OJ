# Drone OJ — Node 22 (내장 SQLite 사용) 단일 컨테이너
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY public ./public
COPY server ./server
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8080
WORKDIR /app/server
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
