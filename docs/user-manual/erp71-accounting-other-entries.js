/**
 * ERP71 — Recording money events outside sales, purchase, expense, and stock.
 * Beginner training deck. Visual language from education_intro_chemistry_lecture.
 *
 * Palette: cream, deep navy, sage. Helvetica Neue. LAYOUT_WIDE 13.333" × 7.5".
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

const FONT_BODY = "Helvetica Neue";
const FONT_TITLE = "Helvetica Neue";
const W = 13.333;
const H = 7.5;
const TOTAL = 22;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "ERP71 Accounting — Other money events";
pres.author = "ERP71";
pres.company = "ERP71";
pres.subject = "Beginner guide to recording financial events outside sales, purchase, expense, and inventory";

function shadowSoft() {
  return { type: "outer", color: "000000", blur: 12, offset: 2, angle: 90, opacity: 0.06 };
}

function addChrome(slide, { topLabel, page, section }) {
  slide.addText(topLabel, {
    x: 0.7, y: 0.42, w: 8.5, h: 0.32,
    fontFace: FONT_BODY, fontSize: 11, color: COLORS.muted,
    charSpacing: 3, margin: 0,
  });
  slide.addText(`${String(page).padStart(2, "0")}  /  ${String(TOTAL).padStart(2, "0")}`, {
    x: 0.7, y: 7.08, w: 2.4, h: 0.26,
    fontFace: FONT_BODY, fontSize: 11, color: COLORS.muted,
    charSpacing: 2, margin: 0,
  });
  slide.addText(section, {
    x: W - 5.2, y: 7.08, w: 4.5, h: 0.26,
    fontFace: FONT_BODY, fontSize: 11, color: COLORS.muted,
    charSpacing: 3, align: "right", margin: 0,
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

function titleRuns(parts) {
  return parts;
}

function addSlideTitle(slide, runs, { y, h, fontSize } = {}) {
  slide.addText(runs, {
    x: 0.7, y: y ?? 0.85, w: 12.0, h: h ?? 0.9,
    fontFace: FONT_TITLE, fontSize: fontSize ?? 36, bold: false,
    valign: "top", margin: 0,
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
    fontSize: 14,
    color: COLORS.ink,
    valign: "middle",
    align: "left",
  };
  const amt = {
    fontFace: FONT_BODY,
    fontSize: 14,
    color: COLORS.ink,
    valign: "middle",
    align: "right",
    bold: true,
  };
  return [
    [
      { text: "Account", options: { ...head, align: "left" } },
      { text: "Debit", options: head },
      { text: "Credit", options: head },
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

  s.addText("ERP71  ·  ACCOUNTING  ·  BEGINNER CLASS", {
    x: 0.7, y: 0.5, w: 7.4, h: 0.35,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.ink,
    charSpacing: 3, margin: 0,
  });
  s.addText("For shop owners and staff", {
    x: 8.6, y: 0.5, w: 4.05, h: 0.35,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted,
    align: "right", margin: 0,
  });

  s.addText(
    [
      { text: "Money events", options: { color: COLORS.ink, breakLine: true } },
      { text: "beyond the till.", options: { color: COLORS.navy, italic: true } },
    ],
    {
      x: 0.65, y: 1.7, w: 12.2, h: 2.6,
      fontFace: FONT_TITLE, fontSize: 64, bold: false,
      valign: "top", margin: 0,
    }
  );

  s.addText("How to record loans, owner money, bank moves, collections, and the rest — using the Accounting module, with very small examples.", {
    x: 0.7, y: 4.55, w: 10.2, h: 0.9,
    fontFace: FONT_BODY, fontSize: 18, color: COLORS.ink, margin: 0,
  });

  s.addShape(pres.shapes.OVAL, {
    x: W - 2.0, y: H - 1.9, w: 1.05, h: 1.05,
    fill: { color: COLORS.navy }, line: { type: "none" },
  });

  s.addText("SALES, PURCHASE, EXPENSE AND STOCK ALREADY POST THEMSELVES", {
    x: 0.7, y: H - 0.58, w: 10.5, h: 0.32,
    fontFace: FONT_BODY, fontSize: 11, color: COLORS.ink,
    charSpacing: 2, margin: 0,
  });
}

// ============================================================================
// SLIDE 2 — What this class covers
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "01  —  SCOPE", page: 2, section: "SCOPE" });

  addSlideTitle(s, [
    { text: "Four things ERP71 already ", options: { color: COLORS.ink } },
    { text: "books for you.", options: { color: COLORS.navy, italic: true } },
  ]);

  const items = [
    { n: "01", t: "A sale", d: "POS or Sales. Cash, bKash, Nagad, bank, or credit — the voucher is created for you." },
    { n: "02", t: "A purchase", d: "Purchases. Stock is received and Purchase Payable is raised. You do not journal this." },
    { n: "03", t: "A shop expense", d: "Expenses. Rent, utility, conveyance, refreshments. Pick a head and a payment method." },
    { n: "04", t: "A stock move", d: "Transfers, stock take, shrinkage. Quantity moves. No extra money voucher is needed." },
  ];

  items.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.7 + col * 6.15;
    const y = 2.05 + row * 2.25;
    addCard(s, { x, y, w: 5.85, h: 2.05 });
    s.addText(it.n, {
      x: x + 0.3, y: y + 0.28, w: 1.2, h: 0.28,
      fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
    });
    s.addText(it.t, {
      x: x + 0.3, y: y + 0.62, w: 5.25, h: 0.42,
      fontFace: FONT_TITLE, fontSize: 24, color: COLORS.ink, margin: 0,
    });
    s.addText(it.d, {
      x: x + 0.3, y: y + 1.15, w: 5.25, h: 0.65,
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
    });
  });
}

// ============================================================================
// SLIDE 3 — Golden rule
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "02  —  THE RULE", page: 3, section: "THE RULE" });

  s.addText(
    [
      { text: "If ERP71 has a screen", options: { color: COLORS.ink, breakLine: true } },
      { text: "for the event, use it.", options: { color: COLORS.navy, italic: true } },
    ],
    {
      x: 0.7, y: 1.15, w: 12.0, h: 2.1,
      fontFace: FONT_TITLE, fontSize: 44, margin: 0,
    }
  );

  addHairline(s, 0.7, 3.45, W - 1.4);

  const cols = [
    { k: "DEDICATED SCREEN", t: "Customer receipt, supplier payment, loan, investor, salary, fixed asset, opening balance, branch cash send, bad debt." },
    { k: "VOUCHER ENTRY", t: "Owner capital in or out, cash into the bank, other income, bank charges, tax paid to NBR, any leftover event." },
    { k: "WHY IT MATTERS", t: "The screen updates the person and the books together. A raw voucher updates only the books — the customer still looks unpaid." },
  ];
  cols.forEach((c, i) => {
    const x = 0.7 + i * 4.15;
    s.addText(c.k, {
      x, y: 3.7, w: 3.9, h: 0.32,
      fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
    });
    s.addText(c.t, {
      x, y: 4.15, w: 3.9, h: 2.3,
      fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0,
    });
  });
}

// ============================================================================
// SLIDE 4 — Debit and credit
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "03  —  DEBIT & CREDIT", page: 4, section: "BASICS" });

  addSlideTitle(s, [
    { text: "One picture: ", options: { color: COLORS.ink } },
    { text: "value in, value out.", options: { color: COLORS.navy, italic: true } },
  ]);

  s.addText("Debit the account that received value. Credit the account that gave value. The two amounts must match.", {
    x: 0.7, y: 1.8, w: 12.0, h: 0.5,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0,
  });

  addCard(s, { x: 0.7, y: 2.5, w: 5.85, h: 4.15, fill: COLORS.debitTint });
  s.addText("DEBIT  ·  LEFT COLUMN", {
    x: 1.0, y: 2.72, w: 5.25, h: 0.3,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.navy, charSpacing: 2, margin: 0,
  });
  s.addText("Grew, or received money.", {
    x: 1.0, y: 3.12, w: 5.25, h: 0.45,
    fontFace: FONT_TITLE, fontSize: 22, color: COLORS.ink, italic: true, margin: 0,
  });
  s.addText("Cash in Hand, Main Bank, bKash, Nagad, what a customer owes you, a fridge you bought, an expense you incurred.", {
    x: 1.0, y: 3.7, w: 5.25, h: 1.5,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0,
  });
  s.addText("Example: cash came into the drawer → Debit Cash in Hand.", {
    x: 1.0, y: 5.45, w: 5.25, h: 0.8,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.navy, italic: true, margin: 0,
  });

  addCard(s, { x: 6.8, y: 2.5, w: 5.85, h: 4.15, fill: COLORS.creditTint });
  s.addText("CREDIT  ·  RIGHT COLUMN", {
    x: 7.1, y: 2.72, w: 5.25, h: 0.3,
    fontFace: FONT_BODY, fontSize: 12, color: "3D5A32", charSpacing: 2, margin: 0,
  });
  s.addText("Gave money, or you now owe.", {
    x: 7.1, y: 3.12, w: 5.25, h: 0.45,
    fontFace: FONT_TITLE, fontSize: 22, color: COLORS.ink, italic: true, margin: 0,
  });
  s.addText("What you owe a supplier, a bank loan, Owner's Equity, Investor Capital, Sales Revenue, other income.", {
    x: 7.1, y: 3.7, w: 5.25, h: 1.5,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0,
  });
  s.addText("Example: owner put money in → Credit Owner's Equity.", {
    x: 7.1, y: 5.45, w: 5.25, h: 0.8,
    fontFace: FONT_BODY, fontSize: 14, color: "3D5A32", italic: true, margin: 0,
  });
}

// ============================================================================
// SLIDE 5 — Two doors
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "04  —  WHERE TO GO", page: 5, section: "WHERE TO GO" });

  addSlideTitle(s, [
    { text: "Two doors. ", options: { color: COLORS.ink } },
    { text: "Pick the first one that fits.", options: { color: COLORS.navy, italic: true } },
  ]);

  const doors = [
    { n: "A", title: "A named screen", lines: [
      "Sales → Customer Payments",
      "Purchases → Supplier Payments",
      "Accounting → Loans",
      "Accounting → Investors",
      "Accounting → Fixed Assets",
      "Accounting → Opening Balances",
      "Accounting → Fund Transfers",
      "HR → Salary Payments",
      "Sales → Bad Debts",
    ]},
    { n: "B", title: "Voucher Entry", lines: [
      "Accounting → Vouchers → New",
      "Cash Receive — money into cash",
      "Cash Payment — money out of cash",
      "Bank Receive — money into bank",
      "Bank Payment — money out of bank",
      "Fund Transfer — cash ↔ bank ↔ wallet",
      "Journal — anything else that balances",
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
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.white, align: "center", margin: 0,
    });
    s.addText(d.title, {
      x: x + 0.85, y: 2.2, w: 4.7, h: 0.4,
      fontFace: FONT_TITLE, fontSize: 22, color: COLORS.ink, margin: 0,
    });
    d.lines.forEach((line, li) => {
      s.addText(line, {
        x: x + 0.35, y: 2.8 + li * 0.4, w: 5.25, h: 0.38,
        fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
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
  addChrome(s, { topLabel: "05  —  VOUCHER TYPES", page: 6, section: "VOUCHERS" });

  addSlideTitle(s, [
    { text: "Six voucher types, ", options: { color: COLORS.ink } },
    { text: "one job each.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 34, h: 0.7 });

  const types = [
    { name: "Cash Receive", use: "Cash came into the drawer. Owner capital, other income, a refund you received in cash." },
    { name: "Cash Payment", use: "Cash left the drawer. Owner drawings, a one-off cash payout that is not an Expense." },
    { name: "Bank Receive", use: "Money landed in the bank. Owner capital by cheque, a grant, interest credited." },
    { name: "Bank Payment", use: "Money left the bank. Bank charges, tax paid to NBR, a one-off bank payout." },
    { name: "Fund Transfer", use: "Cash, bank, and wallets only. Drawer to Premier Bank, bank to bKash, bKash to cash." },
    { name: "Journal", use: "No cash moved, or mixed accounts. Opening balances live on their own screen, which posts a journal." },
  ];

  types.forEach((t, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.7 + col * 4.15;
    const y = 1.85 + row * 2.45;
    addCard(s, { x, y, w: 3.95, h: 2.25 });
    s.addText(String(i + 1).padStart(2, "0"), {
      x: x + 0.22, y: y + 0.22, w: 1.0, h: 0.28,
      fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
    });
    s.addText(t.name, {
      x: x + 0.22, y: y + 0.55, w: 3.5, h: 0.4,
      fontFace: FONT_TITLE, fontSize: 18, color: COLORS.navy, italic: true, margin: 0,
    });
    s.addText(t.use, {
      x: x + 0.22, y: y + 1.05, w: 3.5, h: 0.95,
      fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink, margin: 0,
    });
  });
}

// ============================================================================
// SLIDE 7 — How to post a voucher
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "06  —  HOW TO POST", page: 7, section: "HOW TO POST" });

  addSlideTitle(s, [
    { text: "Five clicks on ", options: { color: COLORS.ink } },
    { text: "Voucher Entry.", options: { color: COLORS.navy, italic: true } },
  ]);

  const steps = [
    { n: "1", t: "Open the workbench", d: "Accounting → Vouchers → New. Pick the voucher type that matches the money." },
    { n: "2", t: "Date and narration", d: "Today is fine. Narration is required — write the story in one line, e.g. “Owner capital — June.”" },
    { n: "3", t: "Two rows, two sides", d: "Row 1: debit account and amount. Row 2: credit account and the same amount. Totals must say Balanced." },
    { n: "4", t: "Pick the branch", d: "A cash line needs that branch’s cash drawer. Banks and bKash/Nagad are shared." },
    { n: "5", t: "Post Voucher", d: "The number is assigned for you. Open Accounting → Ledger on the cash account to see it." },
  ];

  steps.forEach((st, i) => {
    const y = 1.9 + i * 0.95;
    s.addShape(pres.shapes.OVAL, {
      x: 0.7, y: y + 0.08, w: 0.48, h: 0.48,
      fill: { color: COLORS.navy }, line: { type: "none" },
    });
    s.addText(st.n, {
      x: 0.7, y: y + 0.14, w: 0.48, h: 0.38,
      fontFace: FONT_BODY, fontSize: 16, color: COLORS.white, align: "center", margin: 0,
    });
    s.addText(st.t, {
      x: 1.45, y: y, w: 4.2, h: 0.4,
      fontFace: FONT_TITLE, fontSize: 18, color: COLORS.ink, margin: 0,
    });
    s.addText(st.d, {
      x: 5.8, y: y, w: 6.8, h: 0.75,
      fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
    });
  });
}

function addExampleSlide(opts) {
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: opts.topLabel, page: opts.page, section: opts.section });

  addSlideTitle(s, opts.title, { fontSize: 32, h: 0.7 });

  s.addText(opts.story, {
    x: 0.7, y: 1.62, w: 12.0, h: 0.7,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, italic: true, margin: 0,
  });

  addCard(s, { x: 0.7, y: 2.42, w: 5.9, h: 4.23 });
  s.addText("WHERE IN ERP71", {
    x: 1.0, y: 2.6, w: 5.3, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText(opts.where, {
    x: 1.0, y: 3.0, w: 5.3, h: 0.7,
    fontFace: FONT_TITLE, fontSize: 20, color: COLORS.navy, italic: true, margin: 0,
  });
  opts.steps.forEach((line, i) => {
    s.addText(`${i + 1}.  ${line}`, {
      x: 1.0, y: 3.78 + i * 0.52, w: 5.3, h: 0.5,
      fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
    });
  });

  addCard(s, { x: 6.85, y: 2.42, w: 5.8, h: 4.23 });
  s.addText("THE BOOKS LOOK LIKE THIS", {
    x: 7.15, y: 2.6, w: 5.2, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.08, w: 5.2, h: 1.7,
    debit: opts.debit,
    credit: opts.credit,
    amount: opts.amount,
  });
  s.addText(opts.note, {
    x: 7.15, y: 5.0, w: 5.2, h: 1.3,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
  });
}

// ============================================================================
// SLIDE 8 — Customer pays you
// ============================================================================
addExampleSlide({
  topLabel: "07  —  CUSTOMER COLLECTION",
  page: 8,
  section: "COLLECTIONS",
  title: [
    { text: "A customer pays you ", options: { color: COLORS.ink } },
    { text: "later.", options: { color: COLORS.navy, italic: true } },
  ],
  story: "Last week Rahman Pharmacy bought on credit. Today they send Tk 8,000 in cash.",
  where: "Sales → Customer Payments",
  steps: [
    "New Customer Payment. Pick Rahman Pharmacy.",
    "Amount Tk 8,000. Payment method Cash.",
    "Save. Print the money receipt if they want one.",
  ],
  debit: "Cash in Hand",
  credit: "Accounts Receivable",
  amount: "8,000",
  note: "ERP71 posts the voucher for you. Do not also type this in Voucher Entry — the customer would still look unpaid.",
});

// ============================================================================
// SLIDE 9 — Supplier payment
// ============================================================================
addExampleSlide({
  topLabel: "08  —  SUPPLIER PAYMENT",
  page: 9,
  section: "PAYABLES",
  title: [
    { text: "You pay a ", options: { color: COLORS.ink } },
    { text: "supplier.", options: { color: COLORS.navy, italic: true } },
  ],
  story: "You owe Popular Pharma Tk 20,000 from a purchase. You pay from the shop’s bank.",
  where: "Purchases → Supplier Payments",
  steps: [
    "New payment. Pick Popular Pharma.",
    "Amount Tk 20,000. Payment method Bank.",
    "Save. The supplier’s due falls by 20,000.",
  ],
  debit: "Purchase Payable",
  credit: "Main Bank Account",
  amount: "20,000",
  note: "The purchase already credited Purchase Payable. This payment is what finally clears it. Pick the real payment method so the right cash or bank is credited.",
});

// ============================================================================
// SLIDE 10 — Owner in / out
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "09  —  OWNER MONEY", page: 10, section: "OWNER" });

  addSlideTitle(s, [
    { text: "Owner money in, ", options: { color: COLORS.ink } },
    { text: "owner money out.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 32, h: 0.65 });

  // Left: capital in
  addCard(s, { x: 0.7, y: 1.7, w: 5.9, h: 4.95 });
  s.addText("OWNER PUTS MONEY IN", {
    x: 1.0, y: 1.9, w: 5.3, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText("You put Tk 50,000 of your own cash into the drawer to start the month.", {
    x: 1.0, y: 2.28, w: 5.3, h: 0.7,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, italic: true, margin: 0,
  });
  s.addText("Accounting → Vouchers → New → Cash Receive", {
    x: 1.0, y: 3.05, w: 5.3, h: 0.45,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.navy, margin: 0,
  });
  addEntryTable(s, {
    x: 1.0, y: 3.6, w: 5.3, h: 1.55,
    debit: "Cash in Hand",
    credit: "Owner's Equity",
    amount: "50,000",
  });
  s.addText("Narration: “Owner capital — 1 June.” Bank Receive if the money went to the bank instead.", {
    x: 1.0, y: 5.35, w: 5.3, h: 0.95,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
  });

  // Right: drawings
  addCard(s, { x: 6.85, y: 1.7, w: 5.8, h: 4.95 });
  s.addText("OWNER TAKES MONEY OUT", {
    x: 7.15, y: 1.9, w: 5.2, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText("You take Tk 10,000 cash from the drawer for household use.", {
    x: 7.15, y: 2.28, w: 5.2, h: 0.7,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, italic: true, margin: 0,
  });
  s.addText("Accounting → Vouchers → New → Cash Payment", {
    x: 7.15, y: 3.05, w: 5.2, h: 0.45,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.navy, margin: 0,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.6, w: 5.2, h: 1.55,
    debit: "Owner's Equity",
    credit: "Cash in Hand",
    amount: "10,000",
  });
  s.addText("This is not an expense. The shop did not spend it — you took your own capital back.", {
    x: 7.15, y: 5.35, w: 5.2, h: 0.95,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
  });
}

// ============================================================================
// SLIDE 11 — Cash to bank
// ============================================================================
addExampleSlide({
  topLabel: "10  —  MOVING MONEY",
  page: 11,
  section: "TRANSFERS",
  title: [
    { text: "Cash goes into the ", options: { color: COLORS.ink } },
    { text: "bank.", options: { color: COLORS.navy, italic: true } },
  ],
  story: "Friday you take Tk 30,000 from the drawer and deposit it at Premier Bank.",
  where: "Vouchers → New → Fund Transfer",
  steps: [
    "Fund Transfer only allows cash, bank, and wallet accounts.",
    "Debit Main Bank Account Tk 30,000.",
    "Credit Cash in Hand Tk 30,000. Post.",
  ],
  debit: "Main Bank Account",
  credit: "Cash in Hand",
  amount: "30,000",
  note: "Same idea for bank → bKash, or bKash → cash. The shop is no richer. Money only changed pocket. Reverse the two lines to take cash out of the bank.",
});

// ============================================================================
// SLIDE 12 — Other income
// ============================================================================
addExampleSlide({
  topLabel: "11  —  OTHER INCOME",
  page: 12,
  section: "INCOME",
  title: [
    { text: "Money in that is ", options: { color: COLORS.ink } },
    { text: "not a sale.", options: { color: COLORS.navy, italic: true } },
  ],
  story: "A supplier pays you Tk 2,000 commission. You also let a neighbour use a spare room for Tk 5,000.",
  where: "Chart of Accounts, then Cash Receive",
  steps: [
    "Add an income account if needed, e.g. Commission Income.",
    "Vouchers → New → Cash Receive (or Bank Receive).",
    "Debit Cash (or Bank). Credit that income account.",
  ],
  debit: "Cash in Hand",
  credit: "Commission Income",
  amount: "2,000",
  note: "Do not ring this up as a sale. A sale needs a product and a customer. Other income is a voucher. Discount a supplier lets you keep is booked on the supplier payment, as Discount Received.",
});

// ============================================================================
// SLIDE 13 — Loans
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "12  —  LOANS", page: 13, section: "LOANS" });

  addSlideTitle(s, [
    { text: "You borrowed. ", options: { color: COLORS.ink } },
    { text: "Then you repay.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 32, h: 0.65 });

  s.addText("Accounting → Loans. Payable means the shop borrowed. ERP71 posts both vouchers for you.", {
    x: 0.7, y: 1.6, w: 12.0, h: 0.4,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0,
  });

  addCard(s, { x: 0.7, y: 2.15, w: 5.9, h: 4.5 });
  s.addText("THE BANK LENDS YOU TK 1,00,000", {
    x: 1.0, y: 2.35, w: 5.3, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText("Add Loan → Payable. Counterparty “Premier Bank”. Principal 1,00,000. Payment method Bank.", {
    x: 1.0, y: 2.75, w: 5.3, h: 0.85,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
  });
  addEntryTable(s, {
    x: 1.0, y: 3.7, w: 5.3, h: 1.55,
    debit: "Main Bank Account",
    credit: "Loans Payable",
    amount: "1,00,000",
  });
  s.addText("Cash in the bank went up. You now owe the bank.", {
    x: 1.0, y: 5.5, w: 5.3, h: 0.7,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
  });

  addCard(s, { x: 6.85, y: 2.15, w: 5.8, h: 4.5 });
  s.addText("YOU REPAY TK 10,000", {
    x: 7.15, y: 2.35, w: 5.2, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText("Open the loan. Record a payment of 10,000 from Bank. Outstanding falls to 90,000.", {
    x: 7.15, y: 2.75, w: 5.2, h: 0.85,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.7, w: 5.2, h: 1.55,
    debit: "Loans Payable",
    credit: "Main Bank Account",
    amount: "10,000",
  });
  s.addText("You lent money to someone else? Same screen, direction Receivable. The two lines swap.", {
    x: 7.15, y: 5.5, w: 5.2, h: 0.7,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
  });
}

// ============================================================================
// SLIDE 14 — Investors
// ============================================================================
addExampleSlide({
  topLabel: "13  —  INVESTORS",
  page: 14,
  section: "INVESTORS",
  title: [
    { text: "A partner puts ", options: { color: COLORS.ink } },
    { text: "capital in.", options: { color: COLORS.navy, italic: true } },
  ],
  story: "Karim becomes a 30% partner and deposits Tk 2,00,000 in the shop bank.",
  where: "Accounting → Investors",
  steps: [
    "Add Investor. Name Karim. Profit share 30%.",
    "Record a Contribution of Tk 2,00,000, method Bank.",
    "A withdrawal later is the same screen, direction Withdrawal.",
  ],
  debit: "Main Bank Account",
  credit: "Investor Capital",
  amount: "2,00,000",
  note: "Monthly profit share is run from the same page. It is a distribution of profit, not an expense. Pay it out when you are ready — that settles Investor Profit Payable.",
});

// ============================================================================
// SLIDE 15 — Fixed assets
// ============================================================================
addExampleSlide({
  topLabel: "14  —  SHOP ASSETS",
  page: 15,
  section: "ASSETS",
  title: [
    { text: "You buy a fridge, ", options: { color: COLORS.ink } },
    { text: "not stock.", options: { color: COLORS.navy, italic: true } },
  ],
  story: "A display fridge costs Tk 45,000, paid from the bank. It will last five years.",
  where: "Accounting → Fixed Assets",
  steps: [
    "Add asset “Display fridge”, cost 45,000, life 60 months.",
    "Straight line. Purchase date today.",
    "Each month: Run Monthly Depreciation.",
  ],
  debit: "Fixed Assets",
  credit: "Main Bank Account",
  amount: "45,000",
  note: "This is not a purchase of goods for resale, and not an Expense. Depreciation later posts Debit Depreciation Expense / Credit Accumulated Depreciation — no cash moves.",
});

// ============================================================================
// SLIDE 16 — Salary
// ============================================================================
addExampleSlide({
  topLabel: "15  —  SALARY",
  page: 16,
  section: "PAYROLL",
  title: [
    { text: "Pay staff from ", options: { color: COLORS.ink } },
    { text: "HR, not Expenses.", options: { color: COLORS.navy, italic: true } },
  ],
  story: "Cashier Nila’s salary is Tk 18,000. You pay her in cash at month end.",
  where: "HR → Salary Payments",
  steps: [
    "Open Salary Payments for her branch.",
    "Pick the employee, the cash drawer, the method.",
    "Pay. The voucher tags Nila on Salary Payable.",
  ],
  debit: "Salary Payable",
  credit: "Cash in Hand",
  amount: "18,000",
  note: "Payroll first accrues Debit Salary & Wages / Credit Salary Payable. The payment then clears the payable. Recording salary as a daily Expense double-counts the cost.",
});

// ============================================================================
// SLIDE 17 — Opening balances
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "16  —  STARTING THE BOOKS", page: 17, section: "OPENING" });
  addSlideTitle(s, [
    { text: "Day one: ", options: { color: COLORS.ink } },
    { text: "opening balances.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 32, h: 0.65 });

  s.addText("You join ERP71 with Tk 25,000 cash, Tk 80,000 in the bank, and customers already owing Tk 15,000. That is the owner’s capital still in the shop.", {
    x: 0.7, y: 1.6, w: 12.0, h: 0.55,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, italic: true, margin: 0,
  });

  addCard(s, { x: 0.7, y: 2.28, w: 5.9, h: 4.37 });
  s.addText("WHERE IN ERP71", {
    x: 1.0, y: 2.48, w: 5.3, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText("Accounting → Opening Balances", {
    x: 1.0, y: 2.88, w: 5.3, h: 0.5,
    fontFace: FONT_TITLE, fontSize: 20, color: COLORS.navy, italic: true, margin: 0,
  });
  [
    "Set the as-of date — the day before you go live.",
    "Enter the four lines on the right. Totals must match.",
    "Post Opening Balances. One Journal voucher is created.",
  ].forEach((line, i) => {
    s.addText(`${i + 1}.  ${line}`, {
      x: 1.0, y: 3.55 + i * 0.7, w: 5.3, h: 0.65,
      fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
    });
  });

  addCard(s, { x: 6.85, y: 2.28, w: 5.8, h: 4.37 });
  s.addText("THE BOOKS LOOK LIKE THIS", {
    x: 7.15, y: 2.48, w: 5.2, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
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
      { text: "Account", options: { ...head, align: "left" } },
      { text: "Debit", options: head },
      { text: "Credit", options: head },
    ],
    [cell("Cash in Hand", debitFill), cell("25,000", debitFill, { align: "right", bold: true, color: COLORS.navy }), cell("", debitFill, { align: "right" })],
    [cell("Main Bank Account", debitFill), cell("80,000", debitFill, { align: "right", bold: true, color: COLORS.navy }), cell("", debitFill, { align: "right" })],
    [cell("Accounts Receivable", debitFill), cell("15,000", debitFill, { align: "right", bold: true, color: COLORS.navy }), cell("", debitFill, { align: "right" })],
    [cell("Owner's Equity", creditFill), cell("", creditFill, { align: "right" }), cell("1,20,000", creditFill, { align: "right", bold: true, color: "3D5A32" })],
  ], {
    x: 7.15, y: 2.9, w: 5.2, h: 2.35,
    colW: [2.5, 1.35, 1.35],
    border: [{ pt: 0 }, { pt: 0 }, { pt: 0 }, { pt: 0 }],
    fontFace: FONT_BODY,
  });
  s.addText("Never credit this month’s Sales Revenue for old dues. Use Opening Balance Equity if you are importing a customer’s previous due.", {
    x: 7.15, y: 5.4, w: 5.2, h: 0.95,
    fontFace: FONT_BODY, fontSize: 13, color: COLORS.ink, margin: 0,
  });
}

// ============================================================================
// SLIDE 18 — Inter-branch
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "17  —  TWO BRANCHES", page: 18, section: "BRANCHES" });

  addSlideTitle(s, [
    { text: "Cash sent to the ", options: { color: COLORS.ink } },
    { text: "other branch.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 32, h: 0.65 });

  s.addText("Accounting → Fund Transfers. Gulshan shop sends Tk 10,000 cash to Uttara shop. Two vouchers, one send and one receive.", {
    x: 0.7, y: 1.6, w: 12.0, h: 0.5,
    fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0,
  });

  addCard(s, { x: 0.7, y: 2.25, w: 5.9, h: 4.4 });
  s.addText("1  ·  INITIATE  ·  GULSHAN", {
    x: 1.0, y: 2.45, w: 5.3, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  addEntryTable(s, {
    x: 1.0, y: 2.95, w: 5.3, h: 1.55,
    debit: "Due from Branches",
    credit: "Cash in Hand",
    amount: "10,000",
  });
  s.addText("Gulshan’s Cash in Hand drawer goes down. The company now has a receivable from Uttara.", {
    x: 1.0, y: 4.75, w: 5.3, h: 1.4,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
  });

  addCard(s, { x: 6.85, y: 2.25, w: 5.8, h: 4.4 });
  s.addText("2  ·  RECEIVE  ·  UTTARA", {
    x: 7.15, y: 2.45, w: 5.2, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  addEntryTable(s, {
    x: 7.15, y: 2.95, w: 5.2, h: 1.55,
    debit: "Cash in Hand",
    credit: "Due to Branches",
    amount: "10,000",
  });
  s.addText("Uttara’s Cash in Hand drawer goes up. Use this screen — do not type a Fund Transfer voucher by hand.", {
    x: 7.15, y: 4.75, w: 5.2, h: 1.4,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
  });
}

// ============================================================================
// SLIDE 19 — Bad debt and bank charges
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "18  —  TWO SMALL EVENTS", page: 19, section: "ADJUSTMENTS" });

  addSlideTitle(s, [
    { text: "Write off a due. ", options: { color: COLORS.ink } },
    { text: "Pay a bank charge.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 30, h: 0.65 });

  addCard(s, { x: 0.7, y: 1.7, w: 5.9, h: 4.95 });
  s.addText("CUSTOMER WILL NEVER PAY", {
    x: 1.0, y: 1.9, w: 5.3, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText("Tk 3,500 from a walk-in you cannot find. Sales → Bad Debts. Write off that customer.", {
    x: 1.0, y: 2.3, w: 5.3, h: 0.85,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
  });
  addEntryTable(s, {
    x: 1.0, y: 3.25, w: 5.3, h: 1.55,
    debit: "Bad Debt Expense",
    credit: "Accounts Receivable",
    amount: "3,500",
  });
  s.addText("The old sale stays. You are recording that collection failed. Needs the Write off customer debt permission.", {
    x: 1.0, y: 5.05, w: 5.3, h: 1.2,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
  });

  addCard(s, { x: 6.85, y: 1.7, w: 5.8, h: 4.95 });
  s.addText("BANK TOOK A CHARGE", {
    x: 7.15, y: 1.9, w: 5.2, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  s.addText("Premier Bank deducted Tk 200. Expenses is fine. Or a Bank Payment voucher if you prefer the ledger.", {
    x: 7.15, y: 2.3, w: 5.2, h: 0.85,
    fontFace: FONT_BODY, fontSize: 15, color: COLORS.ink, margin: 0,
  });
  addEntryTable(s, {
    x: 7.15, y: 3.25, w: 5.2, h: 1.55,
    debit: "General Operating Expense",
    credit: "Main Bank Account",
    amount: "200",
  });
  s.addText("Tax paid to NBR is the same shape: Bank Payment, debit your tax payable account, credit the bank.", {
    x: 7.15, y: 5.05, w: 5.2, h: 1.2,
    fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
  });
}

// ============================================================================
// SLIDE 20 — Pocket card
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };
  addChrome(s, { topLabel: "19  —  POCKET CARD", page: 20, section: "LOOKUP" });

  addSlideTitle(s, [
    { text: "What happened → ", options: { color: COLORS.ink } },
    { text: "where → the two lines.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 28, h: 0.6 });

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
      fontSize: 12,
      valign: "middle",
    },
  });

  const rows = [
    [
      { text: "Event", options: headOpt },
      { text: "Screen", options: headOpt },
      { text: "Debit", options: headOpt },
      { text: "Credit", options: headOpt },
    ],
  ];
  const data = [
    ["Customer pays you", "Customer Payments", "Cash / Bank / bKash", "Accounts Receivable"],
    ["You pay a supplier", "Supplier Payments", "Purchase Payable", "Cash / Bank"],
    ["Owner puts money in", "Cash or Bank Receive", "Cash or Bank", "Owner's Equity"],
    ["Owner takes money out", "Cash or Bank Payment", "Owner's Equity", "Cash or Bank"],
    ["Cash deposited in bank", "Fund Transfer voucher", "Main Bank Account", "Cash in Hand"],
    ["Other income", "Cash / Bank Receive", "Cash or Bank", "Other income account"],
    ["You borrowed", "Loans (Payable)", "Cash or Bank", "Loans Payable"],
    ["You repay a loan", "Loan → Record payment", "Loans Payable", "Cash or Bank"],
    ["Partner capital in", "Investors", "Cash or Bank", "Investor Capital"],
    ["Buy a fridge", "Fixed Assets", "Fixed Assets", "Cash or Bank"],
    ["Pay salary", "HR → Salary Payments", "Salary Payable", "Cash or Bank"],
    ["Write off a due", "Sales → Bad Debts", "Bad Debt Expense", "Accounts Receivable"],
  ];
  data.forEach((r, i) => {
    const fill = i % 2 === 0 ? COLORS.white : "F7F3EA";
    rows.push(r.map((cell) => body(cell, fill)));
  });

  s.addTable(rows, {
    x: 0.55, y: 1.55, w: 12.25, h: 5.25,
    colW: [3.15, 3.35, 2.95, 2.8],
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
  addChrome(s, { topLabel: "20  —  GUARDRAILS", page: 21, section: "CHECK" });

  addSlideTitle(s, [
    { text: "Leave these alone. ", options: { color: COLORS.ink } },
    { text: "Then check.", options: { color: COLORS.navy, italic: true } },
  ], { fontSize: 32, h: 0.65 });

  addCard(s, { x: 0.7, y: 1.7, w: 5.9, h: 4.95, fill: COLORS.warnTint });
  s.addText("DO NOT JOURNAL", {
    x: 1.0, y: 1.95, w: 5.3, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  const dont = [
    "A sale you already made at POS",
    "A purchase you already received",
    "Rent or utility — use Expenses",
    "Salary — use HR Salary Payments",
    "A customer receipt — use Customer Payments",
    "Stock transfer or shrinkage",
  ];
  dont.forEach((line, i) => {
    s.addText(line, {
      x: 1.0, y: 2.45 + i * 0.6, w: 5.3, h: 0.55,
      fontFace: FONT_BODY, fontSize: 16, color: COLORS.ink, margin: 0,
    });
  });

  addCard(s, { x: 6.85, y: 1.7, w: 5.8, h: 4.95 });
  s.addText("AFTER YOU POST", {
    x: 7.15, y: 1.95, w: 5.2, h: 0.28,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.muted, charSpacing: 2, margin: 0,
  });
  const checks = [
    { t: "Ledger", d: "Accounting → Ledger. Open Cash in Hand or the bank. Your line is there." },
    { t: "Cashbook / Bankbook", d: "Running balance should match the drawer or the bank SMS." },
    { t: "Party", d: "Customer or supplier due should have moved. A voucher would leave it unchanged." },
    { t: "Trial Balance", d: "Debits still equal credits for the whole shop." },
  ];
  checks.forEach((c, i) => {
    const y = 2.4 + i * 0.95;
    s.addText(c.t, {
      x: 7.15, y, w: 5.2, h: 0.32,
      fontFace: FONT_TITLE, fontSize: 16, color: COLORS.navy, italic: true, margin: 0,
    });
    s.addText(c.d, {
      x: 7.15, y: y + 0.32, w: 5.2, h: 0.55,
      fontFace: FONT_BODY, fontSize: 14, color: COLORS.ink, margin: 0,
    });
  });
}

// ============================================================================
// SLIDE 22 — Close
// ============================================================================
{
  const s = pres.addSlide();
  s.background = { color: COLORS.bg };

  s.addText("ERP71  ·  ACCOUNTING", {
    x: 0.7, y: 0.5, w: 8, h: 0.35,
    fontFace: FONT_BODY, fontSize: 12, color: COLORS.ink,
    charSpacing: 3, margin: 0,
  });

  s.addText(
    [
      { text: "Screen first.", options: { color: COLORS.ink, breakLine: true } },
      { text: "Two lines.", options: { color: COLORS.navy, italic: true, breakLine: true } },
      { text: "They must match.", options: { color: COLORS.ink } },
    ],
    {
      x: 0.7, y: 1.7, w: 12.0, h: 3.2,
      fontFace: FONT_TITLE, fontSize: 52, margin: 0,
    }
  );

  s.addText("If you can say what received the money and what gave it, you can book the entry.", {
    x: 0.7, y: 5.2, w: 10.5, h: 0.7,
    fontFace: FONT_BODY, fontSize: 18, color: COLORS.ink, margin: 0,
  });

  s.addShape(pres.shapes.OVAL, {
    x: W - 2.0, y: H - 1.9, w: 1.05, h: 1.05,
    fill: { color: COLORS.navy }, line: { type: "none" },
  });

  s.addText("22  /  22", {
    x: 0.7, y: 7.08, w: 2.4, h: 0.26,
    fontFace: FONT_BODY, fontSize: 11, color: COLORS.muted,
    charSpacing: 2, margin: 0,
  });
}

pres.writeFile({ fileName: "/Users/bs01621/Projects/nayeem/erp71/docs/user-manual/erp71-accounting-other-entries.pptx" })
  .then(() => console.log("wrote pptx"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
