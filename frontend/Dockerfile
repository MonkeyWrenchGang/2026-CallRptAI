# ── Stage 1: Build ──────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

COPY public/ public/
COPY src/ src/

# Build with the API URL pointing to the backend service
ENV REACT_APP_API_URL=""
RUN npm run build

# ── Stage 2: Serve with nginx ──────────────────────────────────────────
FROM nginx:alpine

# Copy custom nginx config for SPA routing + API proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
