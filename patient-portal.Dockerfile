FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY patient-portal/package*.json ./patient-portal/
WORKDIR /app/patient-portal
RUN npm install
COPY patient-portal ./
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/patient-portal/dist /usr/share/nginx/html
COPY patient-portal-nginx.conf /etc/nginx/conf.d/default.conf
COPY patient-portal-security-headers.conf /etc/nginx/ocs-security-headers.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
