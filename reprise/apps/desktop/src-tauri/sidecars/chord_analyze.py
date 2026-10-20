"""
chord_analyze.py — chord/beat/key analysis sidecar for Reprise.

Runs on the instrumental stem (no_vocals.wav) and writes chords.json into the
song folder. Uses only librosa / numpy / scipy, which are already installed
alongside Demucs, so it works offline with no model downloads.

How it works (plain words):
  - Beats: librosa's beat tracker on the percussive part of the instrumental.
  - Chords: for every beat, measure how much of each of the 12 pitch classes
    is sounding (a "chroma" vector from the harmonic part), compare it with
    simple chord templates (major, minor, 7, m7), then smooth the choice over
    time with a Viterbi pass so chords don't flicker beat to beat.
  - Key: correlate the song's overall chroma with the Krumhansl-Kessler key
    profiles (a standard music-psychology method).
  - Bars: chord changes mostly land on bar lines, so we pick the meter (3 or
    4 beats) and bar offset that line up best with the chord changes.

Usage:
    python chord_analyze.py --audio_path "C:/Reprise/<song>/no_vocals.wav" \
                            --output_path "C:/Reprise/<song>/chords.json"

All timing in the output is in milliseconds.
"""

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone

OUTPUT_VERSION = 4

SR = 22050
HOP = 512

PITCH_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PITCH_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Chord qualities: (suffix, intervals, weights). 7ths get a slightly lower
# prior below, because template matching otherwise over-picks them.
QUALITIES = [
    ("",   [0, 4, 7],     [1.0, 0.8, 0.9]),
    ("m",  [0, 3, 7],     [1.0, 0.8, 0.9]),
    ("7",  [0, 4, 7, 10], [1.0, 0.8, 0.9, 0.6]),
    ("m7", [0, 3, 7, 10], [1.0, 0.8, 0.9, 0.6]),
]
SEVENTH_PRIOR = 0.94

# Krumhansl-Kessler key profiles.
KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

# Keys conventionally spelled with flats.
FLAT_MAJOR_TONICS = {5, 10, 3, 8, 1, 6}       # F Bb Eb Ab Db Gb
FLAT_MINOR_TONICS = {2, 7, 0, 5, 10, 3}       # D G C F Bb Eb minor


def write_output(output_path: str, payload: dict) -> None:
    # Write to a temp file then rename, so the app never reads a half-written file.
    tmp_path = output_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, output_path)


def to_ms(seconds) -> int:
    return int(round(float(seconds) * 1000))


# ---------------------------------------------------------------------------
# Key
# ---------------------------------------------------------------------------

def detect_key(chroma_mean):
    import numpy as np

    best = None
    for mode, profile in (("major", KK_MAJOR), ("minor", KK_MINOR)):
        prof = np.array(profile)
        for tonic in range(12):
            r = np.corrcoef(chroma_mean, np.roll(prof, tonic))[0, 1]
            if best is None or r > best[0]:
                best = (r, tonic, mode)
    r, tonic, mode = best
    use_flats = tonic in (FLAT_MAJOR_TONICS if mode == "major" else FLAT_MINOR_TONICS)
    names = PITCH_NAMES_FLAT if use_flats else PITCH_NAMES_SHARP
    return {
        "tonic": names[tonic],
        "tonic_pc": tonic,
        "mode": mode,
        "name": f"{names[tonic]} {mode}",
        "confidence": round(float(max(r, 0.0)), 3),
    }, names


# ---------------------------------------------------------------------------
# Chords
# ---------------------------------------------------------------------------

def build_templates():
    import numpy as np

    labels, roots, quals, temps, priors = [], [], [], [], []
    for qi, (suffix, intervals, weights) in enumerate(QUALITIES):
        for root in range(12):
            t = np.zeros(12)
            for iv, w in zip(intervals, weights):
                t[(root + iv) % 12] = w
            temps.append(t / np.linalg.norm(t))
            labels.append(suffix)
            roots.append(root)
            quals.append(suffix)
            priors.append(SEVENTH_PRIOR if suffix in ("7", "m7") else 1.0)
    return np.array(temps), roots, quals, np.array(priors)


def detect_chords(beat_chroma, beat_times, duration_s, names):
    """Return a list of chord segments snapped to beats."""
    import numpy as np
    import librosa

    templates, roots, quals, priors = build_templates()
    n_states = len(templates) + 1  # + "N" (no chord)

    energy = beat_chroma.sum(axis=0)
    norm = beat_chroma / (np.linalg.norm(beat_chroma, axis=0, keepdims=True) + 1e-9)
    sims = (templates @ norm) * priors[:, None]           # (48, n_beats)

    # "No chord" scores high only where the beat is near-silent.
    quiet = energy < (0.08 * np.median(energy) + 1e-9)
    n_score = np.where(quiet, 1.0, 0.35)[None, :]
    scores = np.vstack([sims, n_score])

    # Turn similarities into probabilities, then smooth over time.
    temperature = 0.06
    probs = np.exp((scores - scores.max(axis=0, keepdims=True)) / temperature)
    probs /= probs.sum(axis=0, keepdims=True)
    transition = librosa.sequence.transition_loop(n_states, 0.82)
    path = librosa.sequence.viterbi(probs, transition)

    def label_for(state):
        if state == n_states - 1:
            return {"label": "N", "root": None, "root_pc": None, "quality": "N"}
        root, qual = roots[state], quals[state]
        return {"label": names[root] + qual, "root": names[root], "root_pc": root, "quality": qual or "maj"}

    # Beat boundaries: beat i spans beat_times[i] .. beat_times[i+1].
    bounds = list(beat_times) + [duration_s]
    segments = []
    for i, state in enumerate(path):
        start, end = bounds[i], bounds[i + 1]
        conf = float(probs[state, i])
        if segments and segments[-1]["_state"] == state:
            seg = segments[-1]
            seg["end_ms"] = to_ms(end)
            seg["_conf"].append(conf)
            seg["beats"] += 1
        else:
            segments.append({
                "_state": int(state),
                "start_ms": to_ms(start),
                "end_ms": to_ms(end),
                "beats": 1,
                "_conf": [conf],
                **label_for(state),
            })

    for seg in segments:
        seg["confidence"] = round(float(np.mean(seg.pop("_conf"))), 3)
        seg.pop("_state")
    return segments, path, n_states


# ---------------------------------------------------------------------------
# Meter and bars
# ---------------------------------------------------------------------------

def detect_meter(path, onset_at_beats):
    """Pick beats-per-bar (3 or 4) and the bar offset that best match chord changes.

    Chord changes and strong onsets both tend to fall on beat 1 of a bar.
    4/4 gets a small prior because it is far more common in pop.
    """
    import numpy as np

    n = len(path)
    changes = np.zeros(n)
    changes[0] = 1
    changes[1:] = (np.diff(path) != 0).astype(float)
    onset = onset_at_beats / (onset_at_beats.max() + 1e-9)

    best = None
    for meter, prior in ((4, 1.0), (3, 0.85)):
        for phase in range(meter):
            idx = np.arange(phase, n, meter)
            if len(idx) == 0:
                continue
            # How much more often chord changes land on this "beat 1" than chance
            # would give (a 3-beat grid catches more changes by chance than a
            # 4-beat one, so compare each against its own chance rate).
            change_lift = changes[idx].sum() / (changes.sum() + 1e-9) * meter
            onset_lift = onset[idx].mean() / (onset.mean() + 1e-9)
            score = (change_lift * 0.8 + onset_lift * 0.2) * prior
            if best is None or score > best[0]:
                best = (score, meter, phase)
    _, meter, phase = best
    return meter, phase


def build_bars(beat_times, meter, phase, duration_s):
    bars = []
    starts = list(range(phase, len(beat_times), meter))
    # A partial pickup bar before the first downbeat, if any.
    if phase > 0:
        starts = [0] + starts
    for bi, b in enumerate(starts):
        nxt = starts[bi + 1] if bi + 1 < len(starts) else None
        end_s = beat_times[nxt] if nxt is not None else duration_s
        bars.append({
            "index": bi,
            "start_ms": to_ms(beat_times[b]),
            "end_ms": to_ms(end_s),
            "first_beat": int(b),
            "beats": int((nxt if nxt is not None else len(beat_times)) - b),
            "pickup": bool(phase > 0 and bi == 0),
        })
    return bars


# ---------------------------------------------------------------------------
# Strumming (stage 4)
# ---------------------------------------------------------------------------

STRUM_BLOCK_BARS = 4        # detect one pattern per 4-bar block
STRUM_HIT_THRESHOLD = 0.45  # slot counts as a strum above this share of the bar's peak
STRUM_MIN_CONFIDENCE = 0.22


def common_pattern(meter: int, tempo: float) -> str:
    """Fallback strum patterns, one character per eighth note (D = down, U = up, - = rest)."""
    if meter == 3:
        return "D-DUDU"
    if tempo >= 140:
        return "D-D-D-D-"   # eighth-note ups get hard to play at fast tempos
    return "D-DU-UDU"


def detect_strumming(y_perc, sr, beat_times, bars, meter, tempo):
    """Detect a down/up strum pattern per 4-bar block from the instrumental's rhythm.

    For each bar we sample how hard the percussive part hits on every eighth
    note. On-beat eighths become D, off-beat eighths become U. When the
    rhythm is too flat to read, we fall back to a common pattern for the
    tempo and meter and mark it as a suggestion.
    """
    import numpy as np
    import librosa

    hop = 256
    env = librosa.onset.onset_strength(y=y_perc, sr=sr, hop_length=hop)
    env_times = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=hop)
    window = 0.04

    def strength_at(t):
        lo, hi = np.searchsorted(env_times, [t - window, t + window])
        return float(env[lo:max(hi, lo + 1)].max()) if lo < len(env) else 0.0

    slots = meter * 2
    bar_vectors = {}
    for bar in bars:
        if bar["pickup"] or bar["beats"] != meter:
            continue
        b0 = bar["first_beat"]
        if b0 + meter >= len(beat_times):
            continue
        vec = []
        for k in range(meter):
            t0, t1 = beat_times[b0 + k], beat_times[b0 + k + 1]
            vec.append(strength_at(t0))
            vec.append(strength_at((t0 + t1) / 2))
        vec = np.array(vec)
        if vec.max() > 0:
            bar_vectors[bar["index"]] = vec / vec.max()

    fallback = common_pattern(meter, tempo)
    full_bars = [b for b in bars if not b["pickup"]]
    blocks = []
    for i in range(0, len(full_bars), STRUM_BLOCK_BARS):
        block = full_bars[i:i + STRUM_BLOCK_BARS]
        vecs = [bar_vectors[b["index"]] for b in block if b["index"] in bar_vectors]
        pattern, source, confidence = fallback, "suggested", None
        if vecs:
            avg = np.mean(vecs, axis=0)
            hits = avg > STRUM_HIT_THRESHOLD
            if hits.all():
                clarity = float(avg.min())             # straight eighths: every slot strong
            elif hits.any():
                clarity = float(avg[hits].mean() - avg[~hits].mean())
            else:
                clarity = 0.0
            detected = "".join(
                ("D" if j % 2 == 0 else "U") if hits[j] else "-" for j in range(slots)
            )
            # A believable strum starts on the beat and has a few strokes.
            if clarity >= STRUM_MIN_CONFIDENCE and hits[0] and hits.sum() >= 3:
                pattern, source, confidence = detected, "detected", round(clarity, 3)
        blocks.append({
            "start_bar": block[0]["index"],
            "end_bar": block[-1]["index"],
            "start_ms": block[0]["start_ms"],
            "end_ms": block[-1]["end_ms"],
            "pattern": pattern,
            "source": source,
            "confidence": confidence,  # None for suggestions
        })

    # Songs usually keep one main strum. Snap detected patterns that differ
    # from the most common one by a single stroke onto it, so the sheet is
    # not split into many near-identical sections.
    # A block we could not read gets the song's own main pattern as its
    # suggestion, rather than a generic one, when the song has one.
    detected_counts = Counter(b["pattern"] for b in blocks if b["source"] == "detected")
    main_pattern = detected_counts.most_common(1)[0][0] if detected_counts else fallback
    for b in blocks:
        if b["source"] == "detected":
            if sum(x != y for x, y in zip(b["pattern"], main_pattern)) <= 1:
                b["pattern"] = main_pattern
        else:
            b["pattern"] = main_pattern

    # Merge neighbouring blocks with the same pattern. A section counts as
    # detected when most of its bars were read from the audio.
    sections = []
    for blk in blocks:
        n_bars = blk["end_bar"] - blk["start_bar"] + 1
        detected_bars = n_bars if blk["source"] == "detected" else 0
        conf = [blk["confidence"]] if blk["confidence"] is not None else []
        prev = sections[-1] if sections else None
        if prev and prev["pattern"] == blk["pattern"]:
            prev["end_bar"] = blk["end_bar"]
            prev["end_ms"] = blk["end_ms"]
            prev["_bars"] += n_bars
            prev["_detected_bars"] += detected_bars
            prev["_conf"] += conf
        else:
            sections.append({**blk, "_bars": n_bars, "_detected_bars": detected_bars, "_conf": conf})

    for sec in sections:
        bars_total, detected_bars, conf = sec.pop("_bars"), sec.pop("_detected_bars"), sec.pop("_conf")
        sec["source"] = "detected" if detected_bars * 2 >= bars_total else "suggested"
        sec["confidence"] = round(sum(conf) / len(conf), 3) if conf and sec["source"] == "detected" else None

    return {
        "subdivision": 2,  # pattern characters per beat (eighth notes)
        "main_pattern": main_pattern,
        "main_pattern_source": "detected" if detected_counts else "suggested",
        "sections": sections,
    }


# ---------------------------------------------------------------------------
# Capo (stage 4)
# ---------------------------------------------------------------------------

# Chord shapes most players can play without a barre.
OPEN_SHAPES = {
    "C", "A", "G", "E", "D", "Am", "Em", "Dm",
    "C7", "A7", "G7", "E7", "D7", "B7", "Am7", "Em7", "Dm7",
}
MAX_CAPO = 7


def suggest_capo(chords):
    """Pick the capo fret whose chord shapes need the fewest barre chords.

    Each chord's shape is the chord moved down by the capo fret. Every chord
    is weighted by how long it is played, and each fret adds a tiny cost so a
    capo is only suggested when it genuinely helps.
    """
    played = [c for c in chords if c["root_pc"] is not None]
    total = sum(c["end_ms"] - c["start_ms"] for c in played) or 1

    def shape_name(chord, capo):
        suffix = "" if chord["quality"] == "maj" else chord["quality"]
        return PITCH_NAMES_SHARP[(chord["root_pc"] - capo) % 12] + suffix

    def barre_share(capo):
        hard = sum(
            c["end_ms"] - c["start_ms"] for c in played if shape_name(c, capo) not in OPEN_SHAPES
        )
        return hard / total

    _, best = min((barre_share(c) + 0.015 * c, c) for c in range(MAX_CAPO + 1))
    if barre_share(best) >= barre_share(0) - 0.05:
        best = 0  # not worth a capo

    shapes = {}
    for c in played:
        shapes.setdefault(c["label"], shape_name(c, best))
    return {
        "fret": best,
        "shapes": shapes,
        "barre_share_no_capo": round(barre_share(0), 3),
        "barre_share_with_capo": round(barre_share(best), 3),
    }


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze(audio_path: str) -> dict:
    import numpy as np
    import librosa

    y, sr = librosa.load(audio_path, sr=SR, mono=True)
    duration_s = len(y) / sr
    if duration_s < 5:
        raise ValueError("Audio is too short to analyse (under 5 seconds)")

    y_harm, y_perc = librosa.effects.hpss(y)

    # Beats
    onset_env = librosa.onset.onset_strength(y=y_perc, sr=sr, hop_length=HOP)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=HOP, trim=False
    )
    tempo = float(np.atleast_1d(tempo)[0])
    if len(beat_frames) < 8:
        raise ValueError("Could not find a steady beat in this song")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)

    # Chroma, one vector per beat
    chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr, hop_length=HOP)
    sync_frames = librosa.util.fix_frames(beat_frames, x_min=0, x_max=chroma.shape[1])
    beat_chroma = librosa.util.sync(chroma, sync_frames, aggregate=np.median)
    # fix_frames adds a segment before the first beat; drop it so columns == beats.
    if beat_chroma.shape[1] == len(beat_frames) + 1:
        beat_chroma = beat_chroma[:, 1:]
    beat_chroma = beat_chroma[:, : len(beat_frames)]

    key, names = detect_key(chroma.mean(axis=1))
    chords, path, _ = detect_chords(beat_chroma, beat_times, duration_s, names)

    onset_at_beats = onset_env[np.clip(beat_frames, 0, len(onset_env) - 1)]
    meter, phase = detect_meter(path, onset_at_beats)
    bars = build_bars(beat_times, meter, phase, duration_s)
    strumming = detect_strumming(y_perc, sr, beat_times, bars, meter, tempo)
    capo = suggest_capo(chords)

    return {
        "duration_ms": to_ms(duration_s),
        "tempo_bpm": round(tempo, 1),
        "key": key,
        "time_signature": {"beats_per_bar": meter, "beat_unit": 4},
        "beats_ms": [to_ms(t) for t in beat_times],
        "bars": bars,
        "chords": chords,
        "strumming": strumming,
        "capo": capo,
    }


def add_fingerstyle(result: dict, pitch_path, output_path: str, title: str) -> None:
    """Stage 6: arrange for solo guitar when the vocal pitch track exists.

    A failure here never fails the chord analysis — it is reported inside
    result["fingerstyle"] instead.
    """
    if not pitch_path:
        result["fingerstyle"] = {"status": "skipped", "message": "Pitch analysis has not been run yet"}
        return
    if not os.path.isfile(pitch_path):
        result["fingerstyle"] = {"status": "skipped", "message": f"Pitch data not found: {pitch_path}"}
        return
    try:
        from fingerstyle_arrange import arrange

        out_dir = os.path.dirname(os.path.abspath(output_path))
        result["fingerstyle"] = arrange(pitch_path, result, out_dir, title)
    except Exception as err:
        result["fingerstyle"] = {"status": "error", "message": f"{type(err).__name__}: {err}"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Reprise chord analysis")
    parser.add_argument("--audio_path", required=True, help="Instrumental stem (no_vocals.wav)")
    parser.add_argument("--output_path", required=True, help="Where to write chords.json")
    parser.add_argument("--pitch_path", help="Vocal pitch.csv from torchcrepe (enables fingerstyle)")
    parser.add_argument("--title", default="", help="Song title for the exported tab")
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
        add_fingerstyle(result, args.pitch_path, args.output_path, args.title or "Reprise arrangement")
        write_output(args.output_path, {**base, "status": "ok", **result})
        fs = result["fingerstyle"]
        print(
            f"[chord_analyze] done: key={result['key']['name']} tempo={result['tempo_bpm']} "
            f"meter={result['time_signature']['beats_per_bar']} chords={len(result['chords'])} "
            f"fingerstyle={fs['status']}" + (f" ({fs.get('message')})" if fs["status"] != "ok" else "")
        )
        return 0
    except Exception as err:  # report every failure through the output file
        message = f"{type(err).__name__}: {err}"
        write_output(args.output_path, {**base, "status": "error", "message": message})
        print(f"[chord_analyze] error: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
