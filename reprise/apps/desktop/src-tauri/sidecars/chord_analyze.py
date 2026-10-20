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
from datetime import datetime, timezone

OUTPUT_VERSION = 2

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
            return {"label": "N", "root": None, "quality": "N"}
        root, qual = roots[state], quals[state]
        return {"label": names[root] + qual, "root": names[root], "quality": qual or "maj"}

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

    return {
        "duration_ms": to_ms(duration_s),
        "tempo_bpm": round(tempo, 1),
        "key": key,
        "time_signature": {"beats_per_bar": meter, "beat_unit": 4},
        "beats_ms": [to_ms(t) for t in beat_times],
        "bars": bars,
        "chords": chords,
        # Kept for later stages (strumming / fingerstyle) — not written to JSON.
        "_internal": {
            "y_perc": y_perc,
            "sr": sr,
            "beat_times": beat_times,
            "meter": meter,
        },
    }


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
        result.pop("_internal", None)
        write_output(args.output_path, {**base, "status": "ok", **result})
        print(
            f"[chord_analyze] done: key={result['key']['name']} tempo={result['tempo_bpm']} "
            f"meter={result['time_signature']['beats_per_bar']} chords={len(result['chords'])}"
        )
        return 0
    except Exception as err:  # report every failure through the output file
        message = f"{type(err).__name__}: {err}"
        write_output(args.output_path, {**base, "status": "error", "message": message})
        print(f"[chord_analyze] error: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
