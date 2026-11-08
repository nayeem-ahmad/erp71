/**
 * ERP71 — বিক্রয়, ক্রয়, খরচ ও স্টকের বাইরের টাকার ঘটনা।
 * প্রাথমিক প্রশিক্ষণ ডেক। ইংরেজি সংস্করণের ২২ স্লাইডের বাংলা রূপ।
 *
 * Palette: cream, deep navy, sage. Kohinoor Bangla.
 * LAYOUT_WIDE 13.333" × 7.5".
 *
 * UI labels match apps/frontend bn locale.
 * Default COA names stay English (Cash in Hand, Owner's Equity, …).
 * No charSpacing on Bengali (breaks conjuncts). No italic (Kohinoor italic is unreliable).
 */

const pptxgen = require("pptxgenjs");

const COLORS = {
  bg: "F1ECDF",
  ink: "1A1A1A",
  navy: "1F3DA8",
  navyLight: "8FA4D9",
  muted: "6B6B6B",
  mutedSoft: "9A9A9A",
  divider: "D9D2C2",
  sage: "8FA67E",
  white: "FFFFFF",
  debitTint: "E8ECF8",
  creditTint: "E8EFE4",
  warnTint: "F6EDE4",
};

const FONT_BODY = "Kohinoor Bangla";
const FONT_TITLE = "Kohinoor Bangla";
const W = 13.333;
const H = 7.5;
const TOTAL = 22;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "ERP71 হিসাব — অন্যান্য টাকার ঘটনা";
pres.author = "ERP71";
pres.company = "ERP71";
pres.subject = "বিক্রয়, ক্রয়, খরচ ও ইনভেন্টরির বাইরের আর্থিক ঘটনা কীভাবে লিখবেন — প্রাথমিক গাইড";

function shadowSoft() {
  return { type: "outer", color: "000000", blur: 12, offset: 2, angle: 90, opacity: 0.06 };
}

function addChrome(slide, { topLabel, page, section }) {
  slide.addText(topLabel, {
    x: 0.7, y: 0.42, w: 8.5, h: 0.34,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted,
    margin: 0, isTextBox: true,
  });
  slide.addText(`${String(page).padStart(2, "0")}  /  ${String(TOTAL).padStart(2, "0")}`, {
    x: 0.7, y: 7.08, w: 2.4, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted,
    margin: 0, isTextBox: true,
  });
  slide.addText(section, {
    x: W - 5.2, y: 7.08, w: 4.5, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted,
    align: "right", margin: 0, isTextBox: true,
  });
}

function addHairline(slide, x, y, w) {
  slide.addShape(pres.shapes.LINE, {
    x, y, w, h: 0,
    line: { color: COLORS.divider, width: 0.75 },
  });
}

function addCard(slide, { x, y, w, h, fill }) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: fill || COLORS.white },
    line: { color: COLORS.divider, width: 0.5 },
    shadow: shadowSoft(),
  });
}

function addSlideTitle(slide, runs, { y, h, fontSize } = {}) {
  slide.addText(runs, {
    x: 0.7, y: y ?? 0.82, w: 12.0, h: h ?? 0.95,
    fontFace: FONT_TITLE, fontSize: fontSize ?? 30, bold: false,
    valign: "top", margin: 0, isTextBox: true,
  });
}

function entryRows(debit, credit, amount) {
  const head = {
    fill: { color: COLORS.ink },
    color: COLORS.white,
    bold: true,
    fontFace: FONT_BODY,
    fontSize: 11,
    align: "center",
    valign: "middle",
  };
  const cell = {
    fontFace: FONT_BODY,
    fontSize: 13,
    color: COLORS.ink,
    valign: "middle",
    align: "left",
  };
  const amt = {
    fontFace: FONT_BODY,
    fontSize: 13,
    color: COLORS.ink,
    valign: "middle",
    align: "right",
    bold: true,
  };
  return [
    [
      { text: "হিসাব", options: { ...head, align: "left" } },
      { text: "ডেবিট", options: head },
      { text: "ক্রেডিট", options: head },
    ],
    [
      { text: debit, options: { ...cell, fill: { color: COLORS.debitTint } } },
      { text: amount, options: { ...amt, fill: { color: COLORS.debitTint }, color: COLORS.navy } },
      { text: "", options: { ...amt, fill: { color: COLORS.debitTint } } },
    ],
    [
      { text: credit, options: { ...cell, fill: { color: COLORS.creditTint } } },
      { text: "", options: { ...amt, fill: { color: COLORS.creditTint } } },
      { text: amount, options: { ...amt, fill: { color: COLORS.creditTint }, color: "3D5A32" } },
    ],
  ];
}

function addEntryTable(slide, { x, y, w, h, debit, credit, amount }) {
  slide.addTable(entryRows(debit, credit, amount), {
    x, y, w, h,
    colW: [w * 0.5, w * 0.25, w * 0.25],
    border: [{ pt: 0 }, { pt: 0 }, { pt: 0 }, { pt: 0 }],
    fontFace: FONT_BODY,
  });
}

// ============================================================================
// SLIDE 1 — Title
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };

  s.addText("ERP71  ·  হিসাব  ·  প্রাথমিক ক্লাস", {
    x: 0.7, y: 0.5, w: 7.4, h: 0.38,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink,
    margin: 0, isTextBox: true,
  });
  s.addText("দোকান মালিক ও কর্মীদের জন্য", {
    x: 8.6, y: 0.5, w: 4.05, h: 0.38,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted,
    align: "right", margin: 0, isTextBox: true,
  });

  s.addText(
    [
      { text: "কাউন্টারের বাইরের", options: { color: COLORS.ink, breakLine: true } },
      { text: "টাকার ঘটনা।", options: { color: COLORS.navy } },
    ],
    {
      x: 0.65, y: 1.65, w: 12.2, h: 2.5,
      fontFace: FONT_TITLE, fontSize: 48, bold: false,
      valign: "top", margin: 0, isTextBox: true,
    }
  );

  s.addText("ঋণ, মালিকের টাকা, ব্যাংক স্থানান্তর, আদায় — হিসাব মডিউলে ছোট উদাহরণ দিয়ে কীভাবে লিখবেন।", {
    x: 0.7, y: 4.45, w: 11.2, h: 1.0,
    fontFace: FONT_BODY, fontSize: 18, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  s.addShape(pres.shapes.OVAL, {
    x: W - 2.0, y: H - 1.9, w: 1.05, h: 1.05,
    fill: { color: COLORS.navy }, line: { type: "none" },
  });

  s.addText("বিক্রয়, ক্রয়, খরচ ও স্টক নিজে থেকেই পোস্ট হয়", {
    x: 0.7, y: H - 0.58, w: 10.5, h: 0.34,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink,
    margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 2 — What this class covers
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "০১  —  পরিধি", page: 2, section: "পরিধি" });

  addSlideTitle(s, [
    { text: "ERP71 যে চারটি কাজ ", options: { color: COLORS.ink } },
    { text: "নিজেই বইতে লেখে।", options: { color: COLORS.navy } },
  ]);

  const items = [
    { n: "০১", t: "একটি বিক্রয়", d: "পিওএস বা বিক্রয়। নগদ, বিকাশ, Nagad, ব্যাংক বা বাকি — ভাউচার আপনার হয়ে তৈরি হয়।" },
    { n: "০২", t: "একটি ক্রয়", d: "ক্রয়। স্টক আসে, Purchase Payable ওঠে। এটা জার্নালে লিখবেন না।" },
    { n: "০৩", t: "দোকানের খরচ", d: "খরচ। ভাড়া, বিদ্যুৎ, যাতায়াত, চা-নাস্তা। হেড ও পেমেন্ট পদ্ধতি বেছে নিন।" },
    { n: "০৪", t: "স্টক সরানো", d: "ট্রান্সফার, স্টক টেক, শ্রিংকেজ। পরিমাণ যায়। আলাদা টাকার ভাউচার লাগে না।" },
  ];

  items.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.7 + col * 6.15;
    const y = 2.05 + row * 2.25;
    addCard(s, { x, y, w: 5.85, h: 2.05 });
    s.addText(it.n, {
      x: x + 0.3, y: y + 0.22, w: 1.2, h: 0.3,
      fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
    });
    s.addText(it.t, {
      x: x + 0.3, y: y + 0.54, w: 5.25, h: 0.42,
      fontFace: FONT_TITLE, fontSize: 22, color: COLORS.ink, margin: 0, isTextBox: true,
    });
    s.addText(it.d, {
      x: x + 0.3, y: y + 1.05, w: 5.25, h: 0.8,
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });
}

// ============================================================================
// SLIDE 3 — Golden rule
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "০২  —  নিয়ম", page: 3, section: "নিয়ম" });

  s.addText(
    [
      { text: "যে ঘটনার স্ক্রিন আছে,", options: { color: COLORS.ink, breakLine: true } },
      { text: "সেই স্ক্রিনেই লিখুন।", options: { color: COLORS.navy } },
    ],
    {
      x: 0.7, y: 1.1, w: 12.0, h: 1.9,
      fontFace: FONT_TITLE, fontSize: 38, margin: 0, isTextBox: true,
    }
  );

  addHairline(s, 0.7, 3.25, W - 1.4);

  const cols = [
    { k: "নিজস্ব স্ক্রিন", t: "গ্রাহক পেমেন্ট, সরবরাহকারী পেমেন্ট, ঋণ, বিনিয়োগকারী, বেতন, স্থায়ী সম্পদ, প্রারম্ভিক ব্যালেন্স, শাখায় নগদ পাঠানো, মওকুফকৃত বকেয়া।" },
    { k: "ভাউচার এন্ট্রি", t: "মালিকের মূলধন আনা-নেওয়া, নগদ ব্যাংকে জমা, অন্য আয়, ব্যাংক চার্জ, এনবিআর-এ কর, আর যা বাকি থাকে।" },
    { k: "কেন জরুরি", t: "স্ক্রিন ব্যক্তি ও বই একসাথে হালনাগাদ করে। শুধু ভাউচার বই বদলায় — গ্রাহক তখনও বাকি দেখায়।" },
  ];
  cols.forEach((c, i) => {
    const x = 0.7 + i * 4.15;
    s.addText(c.k, {
      x, y: 3.5, w: 3.9, h: 0.38,
      fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
    });
    s.addText(c.t, {
      x, y: 3.95, w: 3.9, h: 2.55,
      fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });
}

// ============================================================================
// SLIDE 4 — Debit and credit
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "০৩  —  ডেবিট ও ক্রেডিট", page: 4, section: "মূল কথা" });

  addSlideTitle(s, [
    { text: "এক ছবি: ", options: { color: COLORS.ink } },
    { text: "মূল্য এলো, মূল্য গেল।", options: { color: COLORS.navy } },
  ]);

  s.addText("যে হিসাব মূল্য পেল, সেটা ডেবিট। যে হিসাব মূল্য দিল, সেটা ক্রেডিট। দুই অঙ্ক সমান হতে হবে।", {
    x: 0.7, y: 1.82, w: 12.0, h: 0.52,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 0.7, y: 2.5, w: 5.85, h: 4.15, fill: COLORS.debitTint });
  s.addText("ডেবিট  ·  বাম কলাম", {
    x: 1.0, y: 2.7, w: 5.25, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.navy, margin: 0, isTextBox: true,
  });
  s.addText("বাড়ল, বা টাকা পেল।", {
    x: 1.0, y: 3.1, w: 5.25, h: 0.45,
    fontFace: FONT_TITLE, fontSize: 20, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  s.addText("Cash in Hand, Main Bank, bKash, Nagad, গ্রাহকের বাকি, কেনা ফ্রিজ, হওয়া খরচ।", {
    x: 1.0, y: 3.65, w: 5.25, h: 1.55,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  s.addText("উদাহরণ: ড্রয়ারে নগদ এলো → Cash in Hand ডেবিট।", {
    x: 1.0, y: 5.4, w: 5.25, h: 0.9,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.navy, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 6.8, y: 2.5, w: 5.85, h: 4.15, fill: COLORS.creditTint });
  s.addText("ক্রেডিট  ·  ডান কলাম", {
    x: 7.1, y: 2.7, w: 5.25, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: "3D5A32", margin: 0, isTextBox: true,
  });
  s.addText("টাকা দিল, বা এখন দেনা।", {
    x: 7.1, y: 3.1, w: 5.25, h: 0.45,
    fontFace: FONT_TITLE, fontSize: 20, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  s.addText("সরবরাহকারীর দেনা, ব্যাংক ঋণ, Owner's Equity, Investor Capital, Sales Revenue, অন্য আয়।", {
    x: 7.1, y: 3.65, w: 5.25, h: 1.55,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  s.addText("উদাহরণ: মালিক টাকা দিলেন → Owner's Equity ক্রেডিট।", {
    x: 7.1, y: 5.4, w: 5.25, h: 0.9,
    fontFace: FONT_BODY, fontSize: 14, color: "3D5A32", margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 5 — Two doors
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "০৪  —  কোথায় যাবেন", page: 5, section: "কোথায় যাবেন" });

  addSlideTitle(s, [
    { text: "দুই দরজা। ", options: { color: COLORS.ink } },
    { text: "যেটা মিলে, সেটাই খুলুন।", options: { color: COLORS.navy } },
  ]);

  const doors = [
    { n: "ক", title: "নির্দিষ্ট স্ক্রিন", lines: [
      "বিক্রয় → গ্রাহক পেমেন্ট",
      "ক্রয় → সরবরাহকারী পেমেন্ট",
      "হিসাব → ঋণ",
      "হিসাব → বিনিয়োগকারী",
      "হিসাব → স্থায়ী সম্পদ",
      "হিসাব → প্রারম্ভিক ব্যালেন্স",
      "হিসাব → তহবিল স্থানান্তর",
      "এইচআর → বেতন প্রদান",
      "বিক্রয় → মওকুফকৃত বকেয়া",
    ]},
    { n: "খ", title: "ভাউচার এন্ট্রি", lines: [
      "হিসাব → ভাউচার এন্ট্রি",
      "নগদ গ্রহণ — ড্রয়ারে টাকা এলো",
      "নগদ প্রদান — ড্রয়ার থেকে টাকা গেল",
      "ব্যাংক গ্রহণ — ব্যাংকে টাকা এলো",
      "ব্যাংক প্রদান — ব্যাংক থেকে টাকা গেল",
      "তহবিল স্থানান্তর — নগদ ↔ ব্যাংক ↔ ওয়ালেট",
      "জার্নাল — অন্য যা ভারসাম্যপূর্ণ",
    ]},
  ];

  doors.forEach((d, i) => {
    const x = 0.7 + i * 6.2;
    addCard(s, { x, y: 1.95, w: 5.9, h: 4.75 });
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.28, y: 2.18, w: 0.42, h: 0.42,
      fill: { color: COLORS.navy }, line: { type: "none" },
    });
    s.addText(d.n, {
      x: x + 0.28, y: 2.22, w: 0.42, h: 0.36,
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.white, align: "center", margin: 0, isTextBox: true,
    });
    s.addText(d.title, {
      x: x + 0.85, y: 2.18, w: 4.7, h: 0.42,
      fontFace: FONT_TITLE, fontSize: 20, color: COLORS.ink, margin: 0, isTextBox: true,
    });
    d.lines.forEach((line, li) => {
      s.addText(line, {
        x: x + 0.35, y: 2.78 + li * 0.4, w: 5.25, h: 0.38,
        fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
      });
    });
  });
}

// ============================================================================
// SLIDE 6 — Voucher types
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "০৫  —  ভাউচারের ধরন", page: 6, section: "ভাউচার" });

  addSlideTitle(s, [
    { text: "ছয় ধরনের ভাউচার, ", options: { color: COLORS.ink } },
    { text: "প্রত্যেকের এক কাজ।", options: { color: COLORS.navy } },
  ], { fontSize: 28, h: 0.72 });

  const types = [
    { name: "নগদ গ্রহণ", use: "ড্রয়ারে নগদ এলো। মালিকের মূলধন, অন্য আয়, নগদে পাওয়া রিফান্ড।" },
    { name: "নগদ প্রদান", use: "ড্রয়ার থেকে নগদ গেল। মালিকের উত্তোলন, খরচ নয় এমন এককালীন নগদ প্রদান।" },
    { name: "ব্যাংক গ্রহণ", use: "ব্যাংকে টাকা এলো। চেকে মূলধন, অনুদান, জমা হওয়া সুদ।" },
    { name: "ব্যাংক প্রদান", use: "ব্যাংক থেকে টাকা গেল। ব্যাংক চার্জ, এনবিআর-এ কর, এককালীন ব্যাংক প্রদান।" },
    { name: "তহবিল স্থানান্তর", use: "শুধু নগদ, ব্যাংক ও ওয়ালেট। ড্রয়ার থেকে Premier Bank, ব্যাংক থেকে বিকাশ।" },
    { name: "জার্নাল ভাউচার", use: "নগদ নড়েনি, বা মিশ্র হিসাব। প্রারম্ভিক ব্যালেন্স আলাদা স্ক্রিনে, যা একটি জার্নাল পোস্ট করে।" },
  ];

  types.forEach((t, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.7 + col * 4.15;
    const y = 1.85 + row * 2.45;
    addCard(s, { x, y, w: 3.95, h: 2.25 });
    s.addText(String(i + 1).padStart(2, "0"), {
      x: x + 0.22, y: y + 0.18, w: 1.0, h: 0.28,
      fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, margin: 0, isTextBox: true,
    });
    s.addText(t.name, {
      x: x + 0.22, y: y + 0.48, w: 3.5, h: 0.42,
      fontFace: FONT_TITLE, fontSize: 17, color: COLORS.navy, margin: 0, isTextBox: true,
    });
    s.addText(t.use, {
      x: x + 0.22, y: y + 0.98, w: 3.5, h: 1.05,
      fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });
}

// ============================================================================
// SLIDE 7 — How to post a voucher
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "০৬  —  কীভাবে পোস্ট", page: 7, section: "কীভাবে পোস্ট" });

  addSlideTitle(s, [
    { text: "ভাউচার এন্ট্রিতে ", options: { color: COLORS.ink } },
    { text: "পাঁচটি ক্লিক।", options: { color: COLORS.navy } },
  ]);

  const steps = [
    { n: "1", t: "ওয়ার্কবেঞ্চ খুলুন", d: "হিসাব → ভাউচার এন্ট্রি। টাকার সাথে মিলে এমন ভাউচার ধরন বেছে নিন।" },
    { n: "2", t: "তারিখ ও বিবরণ", d: "আজকের তারিখ চলবে। বিবরণ আবশ্যক — যেমন “মালিকের মূলধন — জুন।”" },
    { n: "3", t: "দুই সারি, দুই পাশ", d: "সারি ১: ডেবিট হিসাব ও অঙ্ক। সারি ২: ক্রেডিট হিসাব ও একই অঙ্ক। মোটে ভারসাম্যপূর্ণ লিখবে।" },
    { n: "4", t: "শাখা বেছে নিন", d: "নগদ লাইনে সেই শাখার ড্রয়ার লাগে। ব্যাংক ও বিকাশ/Nagad কোম্পানি-ব্যাপী।" },
    { n: "5", t: "ভাউচার পোস্ট করুন", d: "নম্বর আপনাআপনি হয়। হিসাব → লেজার খুলে নগদ হিসাবে দেখুন।" },
  ];

  steps.forEach((st, i) => {
    const y = 1.88 + i * 0.96;
    s.addShape(pres.shapes.OVAL, {
      x: 0.7, y: y + 0.08, w: 0.48, h: 0.48,
      fill: { color: COLORS.navy }, line: { type: "none" },
    });
    s.addText(st.n, {
      x: 0.7, y: y + 0.14, w: 0.48, h: 0.38,
      fontFace: FONT_BODY, fontSize: 15, color: COLORS.white, align: "center", margin: 0, isTextBox: true,
    });
    s.addText(st.t, {
      x: 1.45, y: y, w: 3.9, h: 0.55,
      fontFace: FONT_TITLE, fontSize: 16, color: COLORS.ink, margin: 0, isTextBox: true,
    });
    s.addText(st.d, {
      x: 5.5, y: y, w: 7.1, h: 0.85,
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });
}

function addExampleSlide(opts) {
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: opts.topLabel, page: opts.page, section: opts.section });

  addSlideTitle(s, opts.title, { fontSize: 28, h: 0.72 });

  s.addText(opts.story, {
    x: 0.7, y: 1.58, w: 12.0, h: 0.72,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 0.7, y: 2.4, w: 5.9, h: 4.25 });
  s.addText("ERP71-এ কোথায়", {
    x: 1.0, y: 2.56, w: 5.3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText(opts.where, {
    x: 1.0, y: 2.92, w: 5.3, h: 0.72,
    fontFace: FONT_TITLE, fontSize: 18, color: COLORS.navy, margin: 0, isTextBox: true,
  });
  opts.steps.forEach((line, i) => {
    s.addText(`${i + 1}.  ${line}`, {
      x: 1.0, y: 3.72 + i * 0.58, w: 5.3, h: 0.56,
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });

  addCard(s, { x: 6.85, y: 2.4, w: 5.8, h: 4.25 });
  s.addText("বইতে এভাবে দেখাবে", {
    x: 7.15, y: 2.56, w: 5.2, h: 0.3,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.0, w: 5.2, h: 1.7,
    debit: opts.debit,
    credit: opts.credit,
    amount: opts.amount,
  });
  s.addText(opts.note, {
    x: 7.15, y: 4.9, w: 5.2, h: 1.5,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink, margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 8 — Customer pays you
// ============================================================================
addExampleSlide({
  topLabel: "০৭  —  গ্রাহকের আদায়",
  page: 8,
  section: "আদায়",
  title: [
    { text: "গ্রাহক ", options: { color: COLORS.ink } },
    { text: "পরে টাকা দেয়।", options: { color: COLORS.navy } },
  ],
  story: "গত সপ্তাহে রহমান ফার্মেসি বাকিতে কিনেছে। আজ তারা 8,000 টাকা নগদ পাঠাল।",
  where: "বিক্রয় → গ্রাহক পেমেন্ট",
  steps: [
    "নতুন গ্রাহক পেমেন্ট। রহমান ফার্মেসি বেছে নিন।",
    "পরিমাণ 8,000 টাকা। পদ্ধতি নগদ।",
    "সংরক্ষণ। চাইলে মানি রিসিট প্রিন্ট করুন।",
  ],
  debit: "Cash in Hand",
  credit: "Accounts Receivable",
  amount: "8,000",
  note: "ERP71 ভাউচার নিজে পোস্ট করে। ভাউচার এন্ট্রিতে আর লিখবেন না — গ্রাহক তখনও বাকি দেখাবে।",
});

// ============================================================================
// SLIDE 9 — Supplier payment
// ============================================================================
addExampleSlide({
  topLabel: "০৮  —  সরবরাহকারী পেমেন্ট",
  page: 9,
  section: "প্রদেয়",
  title: [
    { text: "আপনি ", options: { color: COLORS.ink } },
    { text: "সরবরাহকারীকে দেন।", options: { color: COLORS.navy } },
  ],
  story: "পপুলার ফার্মার কাছে ক্রয়ের 20,000 টাকা বাকি। দোকানের ব্যাংক থেকে পরিশোধ করলেন।",
  where: "ক্রয় → সরবরাহকারী পেমেন্ট",
  steps: [
    "নতুন সরবরাহকারী পেমেন্ট। পপুলার ফার্মা বেছে নিন।",
    "পরিমাণ 20,000 টাকা। পদ্ধতি ব্যাংক।",
    "সংরক্ষণ। সরবরাহকারীর বাকি 20,000 কমে।",
  ],
  debit: "Purchase Payable",
  credit: "Main Bank Account",
  amount: "20,000",
  note: "ক্রয় ইতিমধ্যে Purchase Payable ক্রেডিট করেছে। এই পেমেন্ট সেটা কমায়। আসল পদ্ধতি বেছে নিন, যাতে সঠিক নগদ বা ব্যাংক ক্রেডিট হয়।",
});

// ============================================================================
// SLIDE 10 — Owner in / out
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "০৯  —  মালিকের টাকা", page: 10, section: "মালিক" });

  addSlideTitle(s, [
    { text: "মালিকের টাকা এলো, ", options: { color: COLORS.ink } },
    { text: "মালিকের টাকা গেল।", options: { color: COLORS.navy } },
  ], { fontSize: 28, h: 0.68 });

  addCard(s, { x: 0.7, y: 1.7, w: 5.9, h: 4.95 });
  s.addText("মালিক টাকা দিলেন", {
    x: 1.0, y: 1.88, w: 5.3, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText("মাস শুরুতে নিজের 50,000 টাকা ড্রয়ারে রাখলেন।", {
    x: 1.0, y: 2.26, w: 5.3, h: 0.7,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  s.addText("হিসাব → ভাউচার এন্ট্রি → নগদ গ্রহণ", {
    x: 1.0, y: 3.0, w: 5.3, h: 0.5,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.navy, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 1.0, y: 3.58, w: 5.3, h: 1.55,
    debit: "Cash in Hand",
    credit: "Owner's Equity",
    amount: "50,000",
  });
  s.addText("বিবরণ: “মালিকের মূলধন — ১ জুন।” ব্যাংকে গেলে ব্যাংক গ্রহণ।", {
    x: 1.0, y: 5.3, w: 5.3, h: 1.05,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 6.85, y: 1.7, w: 5.8, h: 4.95 });
  s.addText("মালিক টাকা নিলেন", {
    x: 7.15, y: 1.88, w: 5.2, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText("ঘরের খরচে ড্রয়ার থেকে 10,000 টাকা নিলেন।", {
    x: 7.15, y: 2.26, w: 5.2, h: 0.7,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  s.addText("হিসাব → ভাউচার এন্ট্রি → নগদ প্রদান", {
    x: 7.15, y: 3.0, w: 5.2, h: 0.5,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.navy, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.58, w: 5.2, h: 1.55,
    debit: "Owner's Equity",
    credit: "Cash in Hand",
    amount: "10,000",
  });
  s.addText("এটা খরচ নয়। দোকান খরচ করেনি — আপনি নিজের মূলধন ফিরিয়ে নিলেন।", {
    x: 7.15, y: 5.3, w: 5.2, h: 1.05,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 11 — Cash to bank
// ============================================================================
addExampleSlide({
  topLabel: "১০  —  টাকা সরানো",
  page: 11,
  section: "স্থানান্তর",
  title: [
    { text: "নগদ গেল ", options: { color: COLORS.ink } },
    { text: "ব্যাংকে।", options: { color: COLORS.navy } },
  ],
  story: "শুক্রবার ড্রয়ার থেকে 30,000 টাকা নিয়ে Premier Bank-এ জমা দিলেন।",
  where: "ভাউচার এন্ট্রি → তহবিল স্থানান্তর",
  steps: [
    "তহবিল স্থানান্তরে শুধু নগদ, ব্যাংক ও ওয়ালেট।",
    "Main Bank Account ডেবিট 30,000 টাকা।",
    "Cash in Hand ক্রেডিট 30,000। পোস্ট করুন।",
  ],
  debit: "Main Bank Account",
  credit: "Cash in Hand",
  amount: "30,000",
  note: "ব্যাংক → বিকাশ, বা বিকাশ → নগদ একই রকম। দোকান ধনী হয়নি। শুধু পকেট বদলেছে। ব্যাংক থেকে নগদ তুলতে দুই লাইন উল্টে দিন।",
});

// ============================================================================
// SLIDE 12 — Other income
// ============================================================================
addExampleSlide({
  topLabel: "১১  —  অন্য আয়",
  page: 12,
  section: "আয়",
  title: [
    { text: "বিক্রয় নয়, ", options: { color: COLORS.ink } },
    { text: "তবু টাকা এলো।", options: { color: COLORS.navy } },
  ],
  story: "সরবরাহকারী 2,000 টাকা কমিশন দিল। পাশের বাড়িকে খালি ঘর 5,000 টাকায় ভাড়া দিলেন।",
  where: "চার্ট অফ অ্যাকাউন্টস, তারপর নগদ গ্রহণ",
  steps: [
    "দরকার হলে আয় হিসাব যোগ করুন, যেমন Commission Income.",
    "ভাউচার এন্ট্রি → নগদ গ্রহণ (বা ব্যাংক গ্রহণ)।",
    "নগদ (বা ব্যাংক) ডেবিট। সেই আয় হিসাব ক্রেডিট।",
  ],
  debit: "Cash in Hand",
  credit: "Commission Income",
  amount: "2,000",
  note: "এটা বিক্রয় হিসেবে কাটবেন না। বিক্রয়ে পণ্য ও গ্রাহক লাগে। অন্য আয় একটি ভাউচার। সরবরাহকারীর ছাড় পেমেন্টে Discount Received হিসেবে বসে।",
});

// ============================================================================
// SLIDE 13 — Loans
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "১২  —  ঋণ", page: 13, section: "ঋণ" });

  addSlideTitle(s, [
    { text: "ধার নিলেন। ", options: { color: COLORS.ink } },
    { text: "তারপর পরিশোধ।", options: { color: COLORS.navy } },
  ], { fontSize: 28, h: 0.68 });

  s.addText("হিসাব → ঋণ। প্রদেয় মানে দোকান ধার নিয়েছে। দুই ভাউচারই ERP71 পোস্ট করে।", {
    x: 0.7, y: 1.58, w: 12.0, h: 0.45,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 0.7, y: 2.15, w: 5.9, h: 4.5 });
  s.addText("ব্যাংক 1,00,000 টাকা ধার দিল", {
    x: 1.0, y: 2.32, w: 5.3, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText("ঋণ যোগ করুন → প্রদেয়। প্রতিপক্ষ Premier Bank. মূল পরিমাণ 1,00,000 টাকা, পদ্ধতি ব্যাংক।", {
    x: 1.0, y: 2.7, w: 5.3, h: 0.9,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 1.0, y: 3.7, w: 5.3, h: 1.55,
    debit: "Main Bank Account",
    credit: "Loans Payable",
    amount: "1,00,000",
  });
  s.addText("ব্যাংকে নগদ বাড়ল। এখন ব্যাংকের কাছে দেনা।", {
    x: 1.0, y: 5.45, w: 5.3, h: 0.85,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 6.85, y: 2.15, w: 5.8, h: 4.5 });
  s.addText("আপনি 10,000 টাকা পরিশোধ করলেন", {
    x: 7.15, y: 2.32, w: 5.2, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText("ঋণ খুলুন। ব্যাংক থেকে 10,000 পরিশোধ রেকর্ড করুন। বকেয়া 90,000 হয়।", {
    x: 7.15, y: 2.7, w: 5.2, h: 0.9,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.7, w: 5.2, h: 1.55,
    debit: "Loans Payable",
    credit: "Main Bank Account",
    amount: "10,000",
  });
  s.addText("অন্যকে ধার দিলে? একই স্ক্রিন, ধরন প্রাপ্য। দুই লাইন উল্টে যায়।", {
    x: 7.15, y: 5.45, w: 5.2, h: 0.85,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 14 — Investors
// ============================================================================
addExampleSlide({
  topLabel: "১৩  —  বিনিয়োগকারী",
  page: 14,
  section: "বিনিয়োগকারী",
  title: [
    { text: "অংশীদার ", options: { color: COLORS.ink } },
    { text: "মূলধন দিলেন।", options: { color: COLORS.navy } },
  ],
  story: "করিম ৩০% অংশীদার হলেন এবং দোকানের ব্যাংকে 2,00,000 টাকা জমা দিলেন।",
  where: "হিসাব → বিনিয়োগকারী",
  steps: [
    "বিনিয়োগকারী যোগ করুন। নাম করিম। মুনাফার অংশ ৩০%।",
    "2,00,000 টাকার জমা রেকর্ড করুন, পদ্ধতি ব্যাংক।",
    "পরে উত্তোলন একই স্ক্রিনে, দিক উত্তোলন।",
  ],
  debit: "Main Bank Account",
  credit: "Investor Capital",
  amount: "2,00,000",
  note: "মাসিক মুনাফার অংশ একই পাতা থেকে চালান। এটা মুনাফার বণ্টন, খরচ নয়। পরিশোধ করলে Investor Profit Payable কমে।",
});

// ============================================================================
// SLIDE 15 — Fixed assets
// ============================================================================
addExampleSlide({
  topLabel: "১৪  —  দোকানের সম্পদ",
  page: 15,
  section: "সম্পদ",
  title: [
    { text: "ফ্রিজ কিনলেন, ", options: { color: COLORS.ink } },
    { text: "স্টক নয়।", options: { color: COLORS.navy } },
  ],
  story: "ডিসপ্লে ফ্রিজ 45,000 টাকা, ব্যাংক থেকে পরিশোধ। পাঁচ বছর চলবে।",
  where: "হিসাব → স্থায়ী সম্পদ",
  steps: [
    "সম্পদ যোগ: “ডিসপ্লে ফ্রিজ”, ব্যয় 45,000, আয়ু ৬০ মাস।",
    "সরলরৈখিক। ক্রয় তারিখ আজ।",
    "প্রতি মাসে: মাসিক অবচয় চালান।",
  ],
  debit: "Fixed Assets",
  credit: "Main Bank Account",
  amount: "45,000",
  note: "এটা পুনঃবিক্রয়ের পণ্য নয়, খরচও নয়। পরে অবচয়: Depreciation Expense ডেবিট / Accumulated Depreciation ক্রেডিট — নগদ নড়ে না।",
});

// ============================================================================
// SLIDE 16 — Salary
// ============================================================================
addExampleSlide({
  topLabel: "১৫  —  বেতন",
  page: 16,
  section: "বেতন",
  title: [
    { text: "বেতন এইচআর থেকে, ", options: { color: COLORS.ink } },
    { text: "খরচ থেকে নয়।", options: { color: COLORS.navy } },
  ],
  story: "ক্যাশিয়ার নিলার বেতন 18,000 টাকা। মাস শেষে নগদে দিলেন।",
  where: "এইচআর → বেতন প্রদান",
  steps: [
    "তার শাখার বেতন প্রদান খুলুন।",
    "কর্মচারী, নগদ ড্রয়ার, পদ্ধতি বেছে নিন।",
    "পরিশোধ। ভাউচার নিলাকে Salary Payable-এ ট্যাগ করে।",
  ],
  debit: "Salary Payable",
  credit: "Cash in Hand",
  amount: "18,000",
  note: "আগে Salary & Wages ডেবিট / Salary Payable ক্রেডিট হয়। পেমেন্ট সেই প্রদেয় কমায়। দৈনিক খরচ হিসেবে বেতন লিখলে খরচ দ্বিগুণ হয়।",
});

// ============================================================================
// SLIDE 17 — Opening balances
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "১৬  —  বই শুরু", page: 17, section: "শুরু" });
  addSlideTitle(s, [
    { text: "প্রথম দিন: ", options: { color: COLORS.ink } },
    { text: "প্রারম্ভিক ব্যালেন্স।", options: { color: COLORS.navy } },
  ], { fontSize: 28, h: 0.68 });

  s.addText("ERP71 চালুর আগে নগদ 25,000, ব্যাংকে 80,000, গ্রাহকের বাকি 15,000 টাকা। এটাই দোকানে থাকা মালিকের মূলধন।", {
    x: 0.7, y: 1.55, w: 12.0, h: 0.6,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 0.7, y: 2.28, w: 5.9, h: 4.37 });
  s.addText("ERP71-এ কোথায়", {
    x: 1.0, y: 2.46, w: 5.3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText("হিসাব → প্রারম্ভিক ব্যালেন্স", {
    x: 1.0, y: 2.82, w: 5.3, h: 0.55,
    fontFace: FONT_TITLE, fontSize: 18, color: COLORS.navy, margin: 0, isTextBox: true,
  });
  [
    "তারিখ অনুযায়ী সেট করুন — চালুর আগের দিন।",
    "ডানদিকের চার লাইন লিখুন। মোট মিলতে হবে।",
    "প্রারম্ভিক ব্যালেন্স পোস্ট করুন। একটি জার্নাল তৈরি হয়।",
  ].forEach((line, i) => {
    s.addText(`${i + 1}.  ${line}`, {
      x: 1.0, y: 3.5 + i * 0.72, w: 5.3, h: 0.68,
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });

  addCard(s, { x: 6.85, y: 2.28, w: 5.8, h: 4.37 });
  s.addText("বইতে এভাবে দেখাবে", {
    x: 7.15, y: 2.46, w: 5.2, h: 0.3,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });

  const head = {
    fill: { color: COLORS.ink }, color: COLORS.white, bold: true,
    fontFace: FONT_BODY, fontSize: 11, align: "center", valign: "middle",
  };
  const cell = (text, fill, extra) => ({
    text,
    options: {
      fill: { color: fill }, color: COLORS.ink, fontFace: FONT_BODY,
      fontSize: 13, valign: "middle", ...extra,
    },
  });
  const debitFill = COLORS.debitTint;
  const creditFill = COLORS.creditTint;
  s.addTable([
    [
      { text: "হিসাব", options: { ...head, align: "left" } },
      { text: "ডেবিট", options: head },
      { text: "ক্রেডিট", options: head },
    ],
    [cell("Cash in Hand", debitFill), cell("25,000", debitFill, { align: "right", bold: true, color: COLORS.navy }), cell("", debitFill, { align: "right" })],
    [cell("Main Bank Account", debitFill), cell("80,000", debitFill, { align: "right", bold: true, color: COLORS.navy }), cell("", debitFill, { align: "right" })],
    [cell("Accounts Receivable", debitFill), cell("15,000", debitFill, { align: "right", bold: true, color: COLORS.navy }), cell("", debitFill, { align: "right" })],
    [cell("Owner's Equity", creditFill), cell("", creditFill, { align: "right" }), cell("1,20,000", creditFill, { align: "right", bold: true, color: "3D5A32" })],
  ], {
    x: 7.15, y: 2.88, w: 5.2, h: 2.35,
    colW: [2.5, 1.35, 1.35],
    border: [{ pt: 0 }, { pt: 0 }, { pt: 0 }, { pt: 0 }],
    fontFace: FONT_BODY,
  });
  s.addText("পুরনো বাকিকে এই মাসের Sales Revenue-এ ক্রেডিট করবেন না। গ্রাহকের আগের বাকি আনলে Opening Balance Equity ব্যবহার করুন।", {
    x: 7.15, y: 5.35, w: 5.2, h: 1.05,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink, margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 18 — Inter-branch
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "১৭  —  দুই শাখা", page: 18, section: "শাখা" });

  addSlideTitle(s, [
    { text: "অন্য শাখায় ", options: { color: COLORS.ink } },
    { text: "নগদ পাঠালেন।", options: { color: COLORS.navy } },
  ], { fontSize: 28, h: 0.68 });

  s.addText("হিসাব → তহবিল স্থানান্তর। গুলশান দোকান উত্তরায় 10,000 টাকা নগদ পাঠায়। দুই ভাউচার — পাঠানো ও গ্রহণ।", {
    x: 0.7, y: 1.55, w: 12.0, h: 0.55,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 0.7, y: 2.25, w: 5.9, h: 4.4 });
  s.addText("১  ·  শুরু  ·  গুলশান", {
    x: 1.0, y: 2.42, w: 5.3, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 1.0, y: 2.9, w: 5.3, h: 1.55,
    debit: "Due from Branches",
    credit: "Cash in Hand",
    amount: "10,000",
  });
  s.addText("গুলশানের Cash in Hand ড্রয়ার কমে। কোম্পানির কাছে উত্তরার প্রাপ্য ওঠে।", {
    x: 1.0, y: 4.7, w: 5.3, h: 1.55,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 6.85, y: 2.25, w: 5.8, h: 4.4 });
  s.addText("২  ·  গ্রহণ  ·  উত্তরা", {
    x: 7.15, y: 2.42, w: 5.2, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 7.15, y: 2.9, w: 5.2, h: 1.55,
    debit: "Cash in Hand",
    credit: "Due to Branches",
    amount: "10,000",
  });
  s.addText("উত্তরার Cash in Hand ড্রয়ার বাড়ে। এই স্ক্রিন ব্যবহার করুন — হাতে তহবিল স্থানান্তর ভাউচার লিখবেন না।", {
    x: 7.15, y: 4.7, w: 5.2, h: 1.55,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 19 — Bad debt and bank charges
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "১৮  —  দুই ছোট ঘটনা", page: 19, section: "সমন্বয়" });

  addSlideTitle(s, [
    { text: "বকেয়া মওকুফ। ", options: { color: COLORS.ink } },
    { text: "ব্যাংক চার্জ।", options: { color: COLORS.navy } },
  ], { fontSize: 28, h: 0.68 });

  addCard(s, { x: 0.7, y: 1.7, w: 5.9, h: 4.95 });
  s.addText("গ্রাহক আর দেবে না", {
    x: 1.0, y: 1.88, w: 5.3, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText("ওয়াক-ইন গ্রাহকের 3,500 টাকা খুঁজে পাচ্ছেন না। বিক্রয় → মওকুফকৃত বকেয়া। সেই গ্রাহক মওকুফ করুন।", {
    x: 1.0, y: 2.26, w: 5.3, h: 0.95,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 1.0, y: 3.3, w: 5.3, h: 1.55,
    debit: "Bad Debt Expense",
    credit: "Accounts Receivable",
    amount: "3,500",
  });
  s.addText("পুরনো বিক্রয় থাকে। আদায় ব্যর্থ হয়েছে — সেটাই লিখছেন। গ্রাহকের দেনা মওকুফ করার অনুমতি লাগে।", {
    x: 1.0, y: 5.05, w: 5.3, h: 1.3,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  addCard(s, { x: 6.85, y: 1.7, w: 5.8, h: 4.95 });
  s.addText("ব্যাংক চার্জ কেটে নিল", {
    x: 7.15, y: 1.88, w: 5.2, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  s.addText("Premier Bank 200 টাকা কেটেছে। খরচ দিয়ে চলবে। চাইলে ব্যাংক প্রদান ভাউচার।", {
    x: 7.15, y: 2.26, w: 5.2, h: 0.95,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.3, w: 5.2, h: 1.55,
    debit: "General Operating Expense",
    credit: "Main Bank Account",
    amount: "200",
  });
  s.addText("এনবিআর-এ কর একই আকার: ব্যাংক প্রদান, করের প্রদেয় হিসাব ডেবিট, ব্যাংক ক্রেডিট।", {
    x: 7.15, y: 5.05, w: 5.2, h: 1.3,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0, isTextBox: true,
  });
}

// ============================================================================
// SLIDE 20 — Pocket card
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "১৯  —  সহায়িকা", page: 20, section: "সহায়িকা" });

  addSlideTitle(s, [
    { text: "কী হলো → ", options: { color: COLORS.ink } },
    { text: "কোথায় → দুই লাইন।", options: { color: COLORS.navy } },
  ], { fontSize: 26, h: 0.62 });

  const headOpt = {
    fill: { color: COLORS.ink },
    color: COLORS.white,
    bold: true,
    fontFace: FONT_BODY,
    fontSize: 11,
    valign: "middle",
  };
  const body = (text, fill) => ({
    text,
    options: {
      fill: { color: fill },
      color: COLORS.ink,
      fontFace: FONT_BODY,
      fontSize: 11,
      valign: "middle",
    },
  });

  const rows = [
    [
      { text: "ঘটনা", options: headOpt },
      { text: "স্ক্রিন", options: headOpt },
      { text: "ডেবিট", options: headOpt },
      { text: "ক্রেডিট", options: headOpt },
    ],
  ];
  const data = [
    ["গ্রাহক টাকা দিল", "গ্রাহক পেমেন্ট", "Cash / Bank / bKash", "Accounts Receivable"],
    ["সরবরাহকারীকে দিলেন", "সরবরাহকারী পেমেন্ট", "Purchase Payable", "Cash / Bank"],
    ["মালিক টাকা দিলেন", "নগদ বা ব্যাংক গ্রহণ", "Cash or Bank", "Owner's Equity"],
    ["মালিক টাকা নিলেন", "নগদ বা ব্যাংক প্রদান", "Owner's Equity", "Cash or Bank"],
    ["নগদ ব্যাংকে জমা", "তহবিল স্থানান্তর ভাউচার", "Main Bank Account", "Cash in Hand"],
    ["অন্য আয়", "নগদ / ব্যাংক গ্রহণ", "Cash or Bank", "Other income account"],
    ["ধার নিলেন", "ঋণ (প্রদেয়)", "Cash or Bank", "Loans Payable"],
    ["ঋণ পরিশোধ", "ঋণ → পরিশোধ রেকর্ড", "Loans Payable", "Cash or Bank"],
    ["অংশীদারের মূলধন", "বিনিয়োগকারী", "Cash or Bank", "Investor Capital"],
    ["ফ্রিজ কিনলেন", "স্থায়ী সম্পদ", "Fixed Assets", "Cash or Bank"],
    ["বেতন দিলেন", "এইচআর → বেতন প্রদান", "Salary Payable", "Cash or Bank"],
    ["বকেয়া মওকুফ", "বিক্রয় → মওকুফকৃত বকেয়া", "Bad Debt Expense", "Accounts Receivable"],
  ];
  data.forEach((r, i) => {
    const fill = i % 2 === 0 ? COLORS.white : "F7F3EA";
    rows.push(r.map((cellText) => body(cellText, fill)));
  });

  s.addTable(rows, {
    x: 0.55, y: 1.52, w: 12.25, h: 5.28,
    colW: [3.05, 3.45, 2.95, 2.8],
    border: [
      { pt: 0.25, color: COLORS.divider },
      { pt: 0.25, color: COLORS.divider },
      { pt: 0.25, color: COLORS.divider },
      { pt: 0.25, color: COLORS.divider },
    ],
    fontFace: FONT_BODY,
    valign: "middle",
  });
}

// ============================================================================
// SLIDE 21 — Don't / check
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "২০  —  সাবধানতা", page: 21, section: "যাচাই" });

  addSlideTitle(s, [
    { text: "এগুলোতে হাত দেবেন না। ", options: { color: COLORS.ink } },
    { text: "তারপর যাচাই।", options: { color: COLORS.navy } },
  ], { fontSize: 26, h: 0.68 });

  addCard(s, { x: 0.7, y: 1.7, w: 5.9, h: 4.95, fill: COLORS.warnTint });
  s.addText("জার্নালে লিখবেন না", {
    x: 1.0, y: 1.9, w: 5.3, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  const dont = [
    "পিওএস-এ ইতিমধ্যে হওয়া বিক্রয়",
    "ইতিমধ্যে গৃহীত ক্রয়",
    "ভাড়া বা বিদ্যুৎ — খরচ ব্যবহার করুন",
    "বেতন — এইচআর বেতন প্রদান",
    "গ্রাহকের আদায় — গ্রাহক পেমেন্ট",
    "স্টক ট্রান্সফার বা শ্রিংকেজ",
  ];
  dont.forEach((line, i) => {
    s.addText(line, {
      x: 1.0, y: 2.4 + i * 0.62, w: 5.3, h: 0.58,
      fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });

  addCard(s, { x: 6.85, y: 1.7, w: 5.8, h: 4.95 });
  s.addText("পোস্টের পরে", {
    x: 7.15, y: 1.9, w: 5.2, h: 0.32,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.muted, margin: 0, isTextBox: true,
  });
  const checks = [
    { t: "লেজার", d: "হিসাব → লেজার। Cash in Hand বা ব্যাংক খুলুন। আপনার লাইন সেখানে।" },
    { t: "ক্যাশ বুক / ব্যাঙ্ক বুক", d: "চলতি ব্যালেন্স ড্রয়ার বা ব্যাংক এসএমএসের সাথে মিলবে।" },
    { t: "গ্রাহক / সরবরাহকারী", d: "গ্রাহক বা সরবরাহকারীর বাকি সরেছে। শুধু ভাউচার হলে বাকি অপরিবর্তিত থাকত।" },
    { t: "ট্রায়াল ব্যালেন্স", d: "পুরো দোকানের ডেবিট এখনও ক্রেডিটের সমান।" },
  ];
  checks.forEach((c, i) => {
    const y = 2.35 + i * 0.98;
    s.addText(c.t, {
      x: 7.15, y, w: 5.2, h: 0.34,
      fontFace: FONT_TITLE, fontSize: 15, color: COLORS.navy, margin: 0, isTextBox: true,
    });
    s.addText(c.d, {
      x: 7.15, y: y + 0.34, w: 5.2, h: 0.58,
      fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink, margin: 0, isTextBox: true,
    });
  });
}

// ============================================================================
// SLIDE 22 — Close
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };

  s.addText("ERP71  ·  হিসাব", {
    x: 0.7, y: 0.5, w: 8, h: 0.38,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink,
    margin: 0, isTextBox: true,
  });

  s.addText(
    [
      { text: "আগে স্ক্রিন।", options: { color: COLORS.ink, breakLine: true } },
      { text: "দুই লাইন।", options: { color: COLORS.navy, breakLine: true } },
      { text: "দুটো মিলতে হবে।", options: { color: COLORS.ink } },
    ],
    {
      x: 0.7, y: 1.65, w: 12.0, h: 3.15,
      fontFace: FONT_TITLE, fontSize: 44, margin: 0, isTextBox: true,
    }
  );

  s.addText("কোন হিসাব টাকা পেল আর কোন হিসাব দিল — বলতে পারলে এন্ট্রি লেখা যায়।", {
    x: 0.7, y: 5.15, w: 11.0, h: 0.8,
    fontFace: FONT_BODY, fontSize: 18, color: COLORS.ink, margin: 0, isTextBox: true,
  });

  s.addShape(pres.shapes.OVAL, {
    x: W - 2.0, y: H - 1.9, w: 1.05, h: 1.05,
    fill: { color: COLORS.navy }, line: { type: "none" },
  });

  s.addText("22  /  22", {
    x: 0.7, y: 7.08, w: 2.4, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted,
    margin: 0, isTextBox: true,
  });
}

pres.writeFile({ fileName: "/Users/bs01621/Projects/nayeem/erp71/docs/user-manual/erp71-accounting-other-entries-bn.pptx" })
  .then(() => console.log("wrote pptx"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
