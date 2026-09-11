# ClipFlow Clipper Service

Self-hosted YouTube clip renderer. Deploy on Railway or any Docker host.

## Endpoints

- GET /health - returns ok status
- POST /clip - JSON body with url, start, end, orientation. Returns a trimmed video/mp4 with audio.

## Deploy on Railway

1. Deploy this repo to Railway (auto-detects Dockerfile, installs ffmpeg + yt-dlp).
2. Set CLIPPER_SERVICE_TOKEN env var to a random string for auth.
3. Railway gives you a public URL.

The service uses yt-dlp to download only the requested section and ffmpeg to re-encode with audio. Vertical orientation produces 1080x1920, horizontal produces 1920x1080.
