FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build:web

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3210
ENV UPLOADS_DIR=/data/uploads

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/api ./api
COPY --from=build /app/assets ./assets
COPY --from=build /app/index.html ./index.html
RUN mkdir -p /data/uploads && chown -R node:node /app /data

USER node
EXPOSE 3210
CMD ["npm", "start"]