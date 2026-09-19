#!/usr/bin/env python3
from __future__ import annotations
import functools
import http.server
import json
import pathlib
import subprocess
import tempfile
import threading

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSEMBLER = ROOT / "tools" / "assemble_final_film.py"

def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def probe(path: pathlib.Path) -> dict:
    raw = subprocess.check_output([
        "ffprobe","-v","error","-show_streams","-show_format","-of","json",str(path)
    ])
    return json.loads(raw)

with tempfile.TemporaryDirectory(prefix="parable-assembler-smoke-") as td:
    root = pathlib.Path(td)
    clip1 = root / "clip1.mp4"
    clip2 = root / "clip2.mp4"
    dialogue = root / "dialogue.wav"

    run([
        "ffmpeg","-y","-f","lavfi","-i","color=c=black:s=320x180:r=24:d=1",
        "-an","-c:v","libx264","-pix_fmt","yuv420p",str(clip1)
    ])
    run([
        "ffmpeg","-y","-f","lavfi","-i","color=c=white:s=320x180:r=24:d=1",
        "-an","-c:v","libx264","-pix_fmt","yuv420p",str(clip2)
    ])
    run([
        "ffmpeg","-y","-f","lavfi","-i","sine=frequency=440:duration=1.8",
        "-ar","48000","-ac","2",str(dialogue)
    ])

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]

    try:
        manifest = {
            "manifest_version": "parable-final-film-manifest-v1",
            "manifest_hash": "smoke-manifest",
            "readiness": {"ready_to_assemble": True, "blockers": [], "warnings": []},
            "video_clips": [
                {"asset_uri": f"http://127.0.0.1:{port}/clip1.mp4", "duration_seconds": 1},
                {"asset_uri": f"http://127.0.0.1:{port}/clip2.mp4", "duration_seconds": 1}
            ],
            "audio_layers": [
                {
                    "cue_id": "dialogue_001",
                    "kind": "dialogue",
                    "asset_uri": f"http://127.0.0.1:{port}/dialogue.wav",
                    "start_seconds": 0,
                    "duration_seconds": 1.8,
                    "gain_db": 0,
                    "required_for_final": True
                }
            ],
            "captions": [],
            "output": {
                "container": "mp4",
                "video_codec": "h264",
                "audio_codec": "aac",
                "fps": 24,
                "pixel_format": "yuv420p",
                "faststart": True,
                "integrated_lufs": -14,
                "true_peak_dbtp": -1.5
            }
        }
        manifest_path = root / "manifest.json"
        output_path = root / "final.mp4"
        manifest_path.write_text(json.dumps(manifest), "utf8")

        result = subprocess.run(
            ["python3", str(ASSEMBLER), str(manifest_path), str(output_path)],
            check=True, capture_output=True, text=True
        )
        report = json.loads(result.stdout.strip().splitlines()[-1])
        assert report["ok"] is True
        assert report["clip_count"] == 2
        assert report["audio_layer_count"] == 1
        assert output_path.exists() and output_path.stat().st_size > 1000

        info = probe(output_path)
        codecs = {stream.get("codec_type"): stream.get("codec_name") for stream in info.get("streams", [])}
        assert codecs.get("video") == "h264", codecs
        assert codecs.get("audio") == "aac", codecs
        duration = float(info.get("format", {}).get("duration") or 0)
        assert 1.5 <= duration <= 2.3, duration

        print(json.dumps({
            "ok": True,
            "video_codec": codecs.get("video"),
            "audio_codec": codecs.get("audio"),
            "duration_seconds": duration,
            "bytes": output_path.stat().st_size
        }, indent=2))
    finally:
        server.shutdown()
        server.server_close()
