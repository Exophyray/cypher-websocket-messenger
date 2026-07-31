# Stage 1: Build React app
FROM node:22-alpine AS builder
WORKDIR /app

# Don't treat warnings as errors during prod build
ENV CI=false
ENV DISABLE_ESLINT_PLUGIN=true

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
