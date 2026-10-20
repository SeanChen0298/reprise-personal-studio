"""
chord_analyze.py — chord/beat analysis sidecar for Reprise.

Stage 2 skeleton: reads the instrumental stem and records its length, so the
whole path (task queue -> sidecar -> chords.json -> app) can be tested end to
end. Chord, beat and key detection are added on top of this later.

Usage:
    python chord_analyze.py --audio_path "C:/Reprise/<song>/no_vocals.wav" \
                            --output_path "C:/Reprise/<song>/chords.json"

Output JSON (always written, even on failure, so the app can read the reason):
    {
      "version": 1,
      "status": "ok" | "error",
      "analyzed_at": "<ISO 8601 UTC>",
      "source_audio": "<audio_path>",
      "duration_ms": <int>,          # present when status == "ok"
      "message": "<error text>"      # present when status == "error"
    }

All timing is in milliseconds.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

OUTPUT_VERSION = 1


def write_output(output_path: str, payload: dict) -> None:
    # Write to a temp file then rename, so the app never reads a half-written file.
    tmp_path = output_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, output_path)


def analyze(audio_path: str) -> dict:
    import soundfile as sf  # installed alongside Demucs

    info = sf.info(audio_path)
    duration_ms = int(round(info.frames * 1000 / info.samplerate))
    return {"duration_ms": duration_ms}


def main() -> int:
    parser = argparse.ArgumentParser(description="Reprise chord analysis")
    parser.add_argument("--audio_path", required=True, help="Instrumental stem (no_vocals.wav)")
    parser.add_argument("--output_path", required=True, help="Where to write chords.json")
    args = parser.parse_args()

    base = {
        "version": OUTPUT_VERSION,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "source_audio": args.audio_path,
    }

    try:
        if not os.path.isfile(args.audio_path):
            raise FileNotFoundError(f"Audio file not found: {args.audio_path}")
        result = analyze(args.audio_path)
        write_output(args.output_path, {**base, "status": "ok", **result})
        print(f"[chord_analyze] done: {result}")
        return 0
    except Exception as err:  # report every failure through the output file
        message = f"{type(err).__name__}: {err}"
        write_output(args.output_path, {**base, "status": "error", "message": message})
        print(f"[chord_analyze] error: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
