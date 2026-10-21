"""
fingerstyle_arrange.py — solo-guitar arrangement for Reprise (stage 6).

This is arranging, not transcribing a guitar part:
  - Melody: the sung line, from torchcrepe's pitch track of the vocals stem
    (pitch.csv: one "freq_hz,confidence" row per 10 ms).
  - Bass: the root of each chord from chords.json, on beat 1 and wherever the
    chord changes.
  - Fill: one chord tone between bass and melody on beat 1, if it fits.

Then every group of notes played together is placed on the neck (standard
tuning) so a real hand can play it:
  - at most a 4-fret stretch and at most 4 fretting fingers at once,
  - prefer open strings and low positions,
  - avoid big jumps along the neck between neighbouring notes,
  - when a group cannot be played, drop the fill, then the bass — never
    produce something unplayable.

Outputs (next to chords.json): fingerstyle_tab.txt and fingerstyle.musicxml.
All timing in milliseconds.
"""

import math
from itertools import product
from xml.sax.saxutils import escape

# Standard tuning, string 1 (high E) .. string 6 (low E), as MIDI numbers.
TUNING = [64, 59, 55, 50, 45, 40]
STRING_NAMES = ["e", "B", "G", "D", "A", "E"]
MAX_FRET = 15
MAX_STRETCH = 3          # highest - lowest fretted note <= 3 frets (a 4-fret span)
MAX_FINGERS = 4

MELODY_TARGET_MEDIAN = 69   # A4 — sits well on the top three strings
MELODY_RANGE = (55, 81)     # G3 .. A5
BASS_LOW = 40               # E2
FILL_RANGE = (50, 64)

PITCH_HOP_MS = 10
MIN_PITCH_CONFIDENCE = 0.5
MIN_VOICED_SHARE = 0.3

ROLE_PRIORITY = {"melody": 0, "bass": 1, "fill": 2}

PITCH_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PITCH_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

QUALITY_INTERVALS = {
    "maj": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10],
    "maj7": [0, 4, 7, 11], "m7b5": [0, 3, 6, 10], "dim": [0, 3, 6], "sus4": [0, 5, 7],
}


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

def load_pitch(path):
    """Return a list of (freq_hz, confidence), one per 10 ms frame."""
    frames = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split(",")
            if not parts or not parts[0]:
                continue
            try:
                freq = float(parts[0])
                conf = float(parts[1]) if len(parts) > 1 else 1.0
            except ValueError:
                continue
            frames.append((freq, conf))
    return frames


def hz_to_midi(freq):
    return 69 + 12 * math.log2(freq / 440.0)


def slot_times(bar, beats_ms):
    """Start time of every eighth-note slot in a bar, plus the bar end."""
    times = []
    for k in range(bar["beats"]):
        b = bar["first_beat"] + k
        t0 = beats_ms[b]
        t1 = beats_ms[b + 1] if b + 1 < len(beats_ms) else bar["end_ms"]
        times += [t0, (t0 + t1) / 2]
    return times + [bar["end_ms"]]


def melody_for_slot(frames, t0, t1):
    """Median MIDI pitch sung in [t0, t1), or None if mostly unvoiced."""
    i0, i1 = int(t0 // PITCH_HOP_MS), int(t1 // PITCH_HOP_MS)
    window = frames[i0:i1]
    if not window:
        return None
    voiced = [hz_to_midi(f) for f, c in window if c >= MIN_PITCH_CONFIDENCE and 65 <= f <= 1047]
    if len(voiced) < MIN_VOICED_SHARE * len(window):
        return None
    voiced.sort()
    return int(round(voiced[len(voiced) // 2]))


def chord_at(chords, t):
    current = None
    for c in chords:
        if c["start_ms"] <= t:
            current = c
        else:
            break
    return current


# ---------------------------------------------------------------------------
# Building the note events
# ---------------------------------------------------------------------------

def build_events(frames, analysis):
    bars = [b for b in analysis["bars"] if not b["pickup"] and b["beats"] == analysis["time_signature"]["beats_per_bar"]]
    beats_ms = analysis["beats_ms"]
    chords = analysis["chords"]

    # 1. Raw melody per slot.
    grid = []  # (bar, slot, t_ms, midi or None)
    for bar in bars:
        times = slot_times(bar, beats_ms)
        for s in range(len(times) - 1):
            grid.append((bar, s, times[s], melody_for_slot(frames, times[s], times[s + 1])))

    sung = sorted(m for *_, m in grid if m is not None)
    if not sung:
        raise ValueError("No sung melody found in the pitch data")

    # 2. Move the whole melody by octaves so it sits on the top strings, then
    #    fold any outliers into range.
    median = sung[len(sung) // 2]
    shift = 12 * round((MELODY_TARGET_MEDIAN - median) / 12)

    def fold(m):
        m += shift
        while m < MELODY_RANGE[0]:
            m += 12
        while m > MELODY_RANGE[1]:
            m -= 12
        return m

    events = []
    prev_melody = None
    held_slots = 0
    prev_chord_label = None
    for bar, s, t, m in grid:
        notes = []
        if m is not None:
            m = fold(m)
            # A held note is not re-plucked, except on the beat once it has
            # rung for a full beat (sung syllables often repeat a pitch).
            held_slots = held_slots + 1 if m == prev_melody else 0
            if m != prev_melody or (s % 2 == 0 and held_slots >= 2):
                notes.append({"midi": m, "role": "melody"})
                held_slots = 0
        else:
            held_slots = 0
        prev_melody = m

        chord = chord_at(chords, t)
        label = chord["label"] if chord else "N"
        if chord and chord["root_pc"] is not None and (s == 0 or label != prev_chord_label):
            root = chord["root_pc"]
            bass = BASS_LOW + (root - (BASS_LOW % 12)) % 12
            notes.append({"midi": bass, "role": "bass"})
            if s == 0:
                tones = [(root + iv) % 12 for iv in QUALITY_INTERVALS.get(chord["quality"], [0, 4, 7])[1:]]
                top = m if m is not None else FILL_RANGE[1] + 1
                fill = next(
                    (n for n in range(FILL_RANGE[1], FILL_RANGE[0] - 1, -1)
                     if n % 12 in tones and bass < n < top),
                    None,
                )
                if fill is not None:
                    notes.append({"midi": fill, "role": "fill"})
        prev_chord_label = label

        if notes:
            events.append({"bar": bar["index"], "slot": s, "t_ms": int(round(t)), "notes": notes})

    return events, shift, bars


# ---------------------------------------------------------------------------
# Fingering
# ---------------------------------------------------------------------------

def positions(midi):
    return [(s, midi - o) for s, o in enumerate(TUNING) if 0 <= midi - o <= MAX_FRET]


def playable(assign):
    strings = [s for s, _ in assign]
    if len(set(strings)) != len(strings):
        return False
    fretted = [f for _, f in assign if f > 0]
    if len(fretted) > MAX_FINGERS:
        return False
    if fretted and max(fretted) - min(fretted) > MAX_STRETCH:
        return False
    return True


def candidates(notes, limit=14):
    """Playable ways to place a group of notes, cheapest first."""
    order = sorted(range(len(notes)), key=lambda i: -notes[i]["midi"])  # high to low
    options = [positions(notes[i]["midi"]) for i in order]
    if any(not o for o in options):
        return []
    found = []
    for combo in product(*options):
        # Keep pitch order across strings (higher note on a higher string).
        if any(combo[k][0] >= combo[k + 1][0] for k in range(len(combo) - 1)):
            continue
        if not playable(combo):
            continue
        fretted = [f for _, f in combo if f > 0]
        local = sum(f * 0.08 for f in fretted) - 0.25 * (len(combo) - len(fretted))
        position = min(fretted) if fretted else None
        assign = [None] * len(notes)
        for k, i in enumerate(order):
            assign[i] = combo[k]
        found.append((local, position, assign))
    found.sort(key=lambda x: x[0])
    return found[:limit]


def place_event(notes):
    """Candidates for an event, dropping fill then bass until something fits."""
    notes = sorted(notes, key=lambda n: ROLE_PRIORITY[n["role"]])
    dropped = 0
    while notes:
        cands = candidates(notes)
        if cands:
            return notes, cands, dropped
        notes = notes[:-1]
        dropped += 1
    return [], [], dropped


def fingering(events):
    """Viterbi over events: cheap shapes, small moves along the neck."""
    placed = []
    dropped_total = 0
    for ev in events:
        notes, cands, dropped = place_event(ev["notes"])
        dropped_total += dropped
        if cands:
            placed.append((ev, notes, cands))

    if not placed:
        return [], dropped_total

    def move_cost(prev_pos, pos):
        if prev_pos is None or pos is None:
            return 0.0
        d = abs(pos - prev_pos)
        return d * 0.35 + (1.5 if d > 4 else 0.0)

    # cost[i][j], back[i][j]; hand position carries forward through open-string shapes.
    cost = [[c[0] for c in placed[0][2]]]
    hand = [[c[1] for c in placed[0][2]]]
    back = [[-1] * len(placed[0][2])]
    for i in range(1, len(placed)):
        row_cost, row_hand, row_back = [], [], []
        for local, pos, _ in placed[i][2]:
            best = None
            for j, prev in enumerate(cost[-1]):
                prev_pos = hand[-1][j]
                c = prev + local + move_cost(prev_pos, pos)
                if best is None or c < best[0]:
                    best = (c, j, pos if pos is not None else prev_pos)
            row_cost.append(best[0])
            row_back.append(best[1])
            row_hand.append(best[2])
        cost.append(row_cost)
        hand.append(row_hand)
        back.append(row_back)

    j = min(range(len(cost[-1])), key=lambda k: cost[-1][k])
    chosen = [None] * len(placed)
    for i in range(len(placed) - 1, -1, -1):
        chosen[i] = j
        j = back[i][j]

    out = []
    for (ev, notes, cands), k in zip(placed, chosen):
        assign = cands[k][2]
        out.append({
            "bar": ev["bar"],
            "slot": ev["slot"],
            "t_ms": ev["t_ms"],
            "notes": [
                {"string": s + 1, "fret": f, "midi": n["midi"], "role": n["role"]}
                for n, (s, f) in zip(notes, assign)
            ],
        })
    return out, dropped_total


# ---------------------------------------------------------------------------
# Export: ASCII tab
# ---------------------------------------------------------------------------

def write_tab(path, events, bars, analysis, slots_per_bar, title):
    by_slot = {(e["bar"], e["slot"]): e for e in events}
    chords = analysis["chords"]
    lines_out = [
        title,
        f"Key: {analysis['key']['name']}   Tempo: {round(analysis['tempo_bpm'])} BPM   "
        f"Time: {analysis['time_signature']['beats_per_bar']}/4   Tuning: standard (EADGBE)",
        "Generated arrangement: melody from the vocals, bass from the chord roots.",
        "",
    ]
    width = 3
    for g in range(0, len(bars), 4):
        group = bars[g:g + 4]
        chord_row = " "
        rows = [n + "|" for n in STRING_NAMES]
        for bar in group:
            cells = ["-" * width for _ in range(6)]
            chord_cells = ""
            for s in range(slots_per_bar):
                ev = by_slot.get((bar["index"], s))
                col = ["-" * width for _ in range(6)]
                if ev:
                    for n in ev["notes"]:
                        col[n["string"] - 1] = str(n["fret"]).ljust(width, "-")
                for r in range(6):
                    rows[r] += col[r]
                t = slot_times(bar, analysis["beats_ms"])[s]
                c = chord_at(chords, t)
                label = c["label"] if c else ""
                prev_t = slot_times(bar, analysis["beats_ms"])[s - 1] if s > 0 else None
                prev = chord_at(chords, prev_t) if prev_t is not None else None
                show = s == 0 or (prev and c and prev["label"] != c["label"])
                chord_cells += (label if show and label != "N" else "").ljust(width)[:width]
            del cells
            for r in range(6):
                rows[r] += "|"
            chord_row += chord_cells + " "
        lines_out.append(f"Bar {group[0]['index'] + 1}")
        lines_out.append(chord_row.rstrip())
        lines_out += rows
        lines_out.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines_out))


# ---------------------------------------------------------------------------
# Export: MusicXML (one tab staff, opens in MuseScore / Guitar Pro)
# ---------------------------------------------------------------------------

KEY_FIFTHS = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5}
DURATIONS = [(8, "whole", False), (6, "half", True), (4, "half", False),
             (3, "quarter", True), (2, "quarter", False), (1, "eighth", False)]


def split_duration(d):
    parts = []
    for size, typ, dot in DURATIONS:
        while d >= size:
            parts.append((size, typ, dot))
            d -= size
    return parts


def pitch_xml(midi, use_flats):
    names = PITCH_NAMES_FLAT if use_flats else PITCH_NAMES_SHARP
    name = names[midi % 12]
    step, alter = name[0], (1 if "#" in name else -1 if "b" in name else 0)
    octave = midi // 12 - 1
    alter_xml = f"<alter>{alter}</alter>" if alter else ""
    return f"<pitch><step>{step}</step>{alter_xml}<octave>{octave}</octave></pitch>"


def write_musicxml(path, events, bars, analysis, slots_per_bar, title):
    key = analysis["key"]
    major_tonic = key["tonic_pc"] if key["mode"] == "major" else (key["tonic_pc"] + 3) % 12
    fifths = KEY_FIFTHS[major_tonic]
    use_flats = fifths < 0
    beats = analysis["time_signature"]["beats_per_bar"]
    by_bar = {}
    for e in events:
        by_bar.setdefault(e["bar"], []).append(e)

    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">',
        '<score-partwise version="4.0">',
        f"<work><work-title>{escape(title)}</work-title></work>",
        "<identification><encoding><software>Reprise</software></encoding></identification>",
        '<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>',
        '<part id="P1">',
    ]
    for mi, bar in enumerate(bars):
        out.append(f'<measure number="{mi + 1}">')
        if mi == 0:
            tuning = "".join(
                f'<staff-tuning line="{6 - s}"><tuning-step>{PITCH_NAMES_SHARP[o % 12][0]}</tuning-step>'
                f"<tuning-octave>{o // 12 - 1}</tuning-octave></staff-tuning>"
                for s, o in enumerate(TUNING)
            )
            out.append(
                "<attributes><divisions>2</divisions>"
                f"<key><fifths>{fifths}</fifths></key>"
                f"<time><beats>{beats}</beats><beat-type>4</beat-type></time>"
                '<clef><sign>TAB</sign><line>5</line></clef>'
                f"<staff-details><staff-lines>6</staff-lines>{tuning}</staff-details>"
                "</attributes>"
                f'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                f"<per-minute>{round(analysis['tempo_bpm'])}</per-minute></metronome></direction-type></direction>"
            )
        bar_events = sorted(by_bar.get(bar["index"], []), key=lambda e: e["slot"])
        cursor = 0
        for k, ev in enumerate(bar_events):
            if ev["slot"] > cursor:
                for size, typ, dot in split_duration(ev["slot"] - cursor):
                    out.append(f"<note><rest/><duration>{size}</duration><type>{typ}</type>{'<dot/>' if dot else ''}</note>")
            nxt = bar_events[k + 1]["slot"] if k + 1 < len(bar_events) else slots_per_bar
            parts = split_duration(nxt - ev["slot"])
            size, typ, dot = parts[0]
            for ni, n in enumerate(sorted(ev["notes"], key=lambda x: x["string"])):
                out.append(
                    "<note>"
                    + ("<chord/>" if ni else "")
                    + pitch_xml(n["midi"], use_flats)
                    + f"<duration>{size}</duration><type>{typ}</type>{'<dot/>' if dot else ''}"
                    + f"<notations><technical><string>{n['string']}</string><fret>{n['fret']}</fret></technical></notations>"
                    + "</note>"
                )
            # Rest out whatever is left of a duration that cannot be one note value.
            for size2, typ2, dot2 in parts[1:]:
                out.append(f"<note><rest/><duration>{size2}</duration><type>{typ2}</type>{'<dot/>' if dot2 else ''}</note>")
            cursor = nxt
        if cursor < slots_per_bar:
            for size, typ, dot in split_duration(slots_per_bar - cursor):
                out.append(f"<note><rest/><duration>{size}</duration><type>{typ}</type>{'<dot/>' if dot else ''}</note>")
        out.append("</measure>")
    out += ["</part>", "</score-partwise>"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))


# ---------------------------------------------------------------------------
# Entry point used by chord_analyze.py
# ---------------------------------------------------------------------------

def arrange(pitch_path, analysis, out_dir, title):
    import os

    frames = load_pitch(pitch_path)
    raw_events, shift, bars = build_events(frames, analysis)
    events, dropped = fingering(raw_events)
    slots_per_bar = analysis["time_signature"]["beats_per_bar"] * 2

    tab_path = os.path.join(out_dir, "fingerstyle_tab.txt").replace("\\", "/")
    xml_path = os.path.join(out_dir, "fingerstyle.musicxml").replace("\\", "/")
    write_tab(tab_path, events, bars, analysis, slots_per_bar, title)
    write_musicxml(xml_path, events, bars, analysis, slots_per_bar, title)

    played = [n for e in events for n in e["notes"]]
    frets = [n["fret"] for n in played if n["fret"] > 0]
    return {
        "status": "ok",
        "tuning": "standard",
        "melody_shift_semitones": shift,
        "slots_per_bar": slots_per_bar,
        "events": events,
        "dropped_notes": dropped,
        "highest_fret": max(frets) if frets else 0,
        "tab_path": tab_path,
        "musicxml_path": xml_path,
    }
