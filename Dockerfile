# HomeMend MCP server + simulator, single container.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json server/
COPY sim/package.json sim/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -C server build && pnpm -C sim build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0 HOMEMEND_DATA_DIR=/data
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/sim/package.json sim/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/dist-ui server/dist-ui
COPY --from=build /app/sim/dist sim/dist
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "server/dist/main.js"]
