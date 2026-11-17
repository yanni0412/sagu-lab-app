#!/usr/bin/env bash
# Encode the frames + soundtrack from render-video.js into a TikTok-ready MP4:
# 1080x1920, 24fps, H.264 High (2-pass, ~6.3 Mbps -> ~66 MB), AAC 192k 48 kHz, loudness -14 LUFS.
# usage: bash animations/tools/encode-tiktok.sh [outDir]
set -euo pipefail
OUT="${1:-$(dirname "$0")/../out}"
cd "$OUT"

# pass 1 of loudnorm: measure, then apply as one linear gain (no pumping)
read -r I TP LRA TH OFF < <(ffmpeg -hide_banner -nostats -i audio.wav \
  -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 |
  python3 -c "import sys,json,re; m=json.loads(re.search(r'\{.*\}', sys.stdin.read(), re.S).group()); print(m['input_i'], m['input_tp'], m['input_lra'], m['input_thresh'], m['target_offset'])")
AF="loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true"

V=(-c:v libx264 -preset slow -b:v 6300k -maxrate 8M -bufsize 12M -pix_fmt yuv420p -profile:v high -level 4.1 -g 48
   -colorspace bt709 -color_primaries bt709 -color_trc bt709)
ffmpeg -y -hide_banner -loglevel error -framerate 24 -i frames/f_%05d.jpg "${V[@]}" -pass 1 -an -f mp4 /dev/null
ffmpeg -y -hide_banner -loglevel error -framerate 24 -i frames/f_%05d.jpg -i audio.wav -map 0:v -map 1:a "${V[@]}" -pass 2 \
  -af "$AF" -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart \
  -metadata "title=ねむりの丘 (잠드는 언덕)" nemuri-no-oka_tiktok_1080x1920.mp4
rm -f ffmpeg2pass-0.log ffmpeg2pass-0.log.mbtree
ls -la nemuri-no-oka_tiktok_1080x1920.mp4
