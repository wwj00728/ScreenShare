FROM node:22-alpine
WORKDIR /repo
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
WORKDIR /repo/apps/api
RUN npm install --no-audit --no-fund
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]
