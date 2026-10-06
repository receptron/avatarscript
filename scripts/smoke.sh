#!/usr/bin/env bash
# Package smoke test: pack the exact tarball (prepack builds dist/ and bundles the engine),
# install it into an empty folder with no mesh-avatar-studio checkout and no esbuild beside it,
# and make a video through both the CLI and the library with the offline mock voice.
# Then check the video is real: an H.264 + AAC MP4 of the expected length whose frames show
# the avatar, not a blank canvas.
#
# Usage: scripts/smoke.sh <avatar folder>   (e.g. avatars/ani)
set -euo pipefail

AVATAR="$(cd "${1:?usage: scripts/smoke.sh <avatar folder>}" && pwd)"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TGZ="$(cd "$REPO" && npm pack --silent --pack-destination "$WORK" | tail -1)"
echo "packed: $TGZ"
cd "$WORK"
npm init -y >/dev/null
npm pkg set type=module
npm install --no-audit --no-fund "$WORK/$TGZ" >/dev/null

if [ -e node_modules/esbuild ]; then
  echo "esbuild was installed with the package; the engine must come prebuilt"; exit 1
fi

printf '[emotion:happy] こんにちは！<nod> Hello from the package.\n' > story.avs
node_modules/.bin/avatarscript make --avatar "$AVATAR" --script story.avs --tts mock \
  --size 640x360 -o out/cli.mp4

cat > lib.mjs <<EOF
import { loadAvatar, parseScript, compile, render, createTts, toWav } from 'avatarscript';
import { writeFile } from 'node:fs/promises';
const avatar = await loadAvatar(process.argv[2]);
const { score, audio } = await compile(parseScript('[emotion:surprised] Library check. <surprise>'), createTts({ provider: 'mock' }), { lang: 'en', audioName: 'lib.wav' });
await writeFile('out/lib.wav', toWav(audio));
await writeFile('out/lib.score.json', JSON.stringify(score));
await render({ avatar, score, audioPath: 'out/lib.wav', out: 'out/lib.mp4', width: 640, height: 360 });
console.log('library rendered', score.duration, 's');
EOF
node lib.mjs "$AVATAR"

check() {
  local file="$1" score="$2"
  local streams duration expected range
  streams="$(ffprobe -v error -show_entries stream=codec_name,width,height -of csv=p=0 "$file" | tr '\n' ' ')"
  [[ "$streams" == *"h264,640,360"* && "$streams" == *"aac"* ]] || { echo "$file: unexpected streams: $streams"; exit 1; }
  duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file")"
  expected="$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$score','utf8')).duration))")"
  node -e "process.exit(Math.abs($duration - $expected) < 0.3 ? 0 : 1)" \
    || { echo "$file: duration $duration s, score says $expected s"; exit 1; }
  # a blank canvas is one flat colour; the avatar spans dark hair to light skin
  range="$(ffprobe -v error -f lavfi -i "movie=$file,signalstats" -read_intervals "%+#15" \
    -show_entries frame_tags=lavfi.signalstats.YMIN,lavfi.signalstats.YMAX -of csv=p=0 | tail -1)"
  node -e "const [a,b]='$range'.split(',').map(Number); process.exit(Math.abs(b-a) > 120 ? 0 : 1)" \
    || { echo "$file: frame looks blank (luma range $range)"; exit 1; }
  echo "$file: ok ($streams, ${duration}s, luma $range)"
}
check out/cli.mp4 out/cli.score.json
check out/lib.mp4 out/lib.score.json
echo "package smoke passed"
