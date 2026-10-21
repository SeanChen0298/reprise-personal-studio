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

OUTPUT_VERSION = 12
ALTERNATIVES_PER_CHORD = 4

SR = 22050
HOP = 512

PITCH_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PITCH_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Tunable settings. Every value can be overridden per run with
# --tuning '{"seventh_prior": 0.98}' to try changes without editing code.
#   seventh_prior   <1 favours plain triads over 7th chords (7, m7, maj7, m7b5);
#                   raise toward 1.0 when real 7ths come out as plain chords.
#   maj7_prior      separate, because a 4-note maj7 template overlaps both the
#                   major chord and its relative minor and otherwise wins too often.
#   dim_prior / sus_prior   same idea for diminished and sus4 chords.
#   stickiness      chance of staying on the same chord each beat; higher =
#                   fewer, longer chords, lower = reacts to quick changes.
#   temperature     how decisively each beat picks its best chord.
#   bass_weight     per-beat bonus for chords whose root is the lowest note.
#                   Off by default: a walking bass line makes chords flicker.
#   bass_rerank     after chords are chosen, re-pick each one among its close
#                   alternatives (fit >= rerank_min_fit of the winner) using the
#                   bass note on its FIRST beat — where the root is played before
#                   any passing notes. Separates Dmaj7 / F#m7 (shared notes,
#                   different bass) without adding chord changes. 0 = off.
#   snap_weak_changes / snap_tolerance  when on, chord changes on a weak beat
#                   (2 or 4) move to the nearer strong beat unless that costs
#                   more than snap_tolerance fit per moved beat. OFF by default:
#                   on Kaerou it erased real syncopated changes.
#   min_chord_beats chords shorter than this are merged into a neighbour.
#                   1 = keep everything (default): 2 removed a real one-beat
#                   passing chord (C7 -> Bm) on Kaerou.
#   use_stems       split drums / bass / other (Demucs 4-stem) and analyse each
#                   job on the part that suits it. Off by default (helps drum-heavy
#                   songs like Tabiji, slightly hurt Kaerou); set per song in
#                   chord_settings.json from the app.
#   beat_align_window / beat_align_smooth  shift each beat onto the nearest
#                   attack within this many seconds, smoothed over this many
#                   beats (0 = off). Keeps the grid on the music when the
#                   tracker's phase drifts between sections.
#   tempo_hint      force the beat grid to this BPM. Set per song (from the
#                   app's Half / Double tempo buttons) in chord_settings.json
#                   next to chords.json, because the audio alone can't tell a
#                   song at 86 BPM from the same song felt at 172.
TUNING = {
    "seventh_prior": 0.98,
    "maj7_prior": 0.95,
    "dim_prior": 0.92,
    "sus_prior": 0.93,
    "stickiness": 0.82,
    "bass_weight": 0.0,
    "bass_rerank": 0.25,
    "rerank_min_fit": 0.85,
    "snap_weak_changes": False,
    "snap_tolerance": 0.12,
    "min_chord_beats": 1,
    "tempo_hint": None,
    "use_stems": False,
    "beat_align_window": 0.07,
    "beat_align_smooth": 9,
    "temperature": 0.06,
}

# Chord qualities: (suffix, intervals, template weights, prior key).
# The 7th / extension tone gets a lower weight than root, third and fifth.
QUALITIES = [
    ("",     [0, 4, 7],     [1.0, 0.8, 0.9],      None),
    ("m",    [0, 3, 7],     [1.0, 0.8, 0.9],      None),
    ("7",    [0, 4, 7, 10], [1.0, 0.8, 0.9, 0.6], "seventh_prior"),
    ("m7",   [0, 3, 7, 10], [1.0, 0.8, 0.9, 0.6], "seventh_prior"),
    ("maj7", [0, 4, 7, 11], [1.0, 0.8, 0.9, 0.6], "maj7_prior"),
    ("m7b5", [0, 3, 6, 10], [1.0, 0.8, 0.9, 0.6], "seventh_prior"),
    ("dim",  [0, 3, 6],     [1.0, 0.8, 0.9],      "dim_prior"),
    ("sus4", [0, 5, 7],     [1.0, 0.8, 0.9],      "sus_prior"),
]

# Krumhansl-Kessler key profiles.
KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

# Keys conventionally spelled with flats.
FLAT_MAJOR_TONICS = {5, 10, 3, 8, 1, 6}       # F Bb Eb Ab Db Gb
FLAT_MINOR_TONICS = {2, 7, 0, 5, 10, 3}       # D G C F Bb Eb minor
SHARP_HEAVY_MAJOR_TONICS = {4, 11, 6, 1}     # E B F# C# major (and their relative minors)


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
    names = list(PITCH_NAMES_FLAT if use_flats else PITCH_NAMES_SHARP)
    # Borrowed chords on the flat side (bVII, bIII) are written Bb / Eb even
    # in sharp keys, unless the key itself has four or more sharps.
    major_tonic = tonic if mode == "major" else (tonic + 3) % 12
    if not use_flats and major_tonic not in SHARP_HEAVY_MAJOR_TONICS:
        names[10], names[3] = "Bb", "Eb"
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

    roots, quals, temps, priors = [], [], [], []
    for suffix, intervals, weights, prior_key in QUALITIES:
        for root in range(12):
            t = np.zeros(12)
            for iv, w in zip(intervals, weights):
                t[(root + iv) % 12] = w
            temps.append(t / np.linalg.norm(t))
            roots.append(root)
            quals.append(suffix)
            priors.append(TUNING[prior_key] if prior_key else 1.0)
    return np.array(temps), roots, quals, np.array(priors)


def detect_chords(beat_chroma, beat_bass, beat_times, duration_s, names):
    """Score every chord on every beat and pick the most likely sequence.

    Returns the per-beat state path and a context for build_segments().
    """
    import numpy as np
    import librosa

    templates, roots, quals, priors = build_templates()
    n_states = len(templates) + 1  # + "N" (no chord)

    energy = beat_chroma.sum(axis=0)
    norm = beat_chroma / (np.linalg.norm(beat_chroma, axis=0, keepdims=True) + 1e-9)
    sims = (templates @ norm) * priors[:, None]           # (n_templates, n_beats)

    # Bass: how strongly each chord's root is the lowest note sounding.
    # Same-root chords get the same bonus, so this only decides between
    # chords with different roots that share notes (Dmaj7 vs F#m7).
    bass_share = beat_bass / (beat_bass.max(axis=0, keepdims=True) + 1e-9)   # (12, n_beats), 0..1
    sims = sims + TUNING["bass_weight"] * bass_share[np.array(roots)]

    # "No chord" scores high only where the beat is near-silent.
    quiet = energy < (0.08 * np.median(energy) + 1e-9)
    n_score = np.where(quiet, 1.0, 0.35)[None, :]
    scores = np.vstack([sims, n_score])

    # Turn similarities into probabilities, then smooth over time.
    probs = np.exp((scores - scores.max(axis=0, keepdims=True)) / TUNING["temperature"])
    probs /= probs.sum(axis=0, keepdims=True)
    transition = librosa.sequence.transition_loop(n_states, TUNING["stickiness"])
    path = librosa.sequence.viterbi(probs, transition)

    def label_for(state):
        if state == n_states - 1:
            return {"label": "N", "root": None, "root_pc": None, "quality": "N"}
        root, qual = roots[state], quals[state]
        return {"label": names[root] + qual, "root": names[root], "root_pc": root, "quality": qual or "maj"}

    ctx = {
        "sims": sims, "scores": scores, "probs": probs, "label_for": label_for,
        "n_templates": len(templates), "roots": roots, "beat_bass": beat_bass,
        "beat_times": beat_times, "duration_s": duration_s,
    }
    return [int(x) for x in path], ctx


def regularize_path(path, scores, meter, phase):
    """Move weak-beat chord changes to strong beats; merge too-short chords.

    `scores` is (n_states, n_beats). A change is moved when doing so costs
    less than snap_tolerance fit per moved beat (or gains fit).
    """
    path = list(path)
    n = len(path)
    strong = {0, 2} if meter == 4 else {0}
    tol = TUNING["snap_tolerance"]

    def pos(i):
        return (i - phase) % meter

    def run_bounds(i):
        """Start (inclusive) and end (exclusive) of the run containing beat i."""
        a = i
        while a > 0 and path[a - 1] == path[i]:
            a -= 1
        b = i
        while b < n and path[b] == path[i]:
            b += 1
        return a, b

    i = 1 if TUNING["snap_weak_changes"] else n
    while i < n:
        if path[i] != path[i - 1] and pos(i) not in strong:
            A, B = path[i - 1], path[i]
            a_start, _ = run_bounds(i - 1)
            _, b_end = run_bounds(i)
            p = pos(i)
            back = p - max(x for x in strong if x <= p)                         # beats to move earlier
            fwd = min([x for x in strong if x > p] + [meter]) - p                # beats to move later
            options = []
            j = i - back
            if j > a_start:                                                      # A keeps >= 1 beat
                gain = float(sum(scores[B, j:i] - scores[A, j:i]))
                options.append((gain / back, "earlier", j))
            k = i + fwd
            if k < b_end:                                                        # B keeps >= 1 beat
                gain = float(sum(scores[A, i:k] - scores[B, i:k]))
                options.append((gain / fwd, "later", k))
            if options:
                gain, how, to = max(options)
                if gain > -tol:
                    if how == "earlier":
                        for x in range(to, i):
                            path[x] = B
                    else:
                        for x in range(i, to):
                            path[x] = A
                        i = to
        i += 1

    # Merge chords shorter than min_chord_beats into the better-fitting neighbour.
    min_beats = TUNING["min_chord_beats"]
    changed = True
    while changed:
        changed = False
        i = 0
        while i < n:
            a, b = run_bounds(i)
            if b - a < min_beats and (a > 0 or b < n):
                candidates = []
                if a > 0:
                    candidates.append(path[a - 1])
                if b < n:
                    candidates.append(path[b])
                best = max(candidates, key=lambda st: float(sum(scores[st, a:b])))
                for x in range(a, b):
                    path[x] = best
                changed = True
            i = b
    return path


def build_segments(path, ctx):
    """Turn a per-beat state path into chord segments (with alternatives)."""
    import numpy as np

    sims, probs, label_for = ctx["sims"], ctx["probs"], ctx["label_for"]
    roots, beat_bass = ctx["roots"], ctx["beat_bass"]
    beat_times, duration_s = ctx["beat_times"], ctx["duration_s"]
    n_templates = ctx["n_templates"]

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
            seg["_beats"].append(i)
            seg["beats"] += 1
        else:
            segments.append({
                "_state": int(state),
                "start_ms": to_ms(start),
                "end_ms": to_ms(end),
                "beats": 1,
                "_conf": [conf],
                "_beats": [i],
                **label_for(state),
            })

    # Runner-ups: the chords whose templates fit this stretch almost as well
    # (e.g. Dmaj7 vs F#m7, which share three notes). Offered in the app as
    # one-click alternatives when correcting a chord.
    label_index = {label_for(k)["label"]: k for k in range(n_templates)}
    for seg in segments:
        seg["confidence"] = round(float(np.mean(seg.pop("_conf"))), 3)
        state = seg.pop("_state")
        beats_in_seg = seg.pop("_beats")
        first_beat = beats_in_seg[0]
        fit = sims[:, beats_in_seg].mean(axis=1)
        best = float(fit.max()) or 1.0
        alternatives = []
        for k in np.argsort(-fit):
            if k == state or k >= n_templates:
                continue
            alt = label_for(int(k))
            if any(a["label"] == alt["label"] for a in alternatives):
                continue
            alternatives.append({"label": alt["label"], "fit": round(float(fit[k]) / best, 3)})
            if len(alternatives) == ALTERNATIVES_PER_CHORD:
                break
        seg["alternatives"] = alternatives
        seg["_first_beat"] = first_beat

        # Bass re-rank: does a close alternative have the bass note this
        # chord starts on as its root?
        w = TUNING["bass_rerank"]
        if w > 0 and seg["root_pc"] is not None:
            bass_first = beat_bass[:, first_beat]
            bass_first = bass_first / (bass_first.max() + 1e-9)
            options = [(1.0 + w * bass_first[seg["root_pc"]], None)]
            for a in alternatives:
                if a["fit"] < TUNING["rerank_min_fit"]:
                    continue
                k = label_index[a["label"]]
                options.append((a["fit"] + w * bass_first[roots[k]], k))
            best_score, best_k = max(options, key=lambda o: o[0])
            if best_k is not None:
                previous = seg["label"]
                seg.update(label_for(best_k))
                seg["alternatives"] = [{"label": previous, "fit": 1.0}] + [
                    a for a in alternatives if a["label"] != seg["label"]
                ]
                seg["reranked_from"] = previous
        seg.pop("_first_beat")
    return segments


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
    "Cmaj7", "Amaj7", "Gmaj7", "Emaj7", "Dmaj7", "Fmaj7",
    "Asus4", "Dsus4", "Esus4",
}
SHAPE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
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
        return SHAPE_NAMES[(chord["root_pc"] - capo) % 12] + suffix

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
# Beat alignment
# ---------------------------------------------------------------------------

def align_beats_to_onsets(beat_times, onset_env, sr):
    """Line each beat up with the actual attacks around it.

    The beat tracker gets the tempo right but its phase can sit tens of ms
    off in some passages (Kaerou's intro: ~45 ms late, then exact from the
    bridge), which makes a fixed play-along offset right in one part and
    wrong in another. Measure how far the nearest strong onset is from each
    beat (within beat_align_window), smooth that over a few beats so single
    stray hits don't jitter the grid, and shift the beat by it.
    """
    import numpy as np
    import librosa

    window = TUNING["beat_align_window"]
    if window <= 0 or len(beat_times) < 4:
        return beat_times
    onsets = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=HOP, units="time", backtrack=False,
    )
    if len(onsets) == 0:
        return beat_times
    idx = np.clip(np.searchsorted(onsets, beat_times), 1, len(onsets) - 1)
    nearest = np.where(
        np.abs(onsets[idx] - beat_times) < np.abs(onsets[idx - 1] - beat_times), onsets[idx], onsets[idx - 1],
    )
    offset = nearest - beat_times
    offset[np.abs(offset) > window] = np.nan
    half = TUNING["beat_align_smooth"] // 2
    shift = np.zeros(len(beat_times))
    for i in range(len(beat_times)):
        local = offset[max(0, i - half): i + half + 1]
        local = local[~np.isnan(local)]
        shift[i] = float(np.median(local)) if len(local) >= 2 else 0.0
    aligned = np.maximum(beat_times + shift, 0.0)
    # Keep beats in order and at least half a beat apart.
    gaps = np.diff(beat_times)
    for i in range(1, len(aligned)):
        aligned[i] = max(aligned[i], aligned[i - 1] + 0.5 * gaps[i - 1])
    return aligned


# ---------------------------------------------------------------------------
# Four-stem separation (drums / bass / other / vocals)
# ---------------------------------------------------------------------------

STEM_NAMES = ("drums", "bass", "other")


def ensure_stems(mix_path, instrumental_path):
    """Paths of the drums / bass / other stems next to the instrumental.

    The app's stem step only splits vocals from the rest. If the 4-stem files
    aren't there yet, run the same Demucs model (already downloaded) without
    --two-stems to get them. Returns None when that isn't possible; the
    analysis then falls back to the whole instrumental.
    """
    import subprocess

    stems_dir = os.path.dirname(os.path.abspath(instrumental_path))
    paths = {name: os.path.join(stems_dir, f"{name}.wav") for name in STEM_NAMES}
    if all(os.path.isfile(p) for p in paths.values()):
        return paths
    if not mix_path or not os.path.isfile(mix_path):
        return None

    # Demucs writes to <out_root>/htdemucs/<mix file name>/, which is where
    # the app's 2-stem files already live.
    out_root = os.path.dirname(os.path.dirname(stems_dir))
    print("[chord_analyze] separating drums / bass / other (one-time, a few minutes)...", flush=True)
    result = subprocess.run(
        [sys.executable, "-m", "demucs", "-n", "htdemucs", "-o", out_root, mix_path],
        capture_output=True, text=True,
    )
    produced_dir = os.path.join(out_root, "htdemucs", os.path.splitext(os.path.basename(mix_path))[0])
    paths = {name: os.path.join(produced_dir, f"{name}.wav") for name in STEM_NAMES}
    if result.returncode != 0 or not all(os.path.isfile(p) for p in paths.values()):
        tail = (result.stderr or "").strip().splitlines()[-1:] or ["unknown error"]
        print(f"[chord_analyze] 4-stem separation failed, using the instrumental: {tail[0]}", file=sys.stderr)
        return None
    return paths


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze(audio_path: str, stems=None) -> dict:
    """Analyse the instrumental. With `stems` (drums / bass / other paths),
    each job uses the part that suits it: beats from the drums, chords from
    the harmonic instruments ("other"), the bass note from the bass, and the
    strum pattern from when the guitar / keys strike — not from drum hits.
    """
    import numpy as np
    import librosa

    y, sr = librosa.load(audio_path, sr=SR, mono=True)
    duration_s = len(y) / sr
    if duration_s < 5:
        raise ValueError("Audio is too short to analyse (under 5 seconds)")

    def load_stem(name):
        s_y, _ = librosa.load(stems[name], sr=SR, mono=True)
        out = np.zeros(len(y), dtype=np.float32)
        out[: min(len(y), len(s_y))] = s_y[: len(y)]
        return out

    if stems:
        y_drums, y_bass, y_other = load_stem("drums"), load_stem("bass"), load_stem("other")
        y_harm = librosa.effects.harmonic(y_other)         # chords: no drums, no strum clicks
        y_strum = librosa.effects.percussive(y_other)      # strums / plucks of the harmony instruments
        drums_audible = float(np.sqrt(np.mean(y_drums ** 2))) > 0.01
        y_beat = y_drums if drums_audible else librosa.effects.percussive(y)
        y_low = y_bass
        sources = {"beats": "drums" if drums_audible else "instrumental", "chords": "other",
                   "bass": "bass", "strumming": "other"}
    else:
        y_harm, y_perc = librosa.effects.hpss(y)
        y_beat, y_strum, y_low = y_perc, y_perc, y_harm
        sources = {"beats": "instrumental", "chords": "instrumental",
                   "bass": "instrumental", "strumming": "instrumental"}

    # Beats
    onset_env = librosa.onset.onset_strength(y=y_beat, sr=sr, hop_length=HOP)
    hint = TUNING.get("tempo_hint")
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=HOP, trim=False,
        **({"bpm": float(hint)} if hint else {}),
    )
    tempo = float(np.atleast_1d(tempo)[0])
    if len(beat_frames) < 8:
        raise ValueError("Could not find a steady beat in this song")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    beat_times = align_beats_to_onsets(beat_times, onset_env, sr)
    beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP)

    # Chroma, one vector per beat
    chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr, hop_length=HOP)
    sync_frames = librosa.util.fix_frames(beat_frames, x_min=0, x_max=chroma.shape[1])
    beat_chroma = librosa.util.sync(chroma, sync_frames, aggregate=np.median)
    # fix_frames adds a segment before the first beat; drop it so columns == beats.
    if beat_chroma.shape[1] == len(beat_frames) + 1:
        beat_chroma = beat_chroma[:, 1:]
    beat_chroma = beat_chroma[:, : len(beat_frames)]

    # Bass register only (C1–B3): which note is at the bottom of the harmony.
    bass = librosa.feature.chroma_cqt(
        y=y_low, sr=sr, hop_length=HOP, fmin=librosa.note_to_hz("C1"), n_octaves=3,
    )
    beat_bass = librosa.util.sync(bass, sync_frames, aggregate=np.median)
    if beat_bass.shape[1] == len(beat_frames) + 1:
        beat_bass = beat_bass[:, 1:]
    beat_bass = beat_bass[:, : len(beat_frames)]

    key, names = detect_key(chroma.mean(axis=1))
    path, chord_ctx = detect_chords(beat_chroma, beat_bass, beat_times, duration_s, names)

    onset_at_beats = onset_env[np.clip(beat_frames, 0, len(onset_env) - 1)]
    meter, phase = detect_meter(path, onset_at_beats)
    path = regularize_path(path, chord_ctx["scores"], meter, phase)
    chords = build_segments(path, chord_ctx)
    bars = build_bars(beat_times, meter, phase, duration_s)
    strumming = detect_strumming(y_strum, sr, beat_times, bars, meter, tempo)
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
        "sources": sources,
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
    parser.add_argument("--mix_path", help="Original song audio; enables the drums / bass / other split")
    parser.add_argument("--title", default="", help="Song title for the exported tab")
    parser.add_argument("--tuning", default="", help='JSON overrides for TUNING, e.g. \'{"stickiness": 0.88}\'')
    args = parser.parse_args()
    if args.tuning:
        overrides = json.loads(args.tuning)
        unknown = set(overrides) - set(TUNING)
        if unknown:
            parser.error(f"unknown tuning keys: {sorted(unknown)}")
        TUNING.update(overrides)

    # Per-song settings saved by the app (e.g. a corrected tempo).
    settings_path = os.path.join(os.path.dirname(os.path.abspath(args.output_path)), "chord_settings.json")
    if os.path.isfile(settings_path):
        try:
            with open(settings_path, encoding="utf-8") as f:
                saved = json.load(f)
            TUNING.update({k: v for k, v in saved.items() if k in TUNING})
        except (OSError, ValueError) as err:
            print(f"[chord_analyze] ignoring unreadable chord_settings.json: {err}", file=sys.stderr)

    base = {
        "version": OUTPUT_VERSION,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "source_audio": args.audio_path,
        "tuning": dict(TUNING),
    }

    try:
        if not os.path.isfile(args.audio_path):
            raise FileNotFoundError(f"Audio file not found: {args.audio_path}")
        stems = ensure_stems(args.mix_path, args.audio_path) if TUNING["use_stems"] else None
        result = analyze(args.audio_path, stems)
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
