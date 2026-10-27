FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV APP_MODE=sample APP_HOST=0.0.0.0
EXPOSE 4317
CMD ["npm", "start"]
