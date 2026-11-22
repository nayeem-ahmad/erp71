import {
  bijoyToUnicode,
  containsBanglaUnicode,
  looksLikeBijoy,
  unicodeToBijoy,
} from './bijoy-unicode';

/** Expected strings are typed by hand, so normalise them like the converter does. */
const nfc = (s: string) => s.normalize('NFC');

/** [bijoy, unicode] pairs that must convert both ways. */
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  // label, bijoy, unicode
  ['independent vowels', 'A Av B C D E F G H I J', 'অ আ ই ঈ উ ঊ ঋ এ ঐ ও ঔ'],
  ['simple word', 'UvKv', 'টাকা'],
  ['ড় ঢ় য়', 'evwo Avlvp gq', 'বাড়ি আষাঢ় ময়'],
  ['khanda ta, anusvara, visarga, chandrabindu', 'nVvr evsjv `ytL Pvu`', 'হঠাৎ বাংলা দুঃখ চাঁদ'],
  ['ি pre-base', 'wK', 'কি'],
  ['ে pre-base', '‡K', 'কে'],
  ['ৈ pre-base', 'ˆK', 'কৈ'],
  ['ো split vowel', '‡Kvb', 'কোন'],
  ['ৌ split vowel', '‡gŠmyg', 'মৌসুম'],
  ['ি before a conjunct cluster', 'wk¶v', 'শিক্ষা'],
  ['ে before a three-consonant cluster', '‡K›`Ö', 'কেন্দ্র'],
  ['reph', 'ag©', 'ধর্ম'],
  ['reph before a post-base vowel sign', 'Kg©x', 'কর্মী'],
  ['reph on য', 'm~h©', 'সূর্য'],
  ['reph with a pre-base sign', 'KxwZ©', 'কীর্তি'],
  ['reph with ো', 'me©‡gvU', 'সর্বমোট'],
  ['ya-phala', 'e¨vsK', 'ব্যাংক'],
  ['ra-phala', 'cÖ_g', 'প্রথম'],
  ['ক্ষ', '¶gv', 'ক্ষমা'],
  ['স্ত', 'iv¯Ív', 'রাস্তা'],
  ['ন্ত', 'AšÍi', 'অন্তর'],
  ['ন্দ', 'my›`i', 'সুন্দর'],
  ['ঙ্গ', 'i½', 'রঙ্গ'],
  ['জ্ঞ', 'Ávb', 'জ্ঞান'],
  ['ম্প', '‡Kv¤úvwb', 'কোম্পানি'],
  ['স্থ', '¯’vb', 'স্থান'],
  ['ক্ত', 'i³', 'রক্ত'],
  ['ত্ত', 'DËi', 'উত্তর'],
  ['ত্র and ন্ত্র', 'QvÎ gš¿x', 'ছাত্র মন্ত্রী'],
  ['ligatures গু রু রূ', '¸iæ iƒc', 'গুরু রূপ'],
  ['digits', '0123456789', '০১২৩৪৫৬৭৮৯'],
  ['danda and double danda', 'Avwg|| Zywg|', 'আমি॥ তুমি।'],
  [
    'national-anthem sentence',
    'Avgvi ‡mvbvi evsjv, Avwg ‡Zvgvq fv‡jvevwm|',
    'আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।',
  ],
];

describe('bijoyToUnicode', () => {
  it.each(PAIRS)('%s', (_label, bijoy, unicode) => {
    expect(bijoyToUnicode(bijoy)).toBe(nfc(unicode));
  });

  it('returns NFC-normalised output', () => {
    const out = bijoyToUnicode('‡Kvb ‡gŠmyg gq');
    expect(out).toBe(out.normalize('NFC'));
    expect(out).toContain('ো'); // precomposed ো
    expect(out).toContain('ৌ'); // precomposed ৌ
  });

  it('reads glyph variants (z / “ / ª / † / ‰ / š— / ¯—)', () => {
    expect(bijoyToUnicode('¯‹zj')).toBe(nfc('স্কুল'));
    expect(bijoyToUnicode('`ª“Z')).toBe(nfc('দ্রুত'));
    expect(bijoyToUnicode('†K ‰K')).toBe(nfc('কে কৈ'));
    expect(bijoyToUnicode('Aš—i iv¯—v')).toBe(nfc('অন্তর রাস্তা'));
  });

  it('leaves spaces, newlines and plain punctuation untouched', () => {
    expect(bijoyToUnicode('Avwg, Zywg?\n(Avgiv) - "fv‡jv"!')).toBe(
      nfc('আমি, তুমি?\n(আমরা) - "ভালো"!'),
    );
  });

  it('converts SutonnyMJ curly quotes', () => {
    expect(bijoyToUnicode('ÒAvwgÓ')).toBe(nfc('“আমি”'));
  });

  it('returns an empty string for empty input', () => {
    expect(bijoyToUnicode('')).toBe('');
  });
});

describe('unicodeToBijoy', () => {
  it.each(PAIRS)('%s', (_label, bijoy, unicode) => {
    expect(unicodeToBijoy(nfc(unicode))).toBe(bijoy);
  });

  it('accepts precomposed and decomposed input alike', () => {
    expect(unicodeToBijoy('কো')).toBe('‡Kv');
    expect(unicodeToBijoy('কো')).toBe('‡Kv');
    expect(unicodeToBijoy('য়')).toBe('q');
    expect(unicodeToBijoy('য়')).toBe('q');
  });

  it('falls back to & (hasant) where no conjunct glyph exists', () => {
    expect(unicodeToBijoy('ক্গ')).toBe('K&M');
  });

  it('keeps ra-phala + ya-phala from being read as a reph', () => {
    expect(bijoyToUnicode(unicodeToBijoy('ক্র্য'))).toBe(nfc('ক্র্য'));
  });
});

describe('round trip unicode -> bijoy -> unicode', () => {
  const words = [
    'টাকা',
    'মূল্য',
    'ক্রেতা',
    'বিক্রয়',
    'পণ্য',
    'হিসাব',
    'তারিখ',
    'মোট',
    'দোকান',
    'কর্মচারী',
    'প্রতিষ্ঠান',
    'ঠিকানা',
    'পরিমাণ',
    'সর্বমোট',
    'ব্যবসা',
  ];

  it.each(words)('%s', (word) => {
    const original = nfc(word);
    expect(bijoyToUnicode(unicodeToBijoy(original))).toBe(original);
  });

  it('round-trips a full invoice line', () => {
    const line = nfc('ক্রেতা: রহিম স্টোর, মোট ১২,৫০০ টাকা। ধন্যবাদ!');
    expect(bijoyToUnicode(unicodeToBijoy(line))).toBe(line);
  });

  it('writes the expected Bijoy for a few business words', () => {
    expect(unicodeToBijoy(nfc('ক্রেতা'))).toBe('‡µZv');
    expect(unicodeToBijoy(nfc('বিক্রয়'))).toBe('weµq');
    expect(unicodeToBijoy(nfc('প্রতিষ্ঠান'))).toBe('cÖwZôvb');
    expect(unicodeToBijoy(nfc('কর্মচারী'))).toBe('Kg©Pvix');
  });
});

describe('containsBanglaUnicode', () => {
  it('detects Bangla Unicode', () => {
    expect(containsBanglaUnicode('মোট টাকা')).toBe(true);
    expect(containsBanglaUnicode('Total: ৫০০')).toBe(true);
  });

  it('is false for English and Bijoy text', () => {
    expect(containsBanglaUnicode('Total amount due')).toBe(false);
    expect(containsBanglaUnicode('Avgvi ‡mvbvi evsjv')).toBe(false);
    expect(containsBanglaUnicode('')).toBe(false);
  });
});

describe('looksLikeBijoy', () => {
  it.each([
    'Avgvi ‡mvbvi evsjv, Avwg ‡Zvgvq fv‡jvevwm|',
    'Kg©x',
    'UvKv',
    'evsjv‡`k',
    'cÖwZôv‡bi wVKvbv: XvKv',
  ])('is true for Bijoy text: %s', (text) => {
    expect(looksLikeBijoy(text)).toBe(true);
  });

  it.each([
    'The quick brown fox jumps over the lazy dog.',
    'Please pay the invoice total within 7 days.',
    'Invoice #1023 total 5,000 BDT due by Friday',
    '© 2026 Acme Corp. All rights reserved.',
    'Café crème brûlée',
    '',
    '12345',
  ])('is false for non-Bijoy text: %s', (text) => {
    expect(looksLikeBijoy(text)).toBe(false);
  });

  it('is false for Unicode Bangla, even mixed with Bijoy-looking text', () => {
    expect(looksLikeBijoy('আমার সোনার বাংলা')).toBe(false);
    expect(looksLikeBijoy('Avgvi ‡mvbvi বাংলা')).toBe(false);
  });

  it('agrees with the converter output', () => {
    const bijoy = unicodeToBijoy(nfc('আমাদের দোকানের মোট বিক্রয় আজ ভালো হয়েছে।'));
    expect(looksLikeBijoy(bijoy)).toBe(true);
  });
});
