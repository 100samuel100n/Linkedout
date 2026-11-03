// Video/audio transcoding for post & comment attachments — normalizes
// whatever codec/container someone uploaded into a consistent, web- and
// mobile-playable format, and caps resolution/bitrate so a phone-shot
// 4K video doesn't sit in storage (and get downloaded by every viewer)
// at its original size.
//
// Shells out to the system `ffmpeg` binary directly via child_process
// rather than adding a wrapper package (fluent-ffmpeg, etc.) — one
// well-defined CLI invocation doesn't need an abstraction layer, and
// this way there's no extra npm dependency whose exact API surface can't
// be verified. Same graceful-fallback shape as every other optional
// integration in this app: if ffmpeg isn't on PATH, or a specific file
// fails to transcode for any reason, the caller (lib/media.js) keeps the
// original upload untouched — a missing/failing transcoder must never
// block someone from posting.
import { execFile } from "node:child_process"; // sast-ignore: execFile with an argument array, no shell
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 60_000;

let _available = null;

export async function isTranscodingAvailable() {
  if (_available !== null) return _available;
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
}

async function runFfmpeg(args) {
  await execFileAsync("ffmpeg", args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 10 });
}

// Writes `buffer` to a temp file, transcodes it, reads the result back,
// cleans up both temp files, and returns { buffer, ext } — or null if
// ffmpeg isn't available or the transcode fails for any reason (a
// corrupt upload, an exotic codec ffprobe can't read, etc).
async function transcode(buffer, { inputExt, outputExt, buildArgs }) {
  if (!(await isTranscodingAvailable())) return null;

  const tmpDir = os.tmpdir();
  const stamp = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `lo-in-${stamp}.${inputExt}`);
  const outputPath = path.join(tmpDir, `lo-out-${stamp}.${outputExt}`);

  try {
    fs.writeFileSync(inputPath, buffer);
    await runFfmpeg(buildArgs(inputPath, outputPath));
    const outBuffer = fs.readFileSync(outputPath);
    return { buffer: outBuffer, ext: outputExt };
  } catch (e) {
    console.error("[transcode] failed, keeping original file:", e.message);
    return null;
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(outputPath, { force: true });
  }
}

// Caps at 1280px on the longer side (never upscales — "min(1280,iw)"),
// re-encodes to H.264/AAC in an MP4 container with faststart so it can
// begin playing before it's fully downloaded. veryfast/CRF 26 is a
// reasonable size/quality tradeoff for user-generated clips, not a
// mastering-quality encode.
export async function transcodeVideo(buffer, inputExt) {
  return transcode(buffer, {
    inputExt, outputExt: "mp4",
    buildArgs: (inPath, outPath) => [
      "-y", "-i", inPath,
      "-vf", "scale='min(1280,iw)':-2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outPath,
    ],
  });
}

// Voice notes / audio attachments: mono AAC at a modest bitrate — plenty
// for speech, a fraction of the size of an uncompressed or high-bitrate
// original.
export async function transcodeAudio(buffer, inputExt) {
  return transcode(buffer, {
    inputExt, outputExt: "m4a",
    buildArgs: (inPath, outPath) => [
      "-y", "-i", inPath,
      "-c:a", "aac", "-b:a", "96k", "-ac", "1",
      outPath,
    ],
  });
}
