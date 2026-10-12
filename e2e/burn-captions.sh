#!/bin/bash
# Burn the captions recorded by demo.mjs into the final MP4
set -e
cd "$(dirname "$0")/artifacts/demo"
ffmpeg -loglevel error -y -i demo-raw.mp4 \
  -vf "subtitles=captions.srt:force_style='FontName=DejaVu Sans,FontSize=17,PrimaryColour=&H00FFFFFF,BackColour=&H20000000,BorderStyle=4,Outline=6,Shadow=0,MarginV=14,Alignment=2'" \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart mullvad-chrome-mv3-demo.mp4
echo "artifacts/demo/mullvad-chrome-mv3-demo.mp4"
