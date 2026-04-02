// app/api/download/route.js
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

const ytdlpPath = path.join(process.cwd(), "yt-dlp.exe");

// Clean YouTube URLs: remove playlist, radio, and other extra parameters
function cleanYouTubeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Only clean YouTube URLs
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
      // Handle youtu.be short links
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

// Helper: get video info (JSON) with timeout
async function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, ["-j", url], { shell: true });
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let url = searchParams.get("url");
  const formatId = searchParams.get("formatId");

  if (!url) {
    return NextResponse.json({ error: "No URL provided" }, { status: 400 });
  }

  // Clean the URL before any processing
  url = cleanYouTubeUrl(url);

  try {
    // If formatId is provided → stream the video directly
    if (formatId) {
      const info = await getVideoInfo(url);
      const safeTitle = info.title.replace(/[^a-z0-9]/gi, '_');
      const ext = info.ext || "mp4";

      const ytProcess = spawn(ytdlpPath, ["-f", formatId, "-o", "-", url], { shell: true });

      const stream = new ReadableStream({
        start(controller) {
          ytProcess.stdout.on("data", (chunk) => controller.enqueue(chunk));
          ytProcess.stdout.on("end", () => controller.close());
          ytProcess.stderr.on("data", (chunk) => console.error("yt-dlp stderr:", chunk.toString()));
          ytProcess.on("error", (err) => controller.error(err));
        },
        cancel() {
          ytProcess.kill();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Disposition": `attachment; filename="${safeTitle}.${ext}"`,
          "Content-Type": "video/mp4",
        },
      });
    }

    // Otherwise, return the list of available formats
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
    console.error("yt-dlp error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process video" },
      { status: 500 }
    );
  }
}