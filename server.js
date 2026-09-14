const express = require("express");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ limit: "1mb" }));

const AUTH_TOKEN = process.env.CLIPPER_SERVICE_TOKEN || "";

// Simple shared-secret auth
function auth(req, res, next) {
  if (!AUTH_TOKEN) return next(); // no token set = open (fine while testing)
  const provided = req.headers["x-clipper-token"];
  if (provided !== AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = execFile(cmd, args, { ...opts, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
    // surface progress in logs
    proc.stderr && proc.stderr.on("data", (d) => process.stdout.write(`[ffmpeg/yt-dlp] ${d}`));
  });
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/clip", auth, async (req, res) => {
  const { url, start, end, orientation } = req.body || {};
  if (!url || start == null || end == null) {
    return res.status(400).json({ error: "url, start, end are required" });
  }
  const startSec = Number(start);
  const endSec = Number(end);
  if (!isFinite(startSec) || !isFinite(endSec) || endSec - startSec < 5) {
    return res.status(400).json({ error: "Clip must be at least 5 seconds long" });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-"));
  const rawPath = path.join(workDir, "raw.mp4");
  const outPath = path.join(workDir, "clip.mp4");

  try {
    // 1. Download just the requested section with audio using yt-dlp
    const section = `*${fmtTime(startSec)}-${fmtTime(endSec)}`;
    await run("yt-dlp", [
      "--download-sections", section,
      "--force-keyframes-at-cuts",
      "-S", "res:720,vcodec:h264",
      "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "--no-warnings",
      "-o", rawPath,
      url
    ]);

    if (!fs.existsSync(rawPath)) {
      throw new Error("Download failed — yt-dlp produced no file");
    }

    // 2. Re-encode with ffmpeg. Vertical (9:16) gets blurred-fill background.
    const isVertical = orientation === "vertical";
    const vf = isVertical
      ? "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
      : "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1";

    await run("ffmpeg", [
      "-y", "-threads", "1", "-i", rawPath,
      "-vf", vf,
      "-r", "30",
      "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outPath
    ]);

    if (!fs.existsSync(outPath)) {
      throw new Error("ffmpeg produced no file");
    }

    const stat = fs.statSync(outPath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="clip-${id}.mp4"`);

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on("end", () => {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    });
  } catch (err) {
    console.error("Clip error:", err.message);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    res.status(500).json({ error: err.message || "Failed to render clip" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`ClipFlow clipper listening on ${PORT}`));