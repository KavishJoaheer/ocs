FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY patient-portal/package*.json ./patient-portal/
WORKDIR /app/patient-portal
RUN npm install
COPY patient-portal ./
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/patient-portal/dist /usr/share/nginx/html
COPY patient-portal-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
