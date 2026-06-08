# Build stage
FROM node:20-alpine AS builder

WORKDIR /app/linkham-portal

# Copy package files first
COPY linkham-portal/package*.json ./

# Install dependencies for the portal
RUN npm install

# Copy portal source
COPY linkham-portal/ ./

# Build the portal
RUN npm run build

# Serve stage
FROM nginx:alpine

# Copy custom nginx config to route /api to backend
COPY linkham-portal-nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/linkham-portal/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
