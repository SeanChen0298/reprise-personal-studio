import yt_dlp
import sys
import json
import re
import requests


def clean_subtitles(vtt_text):
    """Strips timestamps and formatting from VTT/SRV captions."""
    lines = vtt_text.splitlines()
    clean_lines = []
    for line in lines:
        if "-->" in line or "WEBVTT" in line or "Kind:" in line or "Language:" in line:
            continue
        line = re.sub(r'<\d{2}:\d{2}:\d{2}\.\d{3}>', '', line)
        line = re.sub(r'<[^>]+>', '', line).strip()
        if line and (not clean_lines or line != clean_lines[-1]):
            clean_lines.append(line)
    return "\n".join(clean_lines)


def get_song_metadata(url):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        'playlist_items': '1',
        'writesubtitles': True,
        'writeautomaticsubtitles': True,
        'subtitleslangs': ['ja', 'en', '.*'],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            if 'entries' in info:
                info = info['entries'][0]

            # Square thumbnail logic
            thumbnails = info.get('thumbnails', [])
            icon_url = None
            square_thumbs = [
                t for t in thumbnails
                if t.get('width') and t.get('height') and abs(t.get('width') - t.get('height')) <= 5
            ]
            if square_thumbs:
                icon_url = sorted(square_thumbs, key=lambda x: x.get('width', 0))[-1]['url']
            else:
                best_thumb = info.get('thumbnail', '')
                if 'googleusercontent.com' in best_thumb or 'yt3.ggpht.com' in best_thumb:
                    icon_url = re.sub(r'=w\d+-h\d+.*', '', best_thumb) + "=w1000-h1000-s-rj"
                else:
                    icon_url = best_thumb

            # Subtitle / lyrics extraction
            lyrics_text = None
            all_subs = info.get('subtitles') or {}
            all_autos = info.get('automatic_captions') or {}
            combined_subs = {**all_autos, **all_subs}

            target_lang = None
            if 'ja' in combined_subs:
                target_lang = 'ja'
            elif 'en' in combined_subs:
                target_lang = 'en'
            elif combined_subs:
                target_lang = list(combined_subs.keys())[0]

            if target_lang:
                formats = combined_subs[target_lang]
                sub_url = next(
                    (f['url'] for f in formats if f.get('ext') == 'vtt'),
                    formats[0]['url']
                )
                res = requests.get(sub_url, timeout=10)
                if res.status_code == 200:
                    cleaned = clean_subtitles(res.text)
                    if cleaned.strip():
                        lyrics_text = cleaned

            return {
                "song_name": info.get('track') or info.get('title'),
                "artist": info.get('artist') or info.get('uploader'),
                "icon_url": icon_url,
                "language_fetched": target_lang,
                "lyrics": lyrics_text,
            }

        except Exception as e:
            return {"error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) > 1:
        result = get_song_metadata(sys.argv[1])
        print(json.dumps(result, indent=4, ensure_ascii=False))
    else:
        print(json.dumps({"error": "No URL provided"}, ensure_ascii=False))
