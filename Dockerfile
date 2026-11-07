FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY scripts ./scripts
COPY web ./web
COPY worker ./worker
COPY .openai ./.openai
COPY DESIGN.md public-state.json ./
RUN node scripts/build.mjs
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist/server ./dist/server
COPY server ./server
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/start.mjs"]
