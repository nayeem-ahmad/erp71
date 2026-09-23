"""Synthesise the voice-over in narration.json into .audio/ for record.js.

Uses Kokoro (Apache-2.0), fully offline:
    pip install kokoro-onnx soundfile
    # model files, from github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
    KOKORO_DIR=/path/with/kokoro-v1.0.onnx+voices-v1.0.bin python3 narrate.py

Writes one WAV per line plus .audio/durations.json. record.js reads that file
to hold each scene until its line has been spoken and to place every clip on
the soundtrack; without it, record.js records a silent video.
"""
import json
import os
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).resolve().parent
OUT = HERE / ".audio"
VOICE = os.environ.get("KOKORO_VOICE", "am_michael")  # US English, male
SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))


def main() -> None:
    model_dir = Path(os.environ.get("KOKORO_DIR", HERE))
    kokoro = Kokoro(str(model_dir / "kokoro-v1.0.onnx"), str(model_dir / "voices-v1.0.bin"))
    lines = {k: v for k, v in json.loads((HERE / "narration.json").read_text()).items() if not k.startswith("_")}

    OUT.mkdir(exist_ok=True)
    durations = {}
    for i, (key, text) in enumerate(lines.items()):
        samples, rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang="en-us")
        file = OUT / f"{i:02d}.wav"
        sf.write(file, samples, rate)
        durations[key] = {"file": str(file), "dur": round(len(samples) / rate, 3)}
        print(f"{durations[key]['dur']:6.2f}s  {key}", file=sys.stderr)

    (OUT / "durations.json").write_text(json.dumps(durations, indent=2, ensure_ascii=False))
    print(f"total {sum(d['dur'] for d in durations.values()):.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
