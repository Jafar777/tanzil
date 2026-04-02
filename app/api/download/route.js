// app/api/download/route.js
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

const ytdlpPath = path.join(process.cwd(), "yt-dlp.exe");

// ---------- Helper: cookies file ----------
function getCookiesFile() {
  const cookiesPath = path.join(process.cwd(), "cookies.txt");
  return fs.existsSync(cookiesPath) ? cookiesPath : null;
}

// ---------- Helper: detect Spotify ----------
function isSpotifyUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes('spotify.com');
  } catch {
    return false;
  }
}

// ---------- Clean YouTube URL ----------
function cleanYouTubeUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
      if (urlObj.hostname === 'youtu.be') {
        const videoId = urlObj.pathname.slice(1);
        if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
    return url;
  } catch {
    return url;
  }
}

// ---------- Get video info (with cookies) ----------
async function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = ["-j", url];
    const cookiesFile = getCookiesFile();
    if (cookiesFile) args.unshift("--cookies", cookiesFile);

    const proc = spawn(ytdlpPath, args, { shell: true });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("yt-dlp timed out after 30 seconds"));
    }, 30000);
    proc.stdout.on("data", (data) => (stdout += data));
    proc.stderr.on("data", (data) => (stderr += data));
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      else resolve(JSON.parse(stdout));
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ---------- Download a format to temp file (with cookies) ----------
async function downloadToTempFile(url, formatId) {
  const tempFile = path.join(os.tmpdir(), `ytdl_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);
  return new Promise((resolve, reject) => {
    const args = ["-f", formatId, "-o", tempFile, url];
    const cookiesFile = getCookiesFile();
    if (cookiesFile) args.unshift("--cookies", cookiesFile);

    const proc = spawn(ytdlpPath, args, { shell: true });
    proc.on("close", (code) => {
      if (code === 0) resolve(tempFile);
      else reject(new Error(`Download failed for format ${formatId}`));
    });
    proc.on("error", reject);
  });
}

// ---------- Main API route ----------
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let url = searchParams.get("url");
  const formatId = searchParams.get("formatId");

  if (!url) return NextResponse.json({ error: "No URL provided" }, { status: 400 });
  url = cleanYouTubeUrl(url);

  // Block Spotify (DRM protected)
  if (isSpotifyUrl(url)) {
    return NextResponse.json(
      { error: "Spotify tracks are DRM protected and cannot be downloaded. Please use YouTube or other supported platforms." },
      { status: 400 }
    );
  }

  try {
    if (formatId) {
      const info = await getVideoInfo(url);
      const selectedFormat = info.formats.find(f => f.format_id === formatId);
      if (!selectedFormat) {
        return NextResponse.json({ error: "Format not found" }, { status: 400 });
      }

      const safeTitle = info.title.replace(/[^a-z0-9]/gi, '_');
      
      // If format already has audio → stream directly
      if (selectedFormat.acodec !== "none") {
        const args = ["-f", formatId, "-o", "-", url];
        const cookiesFile = getCookiesFile();
        if (cookiesFile) args.unshift("--cookies", cookiesFile);

        const ytProcess = spawn(ytdlpPath, args, { shell: true });
        const stream = new ReadableStream({
          start(controller) {
            ytProcess.stdout.on("data", chunk => controller.enqueue(chunk));
            ytProcess.stdout.on("end", () => controller.close());
            ytProcess.stderr.on("data", chunk => console.error("yt-dlp stderr:", chunk.toString()));
            ytProcess.on("error", err => controller.error(err));
          },
          cancel() { ytProcess.kill(); }
        });
        return new Response(stream, {
          headers: {
            "Content-Disposition": `attachment; filename="${safeTitle}.mp4"`,
            "Content-Type": "video/mp4",
          },
        });
      } 
      // Video‑only → download to temp files and merge with ffmpeg
      else {
        // Get best audio format (prefer m4a or aac)
        let audioFormat = info.formats
          .filter(f => f.acodec !== "none" && f.vcodec === "none")
          .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
        
        const betterAudio = info.formats.find(f => 
          f.acodec !== "none" && f.vcodec === "none" && (f.ext === 'm4a' || f.ext === 'aac')
        );
        if (betterAudio) audioFormat = betterAudio;
        
        if (!audioFormat) {
          return NextResponse.json({ error: "No audio stream available" }, { status: 500 });
        }

        // Download video and audio to temporary files
        const videoFile = await downloadToTempFile(url, formatId);
        const audioFile = await downloadToTempFile(url, audioFormat.format_id);

        // Merge with ffmpeg and stream output
        const outputFilename = `${safeTitle}.mp4`;
        const ffmpeg = spawn("ffmpeg", [
          "-i", videoFile,
          "-i", audioFile,
          "-c:v", "copy",
          "-c:a", "aac",
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-f", "mp4",
          "-movflags", "frag_keyframe+empty_moov",
          "pipe:1"
        ], { shell: true });

        // Clean up temp files after ffmpeg finishes
        ffmpeg.on("close", () => {
          fs.unlink(videoFile, () => {});
          fs.unlink(audioFile, () => {});
        });
        ffmpeg.on("error", () => {
          fs.unlink(videoFile, () => {});
          fs.unlink(audioFile, () => {});
        });

        const stream = new ReadableStream({
          start(controller) {
            ffmpeg.stdout.on("data", chunk => controller.enqueue(chunk));
            ffmpeg.stdout.on("end", () => controller.close());
            ffmpeg.stderr.on("data", chunk => console.error("ffmpeg:", chunk.toString()));
            ffmpeg.on("error", err => controller.error(err));
          },
          cancel() {
            ffmpeg.kill();
            fs.unlink(videoFile, () => {});
            fs.unlink(audioFile, () => {});
          }
        });

        return new Response(stream, {
          headers: {
            "Content-Disposition": `attachment; filename="${outputFilename}"`,
            "Content-Type": "video/mp4",
          },
        });
      }
    }
    // Return list of formats
    else {
      const info = await getVideoInfo(url);
      const formats = info.formats
        .filter(f => f.vcodec !== "none")
        .map(f => ({
          formatId: f.format_id,
          quality: f.height ? `${f.height}p` : f.format_note || f.quality,
          ext: f.ext,
          filesize: f.filesize,
          hasAudio: f.acodec !== "none",
        }));
      const bestFormat = info.formats.find(f => f.format_id === info.format_id);
      if (bestFormat && !formats.some(f => f.formatId === bestFormat.format_id)) {
        formats.unshift({
          formatId: bestFormat.format_id,
          quality: bestFormat.height ? `${bestFormat.height}p (best)` : "best",
          ext: bestFormat.ext,
          hasAudio: bestFormat.acodec !== "none",
        });
      }
      return NextResponse.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        formats,
      });
    }
  } catch (error) {
    console.error("API error:", error);
    let message = error.message || "Failed to process video";
    // Improve Facebook error message
    if (message.includes("only available for registered users")) {
      message = "This Facebook video requires login. Please export cookies.txt from your browser and place it in the project root folder. See: https://github.com/yt-dlp/yt-dlp#how-do-i-pass-cookies-to-yt-dlp";
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}