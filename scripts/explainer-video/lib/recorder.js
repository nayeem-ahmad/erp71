// The recording engine shared by every explainer video: signs in, injects the
// overlay, captures a CDP screencast, paces scenes to the voice-over and
// encodes the result. A video is a module in ../videos/ that only describes
// its scenes; see README.md.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect } = require('./api');

const DIR = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const W = 1440, H = 900;

/**
 * @param {string} name   video name: videos/<name>.js, lang/<name>.<lang>.json
 * @param {string} LANG   language code; captions/labels/cards come from the
 *                         language file for anything but English
 */
async function record(name, LANG = 'en') {
  const video = require(path.join(DIR, 'videos', `${name}.js`));
  const langFile = path.join(DIR, 'lang', `${name}.${LANG}.json`);
  const copy = JSON.parse(fs.readFileSync(langFile, 'utf8'));
  const OUT = path.resolve(DIR, '../../docs/user-manual/videos', LANG === 'en' ? `${name}.mp4` : `${name}.${LANG}.mp4`);
  // Voice-over from narrate.py. Absent means a silent recording.
  const VOICE_FILE = path.join(DIR, '.audio', name, LANG, 'durations.json');
  const voice = fs.existsSync(VOICE_FILE) ? JSON.parse(fs.readFileSync(VOICE_FILE, 'utf8')) : null;

  const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(DIR, 'fonts', f)).toString('base64');
  const overlay = fs.readFileSync(path.join(DIR, 'overlay.js'), 'utf8')
    .replace('__CAVEAT__', font('caveat.woff2'))
    .replace('__GALADA__', font('galada-bengali-400-normal.woff2'))
    .replace('__HIND_400__', font('hind-siliguri-bengali-400-normal.woff2'))
    .replace('__HIND_700__', font('hind-siliguri-bengali-700-normal.woff2'));

  // Starting state the video needs (a customer who owes money, a supplier
  // with open bills), created through the app's own API before recording.
  if (video.setup) await video.setup(await connect());

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1,
    // What a shop in Bangladesh sees; a UTC runner would show some times six
    // hours off from the ones the server formats in the tenant's zone.
    timezoneId: 'Asia/Dhaka', locale: 'en-GB' });
  await ctx.addInitScript(overlay);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(180000);

  // ── login (not recorded) ───────────────────────────────────────────────
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="name@company"]', 'nayeem.ahmad@gmail.com');
  await page.fill('input[type=password]', 'password123');
  await page.keyboard.press('Enter');
  await page.click('text=Dhaka Retail Co.');
  await page.waitForURL('**/dashboard');
  await page.waitForLoadState('networkidle');
  // Visit every page once before recording, so a dev server compiles them
  // now rather than leaving dead air in the middle of the video.
  for (const warm of video.warm) {
    await page.goto(BASE + warm, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
  }
  await page.goto(BASE + video.start, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  await page.evaluate(() => { __ov.ensure(); __ov.showCursor(false); });

  // ── screencast ─────────────────────────────────────────────────────────
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-frames-`));
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(frameDir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  // ── helpers ────────────────────────────────────────────────────────────
  const wait = (ms) => page.waitForTimeout(ms);
  // Hand-drawn labels are written in English here and swapped for the
  // language's own on the way into the page.
  const label = (text) => {
    if (LANG === 'en' || typeof text !== 'string') return text;
    if (!copy.labels?.[text]) throw new Error(`lang/${name}.${LANG}.json has no label for "${text}"`);
    return copy.labels[text];
  };
  const ov = (fn, ...args) => {
    if (fn === 'box') args[1] = label(args[1]);
    if (fn === 'label') args[0] = label(args[0]);
    return page.evaluate(([fn, args]) => __ov[fn](...args), [fn, args]);
  };
  const caption = (n, title, body) => {
    if (LANG === 'en') return ov('caption', n, title, body);
    const t = copy.captions?.[title];
    if (!t) throw new Error(`lang/${name}.${LANG}.json has no caption for "${title}"`);
    return ov('caption', n, t[0], t[1]);
  };
  const box = async (loc) => {
    const b = await (typeof loc === 'string' ? page.locator(loc).first() : loc).boundingBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const union = (...rs) => {
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
    return { x, y, w: x2 - x, h: y2 - y };
  };
  const moveTo = async (loc, ox = 0.5, oy = 0.5) => {
    const r = await box(loc);
    const x = r.x + r.w * ox, y = r.y + r.h * oy;
    await ov('move', x, y);
    await wait(800);
    return { x, y };
  };
  const click = async (loc, opts = {}) => {
    const l = typeof loc === 'string' ? page.locator(loc).first() : loc;
    const { x, y } = await moveTo(l, opts.ox ?? 0.5, opts.oy ?? 0.5);
    await ov('ripple', x, y);
    await l.click({ position: undefined });
    await wait(opts.after ?? 400);
  };
  const type = async (loc, text, opts = {}) => {
    const l = typeof loc === 'string' ? page.locator(loc).first() : loc;
    await click(l, { ox: opts.ox ?? 0.3 });
    if (opts.clear) { await l.selectText(); await wait(150); }
    await l.pressSequentially(text, { delay: opts.delay ?? 110 });
    await wait(opts.after ?? 600);
  };
  // Each spoken line starts only once the previous one has finished, and the
  // wall-clock start of each is kept so the clips can be laid onto the video.
  const cues = [];
  let voiceEnd = 0;
  const holdVoice = async () => { const left = voiceEnd - Date.now(); if (left > 0) await wait(left); };
  const narrate = async (key) => {
    if (!voice) return;
    if (!voice[key]) throw new Error(`lang/${name}.${LANG}.json narration has no line for "${key}"`);
    await holdVoice();
    cues.push({ ...voice[key], t: Date.now() / 1000 });
    voiceEnd = Date.now() + voice[key].dur * 1000 + 400;
  };
  const say = async (n, title, body, hold = 0) => { await narrate(title); await caption(n, title, body); await wait(hold); };
  // Scene-ending clear: keeps the drawings up until the voice has finished
  // talking about them. Mid-scene tidying uses ov('clear') directly.
  const clear = async () => { await holdVoice(); await ov('clear'); };

  const cardHtml = (k, h, p, extra = '') => `<div class="k">${k}</div><h1>${h}</h1><p>${p}</p>${extra}`;
  const card = (name, html) => ov('card', LANG === 'en' ? html : copy.cards[name]);

  // ── the video's own scenes ─────────────────────────────────────────────
  await video.run({
    page, BASE, W, H, voice, wait, ov, caption, box, union, moveTo, click, type,
    narrate, holdVoice, say, clear, cardHtml, card,
  });

  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  // ffmpeg concat list: each frame lasts until the next one arrived.
  const lines = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(frameDir, 'list.txt'), lines.join('\n'));
  console.log('frames', frames.length, 'seconds', (end - frames[0].t).toFixed(1));
  await browser.close();

  // Each voice clip is delayed to the moment its caption appeared, then all
  // are mixed into one track (clips never overlap; see narrate()).
  // A cue without a file is a timing-only estimate (narrate.py --estimate):
  // it paced the scenes but adds no sound.
  const spoken = cues.filter((c) => c.file);
  const audioArgs = [];
  if (spoken.length) {
    const cues = spoken;
    const t0 = frames[0].t;
    cues.forEach((c) => audioArgs.push('-i', c.file));
    const delays = cues.map((c, i) => {
      const ms = Math.max(0, Math.round((c.t - t0) * 1000));
      return `[${i + 1}:a]adelay=${ms}:all=1[v${i}]`;
    });
    const mix = cues.map((_, i) => `[v${i}]`).join('') + `amix=inputs=${cues.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;
    audioArgs.push('-filter_complex', [...delays, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  }
  execFileSync(process.env.FFMPEG || 'ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frameDir, 'list.txt'),
    ...audioArgs,
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', OUT,
  ], { stdio: 'inherit' });
  fs.rmSync(frameDir, { recursive: true, force: true });
  console.log('wrote', OUT);
}

module.exports = { record };
