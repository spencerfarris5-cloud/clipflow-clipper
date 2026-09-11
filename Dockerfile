FROM node:20-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates && rm -rf /var/lib/apt/lists/* && pip3 install --no-cache-dir --break-system-packages yt-dlp
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 8080
CMD ["node", "server.js"]
