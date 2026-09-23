"""Synthesise one video's voice-over into .audio/<video>/<lang>/ for record.js.

    python3 narrate.py <video> [lang]      # e.g. sales-entry; lang defaults to en

The spoken lines are the "narration" block of lang/<video>.<lang>.json, keyed
by caption title (plus intro/outro). Writes one WAV per line and
.audio/<video>/<lang>/durations.json. record.js reads that file to hold each scene
until its line has been spoken and to place every clip on the soundtrack.
Without it, record.js records a silent video on its default pacing.

Engines (TTS env var; the default depends on the language):

  kokoro    English default. Offline, Apache-2.0 model.
              pip install kokoro-onnx soundfile
              KOKORO_DIR=<dir with kokoro-v1.0.onnx + voices-v1.0.bin>
              KOKORO_VOICE (default am_michael, US male), KOKORO_SPEED
  azure     Bangla default. Azure AI Speech neural voice, named by the
            language file ("voice.azure"; bn-BD-PradeepNeural is a male
            Bangladeshi voice). Needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION,
            and network access to <region>.tts.speech.microsoft.com.
  estimate  No audio. Writes durations from the text length only, so a
            silent recording is paced as if it were narrated. Used for
            Bangla automatically when no Azure key is set.

To use human recordings instead, run with TTS=estimate, drop the recordings
into .audio/<video>/<lang>/ under the file names durations.json would use (NN.wav, in
the order of the narration block), and run with TTS=files to measure them.
"""
import json
import os
import sys
import urllib.request
import wave
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent


def kokoro_engine():
    import soundfile as sf
    from kokoro_onnx import Kokoro

    model_dir = Path(os.environ.get("KOKORO_DIR", HERE))
    kokoro = Kokoro(str(model_dir / "kokoro-v1.0.onnx"), str(model_dir / "voices-v1.0.bin"))
    voice = os.environ.get("KOKORO_VOICE", "am_michael")
    speed = float(os.environ.get("KOKORO_SPEED", "1.0"))

    def speak(text, file):
        samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
        sf.write(file, samples, rate)
        return len(samples) / rate

    return speak


def azure_engine(voice_cfg):
    key = os.environ["AZURE_SPEECH_KEY"]
    region = os.environ.get("AZURE_SPEECH_REGION", "southeastasia")
    voice = os.environ.get("AZURE_VOICE", voice_cfg["azure"])
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    rate = os.environ.get("AZURE_RATE", "0%")

    def speak(text, file):
        ssml = (
            f"<speak version='1.0' xml:lang='{voice_cfg['lang']}'>"
            f"<voice name='{voice}'><prosody rate='{rate}'>{escape(text)}</prosody></voice></speak>"
        )
        req = urllib.request.Request(url, data=ssml.encode("utf-8"), method="POST", headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "erp71-explainer-video",
        })
        with urllib.request.urlopen(req, timeout=60) as res:
            file.write_bytes(res.read())
        return measure(file)

    return speak


def measure(file):
    with wave.open(str(file)) as w:
        return w.getnframes() / w.getframerate()


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: narrate.py <video> [lang]")
    video = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "en"
    spec = json.loads((HERE / "lang" / f"{video}.{lang}.json").read_text())
    lines = spec["narration"]

    engine = os.environ.get("TTS") or (
        "kokoro" if lang == "en" else "azure" if os.environ.get("AZURE_SPEECH_KEY") else "estimate"
    )
    if engine == "estimate":
        print("no voice engine: writing estimated timings only (silent video)", file=sys.stderr)

    out = HERE / ".audio" / video / lang
    out.mkdir(parents=True, exist_ok=True)
    speak = {
        "kokoro": lambda: kokoro_engine(),
        "azure": lambda: azure_engine(spec["voice"]),
        "estimate": lambda: None,
        "files": lambda: None,
    }[engine]()

    durations = {}
    for i, (key, text) in enumerate(lines.items()):
        file = out / f"{i:02d}.wav"
        if engine == "estimate":
            # About 14 characters a second is a calm read in Bangla or English.
            durations[key] = {"file": None, "dur": round(len(text) / 14 + 0.5, 3)}
        elif engine == "files":
            durations[key] = {"file": str(file), "dur": round(measure(file), 3)}
        else:
            durations[key] = {"file": str(file), "dur": round(speak(text, file), 3)}
        print(f"{durations[key]['dur']:6.2f}s  {key}", file=sys.stderr)

    (out / "durations.json").write_text(json.dumps(durations, indent=2, ensure_ascii=False))
    print(f"{engine}: total {sum(d['dur'] for d in durations.values()):.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
