FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_BACKEND_API_BASE=
ARG VITE_KEYCLOAK_URL=/keycloak
ARG VITE_KEYCLOAK_REALM=ewms-saas

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_BACKEND_API_BASE=$VITE_BACKEND_API_BASE \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=build /app/dist ./dist

EXPOSE 5173

CMD ["serve", "-s", "dist/public", "-l", "5173"]
