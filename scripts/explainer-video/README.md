# Sales entry explainer video

`record.js` drives the real app through one complete sale and records it as
`docs/user-manual/videos/sales-entry.mp4` (1440×900, ~3.5 min, with a male
voice-over).

It is a screen recording of the live UI, not a mock-up. `overlay.js` is injected
into the page and draws on top of it: step captions, hand-drawn boxes, arrows
and labels (Caveat font, `caveat.woff2`, SIL OFL), a visible cursor with click
ripples, and the title and recap cards. Frames come from a Chrome DevTools
screencast, so text stays sharp, and ffmpeg encodes them to H.264.

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

## Voice-over

`narration.json` holds the spoken line for each caption (keyed by the caption
title, plus `intro` and `outro`). It is written for the ear, so *ERP71* is
spelled out as "E R P seventy-one" and *bKash* as "bee-cash".

`narrate.py` turns it into speech with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx)
(model Apache-2.0; voice `am_michael`, US English, male). It runs fully offline
and writes the clips to `.audio/` (gitignored). `record.js` then holds each
scene until its line has been spoken, logs when each caption appeared, and
mixes the clips onto the video at those moments (loudness-normalised to −16 LUFS).

```bash
pip install kokoro-onnx soundfile
# kokoro-v1.0.onnx + voices-v1.0.bin from the kokoro-onnx GitHub release "model-files-v1.0"
KOKORO_DIR=/path/to/model-files python3 scripts/explainer-video/narrate.py
```

Optional env: `KOKORO_VOICE` (e.g. `am_fenrir`, `bm_george`) and `KOKORO_SPEED`.
Skip this step to record a silent video.

To change what is said, edit `narration.json` and re-run both steps. Scene
timing follows the voice automatically.

The Piper voices "Ryan" and "Alan" were ruled out: Ryan's training data is
CC BY-NC-SA (non-commercial), and Alan is fine-tuned from Ryan.

## Re-recording

Run this after changing the sales entry screen, so the video still matches it.

1. Start the stack against a **freshly seeded** local database (the demo tenant
   from `packages/database/prisma/seed.ts`). The script signs in as
   `nayeem.ahmad@gmail.com` / `password123` and picks *Dhaka Retail Co.*
   Mark the user's email verified, or the verify-email banner will cover the
   header:
   ```sql
   update "User" set email_verified_at = now();
   ```
2. Generate the voice-over (above), then record:
   ```bash
   node scripts/explainer-video/record.js
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
