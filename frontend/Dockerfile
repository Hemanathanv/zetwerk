FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY dist ./dist

EXPOSE 5173

CMD ["serve", "-s", "dist/public", "-l", "5173"]
