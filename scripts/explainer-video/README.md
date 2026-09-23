# Explainer videos

Annotated screen recordings of the real app (1440×900), each walking through one
complete task:

| Video | File | Length | Voice |
|---|---|---|---|
| Sales entry | `docs/user-manual/videos/sales-entry.mp4` | ~3.5 min | male, Kokoro `am_michael` |
| Sales entry, Bangla | `docs/user-manual/videos/sales-entry.bn.mp4` | ~3.5 min | male, Azure `bn-BD-PradeepNeural`. **Silent until an Azure Speech key is available** (see below) |
| Purchase entry | `docs/user-manual/videos/purchase-entry.mp4` | ~3 min | male, Kokoro `am_michael` |
| Customer payment | `docs/user-manual/videos/customer-payment.mp4` | ~2 min | male, Kokoro `am_michael` |
| Supplier payment | `docs/user-manual/videos/supplier-payment.mp4` | ~2 min | male, Kokoro `am_michael` |
| Stock transfer | `docs/user-manual/videos/stock-transfer.mp4` | ~2 min | male, Kokoro `am_michael` |

These are not mock-ups. `overlay.js` is injected into the live page and draws on
top of it: step captions, hand-drawn boxes, arrows and labels, a visible cursor
with click ripples, and the title and recap cards. Frames come from a Chrome
DevTools screencast, so text stays sharp, and ffmpeg encodes them to H.264.

Fonts (`fonts/`, all SIL OFL): Caveat for the English handwriting, Galada for
Bangla handwriting, Hind Siliguri for Bangla captions and cards.

## Layout

| Path | What it is |
|---|---|
| `record.js` | CLI: `node record.js <video>` |
| `lib/recorder.js` | the shared engine: sign-in, page warm-up, overlay, screencast, helpers (`say`, `click`, `type`, `box`, …), voice pacing, encoding |
| `videos/<video>.js` | one video's scenes only: `{ warm, start, setup?(api), run(helpers) }` |
| `lib/api.js` | a small API client for `setup` |
| `lang/<video>.<lang>.json` | the voice-over, plus translated captions/labels/cards for non-English versions |
| `narrate.py` | text-to-speech: `python3 narrate.py <video> [lang]` |

`setup(api)`, when a video has one, runs before the browser opens and creates
the state the video starts from through the app's own API: a credit sale so a
customer owes money, or purchases so a supplier has open bills. The balances
on screen are then ones the app computed itself. The seeded demo data can't be
used for this, because its purchases and part-paid sales never updated the
customer and supplier balances (see TODO.md).

The browser runs in the `Asia/Dhaka` time zone, as a shop's would.
`ov('captionAt', 'side')` moves the caption beside a centred dialog when the
bottom bar would cover the dialog's buttons; `'bottom'` puts it back.

To add a video, copy `videos/purchase-entry.js` and `lang/purchase-entry.en.json`,
rewrite the scenes and lines, and make sure every caption title has a narration
line (a missing one fails the run).

## Scenes

**Sales entry**: 1. Sales → Sales list → New Sales Entry · 2. the three areas ·
3. document details (Sales #, Ref #, date, warehouse) · 4. till / cashier shift ·
5. customer search and card (+ new customer, walk-in) · 6. product search,
previous sale rates, qty → Add · 7. more lines · 8. editing a line · 9. whole-bill
discount and live total · 10. split payment (mobile wallet + cash), credit ·
11. note · 12. Save Draft vs Create Sale · 13. print prompt · 14. the sale in the
list.

**Purchase entry**: 1. Purchase → Purchases → Record Purchase · 2. the three
areas · 3. purchase details (Purchase #, warehouse, per-line warehouse) ·
4. supplier search and card (payable, + new supplier) · 5. product search ·
6. unit cost: overwrite the selling price with the supplier's rate, using
previous purchase rates · 7. more lines · 8. editing a line (In Stock is before
the purchase) · 9. freight / tax / discount and live total · 10. part-payment,
the rest as supplier due · 11. note (supplier invoice no.) · 12. Post Purchase ·
13. the purchase in the list with its posted voucher.

**Customer payment** (setup: Karim Hossain buys ৳2,050 on credit and pays
৳500): 1. Sales → Customer Payment · 2. the list and filters · 3. New Customer
Payment · 4. receive vs pay back · 5. pick the customer, due ৳1,550 · 6. ৳1,000
part payment, advance on overpayment, note · 7. Record receipt · 8. the receipt
on the list · 9. due balance now ৳550.

**Supplier payment** (setup: Meghna Traders, one ৳6,320 purchase with ৳3,000
paid, one ৳4,800 unpaid): 1. Purchase → Supplier Payment · 2. the list (the
payment made on the purchase is there too) · 3. New Supplier Payment, pay vs
receive · 4. pick the supplier, payable ৳8,120 and open bills · 5. ৳5,000 split
across the two bills · 6. Record payment (unallocated = prepayment) · 7. on the
list · 8. payable now ৳3,120, one bill left.

**Stock transfer**: 1. Inventory → Transfers · 2. form on top, list below ·
3. source and destination (another branch needs approval) · 4. Send Now vs
draft, note · 5. products and quantities, Add Line · 6. Create Transfer → Sent,
in transit · 7. View · 8. receive 20 rice and 8 of 10 lentils → partially
received · 9. receive the last 2 → complete, with the timeline.

## Languages

`lang/<video>.<lang>.json` holds everything that changes per language:

- `narration`: the spoken line for each scene, keyed by the English caption
  title, plus `intro` and `outro`. It is written for the ear: *ERP71* becomes
  "E R P seventy-one" in English and "ই আর পি সেভেন্টি ওয়ান" in Bangla.
- `captions`, `labels`, `cards` (not needed for English, which is inline in the
  video script): the translated on-screen text, keyed by the English string. A
  missing key fails the run rather than leaking English into the video.

The app UI stays in English in the Bangla version. The New Sale screen is only
partly translated today (see TODO.md), so the Bangla captions name buttons by
the English label actually on screen.

To add a language, copy `lang/sales-entry.bn.json`, translate it, and run with
`VIDEO_LANG=<code>`.

## Voice-over

`narrate.py <video> [lang]` turns the narration into one WAV per scene in
`.audio/<video>/<lang>/` (gitignored), plus `durations.json`. `record.js` then
holds each scene until its line has been spoken, logs when each caption
appeared, and mixes the clips onto the video at those moments
(loudness-normalised to −16 LUFS). With no `durations.json` it records a silent
video on default pacing.

| Engine (`TTS=`) | Used for | Needs |
|---|---|---|
| `kokoro` | English default | `pip install kokoro-onnx soundfile`; `KOKORO_DIR` holding `kokoro-v1.0.onnx` + `voices-v1.0.bin` (kokoro-onnx GitHub release `model-files-v1.0`). Offline, Apache-2.0. Optional `KOKORO_VOICE` (default `am_michael`), `KOKORO_SPEED` |
| `azure` | Bangla default | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (default `southeastasia`), and network access to `<region>.tts.speech.microsoft.com`. Voice comes from the language file (`bn-BD-PradeepNeural`, male, Bangladeshi). Optional `AZURE_VOICE`, `AZURE_RATE` (e.g. `-5%`) |
| `estimate` | Bangla when no Azure key is set | nothing. Writes timings from text length only, so a silent video is paced as if narrated |
| `files` | human recordings | put `00.wav`, `01.wav`, … (narration order) in `.audio/<video>/<lang>/`; this measures them |

Voices ruled out: the Piper voices "Ryan" and "Alan" (Ryan's training data is
CC BY-NC-SA, non-commercial; Alan is fine-tuned from Ryan). No offline model
reachable here speaks Bangladeshi Bangla. Meta MMS-TTS Bengali is CC BY-NC, and
Google Cloud only offers Indian Bangla (`bn-IN`).

## Re-recording

Run this after changing a screen a video covers, so the video still matches it.

1. Start the stack against a **freshly seeded** local database (the demo tenant
   from `packages/database/prisma/seed.ts`). The script signs in as
   `nayeem.ahmad@gmail.com` / `password123` and picks *Dhaka Retail Co.*
   Mark the user's email verified, or the verify-email banner will cover the
   header:
   ```sql
   update "User" set email_verified_at = now();
   ```
2. Generate the voice-over, then record. Reseed between videos, so each video's
   new sale or purchase is the only new row in its list:
   ```bash
   python3 scripts/explainer-video/narrate.py sales-entry && node scripts/explainer-video/record.js sales-entry
   python3 scripts/explainer-video/narrate.py sales-entry bn && VIDEO_LANG=bn node scripts/explainer-video/record.js sales-entry
   python3 scripts/explainer-video/narrate.py purchase-entry && node scripts/explainer-video/record.js purchase-entry
   # …and the same for customer-payment, supplier-payment, stock-transfer
   ```
   Optional env: `BASE_URL` (default `http://localhost:3000`), `CHROMIUM_PATH`
   (a Chromium binary, if Playwright's own is not installed) and `FFMPEG` (the
   ffmpeg binary, default `ffmpeg` on `PATH`).

The scripts wait on real UI text and labels (`Search by name or phone…`,
`aria-label="Qty"`, `Post Purchase`, …). If a label changes, the run fails at
that step instead of recording a broken video. The captions are part of the
page too, so a `getByText` that could also match a caption needs `.first()`
(the app's element comes before the overlay).

The sales video leaves out Transport, Labour, Rounding and per-line Disc % on
purpose. Today the backend rejects a sale that uses them (see TODO.md), so it
only shows paths that save successfully. Freight, tax and discount on a
purchase do save, and the purchase video uses freight.
