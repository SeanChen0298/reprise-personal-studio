#!/usr/bin/env python3
"""
whisperx_align.py — WhisperX forced alignment for Reprise

Transcribes a song's audio with WhisperX and maps the resulting word-level
timestamps back to the user's pre-defined lyric lines.

Usage:
    python whisperx_align.py \
        --audio_path   "C:/Reprise/SongName/vocals.wav" \
        --lines_path   "C:/Reprise/SongName/lines_input.json" \
        --output_path  "C:/Reprise/SongName/align_output.json" \
        --language     "ja" \
        --model        "large-v2"

Input JSON (lines_path):
    [{"order": 0, "text": "...", "custom_text": "..."}, ...]

Output JSON (output_path) on success:
    {"status": "ok", "lines": [{"order": N, "start_ms": X, "end_ms": Y, "confidence": F}], "unmatched_lines": [...]}
Output JSON on error:
    {"status": "error", "message": "..."}
"""

import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------

def katakana_to_hiragana(text: str) -> str:
    """Convert full-width katakana (U+30A1–U+30F6) to hiragana."""
    return "".join(
        chr(ord(c) - 0x60) if "\u30a1" <= c <= "\u30f6" else c
        for c in text
    )


def normalize_text(text: str, language: str) -> str:
    """Strip punctuation and whitespace; lowercase for non-CJK languages.
    For Japanese, also convert katakana to hiragana so lyrics and WhisperX
    output are compared in the same script."""
    # Remove common punctuation and symbols, keep CJK characters
    text = re.sub(r"[^\w\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]", "", text, flags=re.UNICODE)
    text = re.sub(r"\s+", "", text)
    if language == "ja":
        text = katakana_to_hiragana(text)
    elif language not in ("zh", "ko"):
        text = text.lower()
    return text


# ---------------------------------------------------------------------------
# Word list flattening
# ---------------------------------------------------------------------------

def flatten_words(segments: list, language: str) -> list:
    """
    Flatten all WhisperX segments into a single list of timed tokens.
    Each entry: {"text": str, "start": float, "end": float, "score": float}

    WhisperX may omit "start"/"end" for tokens it couldn't align (silence,
    noise, etc.) — those are skipped.
    """
    flat: list = []
    for seg in segments:
        words = seg.get("words", [])
        for w in words:
            if "start" not in w or "end" not in w:
                continue
            raw = w.get("word") or w.get("char") or ""
            norm = normalize_text(raw, language)
            if not norm:
                continue
            flat.append({
                "text": norm,
                "start": float(w["start"]),
                "end": float(w["end"]),
                "score": float(w.get("score", 0.0)),
            })
    return flat


# ---------------------------------------------------------------------------
# Sliding-window matching
# ---------------------------------------------------------------------------

def similarity(a: str, b: str) -> float:
    """
    Character-level similarity using longest-common-subsequence ratio.
    Handles insertions/deletions gracefully — much better than positional
    matching for languages where transcription may differ from written lyrics.
    """
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def find_best_window(
    norm_line: str,
    flat_words: list,
    cursor: int,
    language: str,
    lookahead: int = 150,
    min_score: float = 0.40,
) -> tuple:
    """
    Search for the contiguous slice of flat_words whose concatenated normalised
    text best matches norm_line.

    Returns (start_idx, end_idx_exclusive, score) or (-1, -1, 0.0) on failure.
    """
    target_len = len(norm_line)
    best_score = 0.0
    best_start = -1
    best_end = -1
    limit = min(cursor + lookahead, len(flat_words))

    for i in range(cursor, limit):
        accumulated = ""
        for j in range(i, limit):
            accumulated += flat_words[j]["text"]
            ratio = len(accumulated) / target_len if target_len else 0
            if ratio < 0.45:
                continue
            if ratio > 2.0:
                break
            score = similarity(norm_line, accumulated)
            if score > best_score:
                best_score = score
                best_start = i
                best_end = j + 1

    if best_score >= min_score:
        return best_start, best_end, best_score
    return -1, -1, 0.0


# ---------------------------------------------------------------------------
# Line → timestamp mapping
# ---------------------------------------------------------------------------

def map_lines_to_timestamps(lines: list, segments: list, language: str) -> tuple:
    """
    Returns:
        matched  — list of {"order", "start_ms", "end_ms", "confidence"}
        unmatched — list of order values that could not be matched
    """
    flat = flatten_words(segments, language)

    if not flat:
        raise ValueError(
            "WhisperX produced no word-level timestamps. "
            "Check that the alignment model loaded correctly and that the "
            "audio contains intelligible speech."
        )

    matched: list = []
    unmatched: list = []
    cursor = 0

    for line in lines:
        # Prefer hiragana reading (extracted from furigana HTML on the TS side)
        # so kanji lyrics match WhisperX's hiragana output.
        raw_text = (line.get("reading") or line.get("custom_text") or line.get("text") or "").strip()
        if not raw_text:
            unmatched.append(line["order"])
            continue

        norm_line = normalize_text(raw_text, language)
        if not norm_line:
            unmatched.append(line["order"])
            continue

        # Allow back-tracking to handle a previous unmatched line
        effective_cursor = max(0, cursor - 15)
        start_idx, end_idx, score = find_best_window(norm_line, flat, effective_cursor, language)

        if start_idx == -1:
            unmatched.append(line["order"])
            continue

        start_ms = round(flat[start_idx]["start"] * 1000)
        end_ms = round(flat[end_idx - 1]["end"] * 1000)

        matched.append({
            "order": line["order"],
            "start_ms": start_ms,
            "end_ms": end_ms,
            "confidence": round(score, 3),
        })
        cursor = end_idx  # advance past matched tokens

    # Post-process: link adjacent matched lines so prev.end_ms == next.start_ms
    # Only link when the gap is small (< 3 s) to avoid clobbering intentional gaps.
    for k in range(1, len(matched)):
        prev = matched[k - 1]
        curr = matched[k]
        gap_ms = curr["start_ms"] - prev["end_ms"]
        if 0 <= gap_ms < 3000:
            prev["end_ms"] = curr["start_ms"]

    return matched, unmatched


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="WhisperX forced alignment for Reprise")
    parser.add_argument("--audio_path",  required=True,  help="Path to audio file (WAV/M4A)")
    parser.add_argument("--lines_path",  required=True,  help="Path to lines_input.json")
    parser.add_argument("--output_path", required=True,  help="Path to write align_output.json")
    parser.add_argument("--language",    default="en",   help="ISO 639-1 language code (e.g. ja, en, ko)")
    parser.add_argument("--model",       default="large-v2", help="Whisper model size")
    parser.add_argument("--device",      default="cpu",  help="'cpu' or 'cuda'")
    parser.add_argument("--batch_size",  type=int, default=16)
    parser.add_argument("--compute_type", default="int8", help="'int8' (CPU) or 'float16' (GPU)")
    args = parser.parse_args()

    output_path = Path(args.output_path)

    def write_error(message: str) -> None:
        output_path.write_text(
            json.dumps({"status": "error", "message": message}),
            encoding="utf-8",
        )

    # --- Load lines input ---------------------------------------------------
    try:
        lines_data: list = json.loads(Path(args.lines_path).read_text(encoding="utf-8"))
    except Exception as exc:
        write_error(f"Failed to read lines input: {exc}")
        sys.exit(1)

    # Keep only lines with actual lyric text (skip blank / translation stubs)
    lines = [l for l in lines_data if (l.get("custom_text") or l.get("text") or "").strip()]
    if not lines:
        write_error("No lyric lines found in input (all lines are blank).")
        sys.exit(1)

    # --- Import WhisperX ----------------------------------------------------
    try:
        import whisperx  # type: ignore
        import torch     # type: ignore
    except ImportError as exc:
        write_error(
            f"whisperx is not installed. Run: pip install whisperx\nDetail: {exc}"
        )
        sys.exit(1)

    # Auto-downgrade to CPU if CUDA requested but unavailable
    device = args.device
    compute_type = args.compute_type
    if device == "cuda" and not torch.cuda.is_available():
        print("[whisperx_align] CUDA not available, falling back to CPU.", flush=True)
        device = "cpu"
        compute_type = "int8"

    # Stable cache directory so models are never re-downloaded
    cache_dir = str(Path.home() / ".cache" / "huggingface" / "hub")
    Path(cache_dir).mkdir(parents=True, exist_ok=True)

    # --- ASR (transcription) ------------------------------------------------
    try:
        print(f"[whisperx_align] Loading model '{args.model}' on {device} ({compute_type})…", flush=True)
        model = whisperx.load_model(
            args.model,
            device=device,
            compute_type=compute_type,
            language=args.language if args.language != "auto" else None,
            download_root=cache_dir,
        )

        print(f"[whisperx_align] Loading audio: {args.audio_path}", flush=True)
        audio = whisperx.load_audio(args.audio_path)

        print("[whisperx_align] Transcribing…", flush=True)
        result = model.transcribe(
            audio,
            batch_size=args.batch_size,
            language=args.language if args.language != "auto" else None,
        )

        # Free model memory before loading alignment model
        del model
        if device == "cuda":
            torch.cuda.empty_cache()

    except Exception as exc:
        write_error(f"WhisperX transcription failed: {exc}")
        sys.exit(1)

    # --- Forced alignment ---------------------------------------------------
    try:
        detected_lang = result.get("language") or args.language
        print(f"[whisperx_align] Loading alignment model for language: {detected_lang}", flush=True)

        align_model, metadata = whisperx.load_align_model(
            language_code=detected_lang,
            device=device,
            model_dir=cache_dir,
        )

        print("[whisperx_align] Running forced alignment…", flush=True)
        aligned = whisperx.align(
            result["segments"],
            align_model,
            metadata,
            audio,
            device=device,
            return_char_alignments=(detected_lang in ("ja", "zh", "ko")),
        )

        del align_model
        if device == "cuda":
            torch.cuda.empty_cache()

    except Exception as exc:
        write_error(
            f"WhisperX forced alignment failed: {exc}. "
            "The wav2vec2 alignment model for this language may not be available. "
            "Try: pip install transformers>=4.30"
        )
        sys.exit(1)

    # --- Map timestamps to lyric lines --------------------------------------
    try:
        print("[whisperx_align] Mapping timestamps to lyric lines…", flush=True)
        matched, unmatched = map_lines_to_timestamps(
            lines=lines,
            segments=aligned["segments"],
            language=args.language,
        )
    except Exception as exc:
        write_error(f"Line mapping failed: {exc}")
        sys.exit(1)

    # --- Write output -------------------------------------------------------
    output = {
        "status": "ok",
        "lines": matched,
        "unmatched_lines": unmatched,
    }
    output_path.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")

    print(
        f"[whisperx_align] Done. Matched {len(matched)} lines, "
        f"unmatched orders: {unmatched}",
        flush=True,
    )


if __name__ == "__main__":
    main()
