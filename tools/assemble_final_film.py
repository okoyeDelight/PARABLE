#!/usr/bin/env python3
"""Deterministic PARABLE final-film assembler.

Consumes a parable-final-film-manifest-v1 JSON file and creates an H.264/AAC MP4.
It does no generative work. It only assembles already accepted visual clips and
approved audio assets, so provider output can never bypass PARABLE's gates.
"""
from __future__ import annotations
import json, os, pathlib, shutil, subprocess, sys, tempfile, urllib.request

def fail(msg: str) -> None:
    raise SystemExit("PARABLE ASSEMBLY BLOCKED: " + msg)

def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)

def download(url: str, dest: pathlib.Path) -> None:
    if not url.startswith(("https://", "http://")):
        fail("all media inputs must be HTTP(S) URLs")
    req = urllib.request.Request(url, headers={"User-Agent": "PARABLE-FinalAssembler/1"})
    with urllib.request.urlopen(req, timeout=90) as r, dest.open("wb") as f:
        shutil.copyfileobj(r, f)

def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: assemble_final_film.py manifest.json output.mp4")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        fail("ffmpeg and ffprobe are required")

    manifest_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    data = json.loads(manifest_path.read_text("utf8"))
    if data.get("manifest_version") != "parable-final-film-manifest-v1":
        fail("unsupported manifest version")
    readiness = data.get("readiness") or {}
    if not readiness.get("ready_to_assemble"):
        fail("manifest is not ready: " + "; ".join(readiness.get("blockers") or []))
    clips = data.get("video_clips") or []
    if not clips:
        fail("manifest contains no accepted clips")

    with tempfile.TemporaryDirectory(prefix="parable-final-") as td:
        root = pathlib.Path(td)
        normalized: list[pathlib.Path] = []
        for i, clip in enumerate(clips):
            source = root / f"clip-{i:04d}.source"
            target = root / f"clip-{i:04d}.mp4"
            download(str(clip["asset_uri"]), source)
            # Normalize every accepted take before concatenation; this avoids
            # codec/timebase incompatibilities between different renderers.
            run([
                "ffmpeg","-y","-i",str(source),
                "-t",str(float(clip.get("duration_seconds") or 6)),
                "-an","-r","24","-vf","scale=1920:1080:force_original_aspect_ratio=decrease,"
                "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                "-c:v","libx264","-preset","medium","-crf","18",str(target)
            ])
            normalized.append(target)

        concat_file = root / "concat.txt"
        concat_file.write_text("".join(f"file '{p.as_posix()}'\n" for p in normalized), "utf8")
        picture = root / "picture.mp4"
        run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(concat_file),"-c","copy",str(picture)])

        layers = data.get("audio_layers") or []
        if layers:
            audio_inputs: list[pathlib.Path] = []
            filter_parts: list[str] = []
            for i, layer in enumerate(layers):
                p = root / f"audio-{i:04d}.source"
                download(str(layer["asset_uri"]), p)
                audio_inputs.append(p)
                delay = max(0, round(float(layer.get("start_seconds") or 0) * 1000))
                gain = float(layer.get("gain_db") or 0)
                filter_parts.append(f"[{i+1}:a]adelay={delay}|{delay},volume={gain}dB[a{i}]")
            mix_inputs = "".join(f"[a{i}]" for i in range(len(layers)))
            filter_parts.append(
                f"{mix_inputs}amix=inputs={len(layers)}:normalize=0,"
                "loudnorm=I=-14:TP=-1.5:LRA=11[aout]"
            )
            cmd=["ffmpeg","-y","-i",str(picture)]
            for p in audio_inputs: cmd += ["-i",str(p)]
            cmd += [
                "-filter_complex",";".join(filter_parts),
                "-map","0:v:0","-map","[aout]",
                "-c:v","copy","-c:a","aac","-b:a","256k",
                "-movflags","+faststart","-shortest",str(output_path)
            ]
            run(cmd)
        else:
            run([
                "ffmpeg","-y","-i",str(picture),
                "-c:v","copy","-movflags","+faststart",str(output_path)
            ])

    print(json.dumps({
        "ok": True,
        "manifest_hash": data.get("manifest_hash"),
        "output": str(output_path),
        "clip_count": len(clips),
        "audio_layer_count": len(data.get("audio_layers") or [])
    }))

if __name__ == "__main__":
    main()
