FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production NODE_NO_WARNINGS=1 DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
