FROM node:24-bookworm-slim

WORKDIR /app

COPY server/package*.json ./server/
RUN npm install --prefix server --omit=dev

COPY server ./server

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/clinic.db

EXPOSE 3001

WORKDIR /app/server

CMD ["node", "src/index.js"]
