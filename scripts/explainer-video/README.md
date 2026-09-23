# Sales entry explainer video

`record.js` drives the real app through one complete sale and records it as an
annotated screen video (1440×900, ~3.5 min):

| Version | File | Voice |
|---|---|---|
| English | `docs/user-manual/videos/sales-entry.mp4` | male, Kokoro `am_michael` |
| Bangla (Bangladesh) | `docs/user-manual/videos/sales-entry.bn.mp4` | male, Azure `bn-BD-PradeepNeural`. **Silent until an Azure Speech key is available** (see below) |

It is a screen recording of the live UI, not a mock-up. `overlay.js` is injected
into the page and draws on top of it: step captions, hand-drawn boxes, arrows
and labels, a visible cursor with click ripples, and the title and recap cards.
Frames come from a Chrome DevTools screencast, so text stays sharp, and ffmpeg
encodes them to H.264.

Fonts (`fonts/`, all SIL OFL): Caveat for the English handwriting, Galada for
Bangla handwriting, Hind Siliguri for Bangla captions and cards.

## Scenes

1. Sales → Sales list → **New Sales Entry**
2. The three areas of the screen
3. Document details (Sales #, Ref #, date, warehouse)
4. Till / cashier shift chip
5. Customer search and card (+ new customer, walk-in)
6. Product search, previous sale rates, qty → Add
7. Adding more lines
8. Editing a line in the table
9. Whole-bill discount and the live total
10. Split payment (mobile wallet + cash), keeping due on credit
11. Note
12. Save Draft vs Create Sale
13. Print prompt
14. The sale in the sales list

## Languages

`lang/<code>.json` holds everything that changes per language:

- `narration`: the spoken line for each scene, keyed by the English caption
  title, plus `intro` and `outro`. It is written for the ear: *ERP71* becomes
  "E R P seventy-one" in English and "ই আর পি সেভেন্টি ওয়ান" in Bangla.
- `captions`, `labels`, `cards` (not needed for English, which is inline in
  `record.js`): the translated on-screen text, keyed by the English string. A
  missing key fails the run rather than leaking English into the video.

The app UI stays in English in the Bangla version. The New Sale screen is only
partly translated today (see TODO.md), so the Bangla captions name buttons by
the English label actually on screen.

To add a language, copy `lang/bn.json`, translate it, and run with
`VIDEO_LANG=<code>`.

## Voice-over

`narrate.py <lang>` turns the narration into one WAV per scene in
`.audio/<lang>/` (gitignored), plus `durations.json`. `record.js` then holds
each scene until its line has been spoken, logs when each caption appeared, and
mixes the clips onto the video at those moments (loudness-normalised to
−16 LUFS). With no `durations.json` it records a silent video on default pacing.

| Engine (`TTS=`) | Used for | Needs |
|---|---|---|
| `kokoro` | English default | `pip install kokoro-onnx soundfile`; `KOKORO_DIR` holding `kokoro-v1.0.onnx` + `voices-v1.0.bin` (kokoro-onnx GitHub release `model-files-v1.0`). Offline, Apache-2.0. Optional `KOKORO_VOICE` (default `am_michael`), `KOKORO_SPEED` |
| `azure` | Bangla default | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (default `southeastasia`), and network access to `<region>.tts.speech.microsoft.com`. Voice comes from the language file (`bn-BD-PradeepNeural`, male, Bangladeshi). Optional `AZURE_VOICE`, `AZURE_RATE` (e.g. `-5%`) |
| `estimate` | Bangla when no Azure key is set | nothing. Writes timings from text length only, so a silent video is paced as if narrated |
| `files` | human recordings | put `00.wav`, `01.wav`, … (narration order) in `.audio/<lang>/`; this measures them |

Voices ruled out: the Piper voices "Ryan" and "Alan" (Ryan's training data is
CC BY-NC-SA, non-commercial; Alan is fine-tuned from Ryan). No offline model
reachable here speaks Bangladeshi Bangla. Meta MMS-TTS Bengali is CC BY-NC, and
Google Cloud only offers Indian Bangla (`bn-IN`).

## Re-recording

Run this after changing the sales entry screen, so the videos still match it.

1. Start the stack against a **freshly seeded** local database (the demo tenant
   from `packages/database/prisma/seed.ts`). The script signs in as
   `nayeem.ahmad@gmail.com` / `password123` and picks *Dhaka Retail Co.*
   Mark the user's email verified, or the verify-email banner will cover the
   header:
   ```sql
   update "User" set email_verified_at = now();
   ```
2. Generate the voice-over, then record (reseed between the two languages so
   each video's sale is the only new one in the list):
   ```bash
   python3 scripts/explainer-video/narrate.py en && node scripts/explainer-video/record.js
   python3 scripts/explainer-video/narrate.py bn && VIDEO_LANG=bn node scripts/explainer-video/record.js
   ```
   Optional env: `BASE_URL` (default `http://localhost:3000`), `CHROMIUM_PATH`
   (a Chromium binary, if Playwright's own is not installed) and `FFMPEG` (the
   ffmpeg binary, default `ffmpeg` on `PATH`).

The script waits on real UI text and labels (`Search by name or phone…`,
`aria-label="Qty"`, `Create Sale`, …). If a label changes, the run fails at that
step instead of recording a broken video.

Transport, labour, rounding and per-line Disc % are left out on purpose. Today
the backend rejects a sale that uses them (see TODO.md), so the video only shows
paths that save successfully.
