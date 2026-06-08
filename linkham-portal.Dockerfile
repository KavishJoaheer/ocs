# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace config
COPY package*.json ./

# Copy portal source
COPY linkham-portal/ ./linkham-portal/

# Install dependencies for the portal
RUN npm ci --workspace=linkham-portal

# Build the portal
RUN npm run build --workspace=linkham-portal

# Serve stage
FROM nginx:alpine

# Copy custom nginx config to route /api to backend
COPY linkham-portal-nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/linkham-portal/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
