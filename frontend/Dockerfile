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

COPY package.json ./
RUN npm i

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]

