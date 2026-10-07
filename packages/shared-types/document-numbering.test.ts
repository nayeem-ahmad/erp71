import {
  DEFAULT_DOCUMENT_NUMBERING,
  NUMBERING_DOC_TYPES,
  documentNumberingPresets,
  fiscalYearLabel,
  numberingMatcher,
  numberingScopesFor,
  numberingTokensFor,
  normalizeStoreCode,
  numberingPeriodKey,
  parseNumberingTemplate,
  renderDocumentNumber,
  templateUsesToken,
  validateNumberingConfig,
  type DocumentNumberingConfig,
} from './document-numbering';

const config = (overrides: Partial<DocumentNumberingConfig> = {}): DocumentNumberingConfig => ({
  ...DEFAULT_DOCUMENT_NUMBERING.SALE,
  ...overrides,
});

describe('validateNumberingConfig', () => {
  it('accepts every document type\'s default and presets', () => {
    for (const docType of NUMBERING_DOC_TYPES) {
      expect(validateNumberingConfig(DEFAULT_DOCUMENT_NUMBERING[docType], docType)).toEqual([]);
      for (const preset of documentNumberingPresets(docType)) {
        expect(validateNumberingConfig(preset.config, docType)).toEqual([]);
      }
    }
  });

  it('keeps POS counters to the documents rung up at one', () => {
    const perCounter = config({ template: '{STORE}{COUNTER}-{FY}-{SEQ}', scope: 'COUNTER' });
    expect(validateNumberingConfig(perCounter, 'SALE')).toEqual([]);
    expect(validateNumberingConfig(perCounter, 'QUOTE').join()).toMatch(/not rung up at a POS counter/);
    expect(validateNumberingConfig(config({ template: 'PUR-{COUNTER}-{SEQ}', resetPolicy: 'NEVER' }), 'PURCHASE').join())
      .toMatch(/not rung up at a POS counter/);
  });

  it('requires exactly one {SEQ}', () => {
    expect(validateNumberingConfig(config({ template: 'INV-{FY}' })).join()).toMatch(/\{SEQ\} exactly once/);
    expect(validateNumberingConfig(config({ template: '{SEQ}-{FY}-{SEQ}' })).join()).toMatch(/\{SEQ\} exactly once/);
  });

  it('rejects unknown tokens, spaces and stray braces', () => {
    expect(validateNumberingConfig(config({ template: 'INV-{DD}-{SEQ}' })).join()).toMatch(/Unknown token \{DD\}/);
    expect(validateNumberingConfig(config({ template: 'INV {FY}-{SEQ}' })).join()).toMatch(/Only letters/);
    expect(validateNumberingConfig(config({ template: 'INV-{FY-{SEQ}' })).join()).toMatch(/Only letters|Unknown token/);
  });

  it('accepts tokens in any case', () => {
    expect(validateNumberingConfig(config({ template: 'inv-{fy}-{seq}' }))).toEqual([]);
  });

  it('refuses a reset the number cannot show', () => {
    // Would hand out INV-00001 again every July.
    expect(validateNumberingConfig(config({ template: 'INV-{SEQ}', resetPolicy: 'FISCAL_YEAR' })).join())
      .toMatch(/fiscal-year reset needs \{FY\}/);
    expect(validateNumberingConfig(config({ template: '{YYYY}-{SEQ}', resetPolicy: 'MONTHLY' })).join())
      .toMatch(/monthly reset needs \{MM\}/);
    expect(validateNumberingConfig(config({ template: '{MM}-{SEQ}', resetPolicy: 'MONTHLY' })).join())
      .toMatch(/monthly reset needs \{MM\} and a year/);
    expect(validateNumberingConfig(config({ template: '{FY}-{SEQ}', resetPolicy: 'CALENDAR_YEAR' })).join())
      .toMatch(/calendar-year reset/);
  });

  it('accepts any date tokens that pin the period down', () => {
    // Year + month determine the fiscal year; fiscal year + month the calendar year.
    expect(validateNumberingConfig(config({ template: '{YY}{MM}-{SEQ}', resetPolicy: 'FISCAL_YEAR' }))).toEqual([]);
    expect(validateNumberingConfig(config({ template: '{FY}{MM}-{SEQ}', resetPolicy: 'CALENDAR_YEAR' }))).toEqual([]);
    expect(validateNumberingConfig(config({ template: '{FY}-{MM}-{SEQ}', resetPolicy: 'MONTHLY' }))).toEqual([]);
    // A finer date than the reset needs is harmless.
    expect(validateNumberingConfig(config({ template: '{YYYY}{MM}-{SEQ}', resetPolicy: 'NEVER' }))).toEqual([]);
  });

  it('refuses a scope the number cannot show', () => {
    expect(validateNumberingConfig(config({ scope: 'STORE' })).join()).toMatch(/needs \{STORE\}/);
    expect(validateNumberingConfig(config({ template: '{STORE}-{FY}-{SEQ}', scope: 'COUNTER' })).join())
      .toMatch(/both \{STORE\} and \{COUNTER\}/);
    expect(validateNumberingConfig(config({ template: '{STORE}{COUNTER}-{FY}-{SEQ}', scope: 'COUNTER' }))).toEqual([]);
  });

  it('allows a branch code on a business-wide series', () => {
    expect(validateNumberingConfig(config({ template: '{STORE}-{FY}-{SEQ}', scope: 'TENANT' }))).toEqual([]);
  });

  it('bounds the length, the width and repeated tokens', () => {
    expect(validateNumberingConfig(config({ template: `${'A'.repeat(40)}-{FY}-{SEQ}` })).join()).toMatch(/40 characters/);
    expect(validateNumberingConfig(config({ seqWidth: 0 })).join()).toMatch(/between 1 and 8/);
    expect(validateNumberingConfig(config({ seqWidth: 9 })).join()).toMatch(/between 1 and 8/);
    expect(validateNumberingConfig(config({ template: '{FY}-{FY}-{SEQ}' })).join()).toMatch(/\{FY\} appears more than once/);
  });

  it('asks for a format when there is none', () => {
    expect(validateNumberingConfig(config({ template: '   ' }))).toEqual(['Enter a number format.']);
  });
});

describe('renderDocumentNumber', () => {
  const october2026 = { year: 2026, month: 10 };

  it('renders the default', () => {
    expect(renderDocumentNumber(DEFAULT_DOCUMENT_NUMBERING.SALE, 42, october2026)).toBe('INV-2627-00042');
  });

  it('renders every token', () => {
    const rendered = renderDocumentNumber(
      { template: '{STORE}/{COUNTER}/{YYYY}/{YY}{MM}/{FY}/{SEQ}', seqWidth: 3 },
      7,
      { year: 2027, month: 3, storeCode: 'DHK', counterNumber: 2 },
    );
    expect(rendered).toBe('DHK/2/2027/2703/2627/007');
  });

  it('lets the number outgrow its width rather than truncating', () => {
    expect(renderDocumentNumber({ template: 'INV-{SEQ}', seqWidth: 3 }, 12345, october2026)).toBe('INV-12345');
  });

  it('prints 0 for a sale rung up outside any counter', () => {
    expect(renderDocumentNumber({ template: '{STORE}{COUNTER}-{SEQ}', seqWidth: 2 }, 1, { ...october2026, storeCode: 'S1' }))
      .toBe('S10-01');
  });

  it('keeps literal case as typed', () => {
    expect(renderDocumentNumber({ template: 'Inv-{seq}', seqWidth: 2 }, 3, october2026)).toBe('Inv-03');
  });
});

describe('fiscalYearLabel and numberingPeriodKey', () => {
  it('turns the fiscal year in July', () => {
    expect(fiscalYearLabel(2026, 6)).toBe('2526');
    expect(fiscalYearLabel(2026, 7)).toBe('2627');
    expect(fiscalYearLabel(2099, 8)).toBe('9900');
    expect(fiscalYearLabel(2000, 1)).toBe('9900');
  });

  it('keys each reset policy differently', () => {
    const date = { year: 2026, month: 10 };
    expect(numberingPeriodKey('NEVER', date)).toBe('');
    expect(numberingPeriodKey('FISCAL_YEAR', date)).toBe('2627');
    expect(numberingPeriodKey('CALENDAR_YEAR', date)).toBe('Y2026');
    expect(numberingPeriodKey('MONTHLY', date)).toBe('M2026-10');
  });

  it('never lets a calendar-year key collide with a fiscal-year one', () => {
    expect(numberingPeriodKey('CALENDAR_YEAR', { year: 2021, month: 1 }))
      .not.toBe(numberingPeriodKey('FISCAL_YEAR', { year: 2021, month: 1 }));
  });
});

describe('helpers', () => {
  it('parses literals and tokens in order', () => {
    expect(parseNumberingTemplate('A{SEQ}B').parts).toEqual([{ literal: 'A' }, { token: 'SEQ' }, { literal: 'B' }]);
  });

  it('detects a token in use', () => {
    expect(templateUsesToken('{store}-{SEQ}', 'STORE')).toBe(true);
    expect(templateUsesToken('INV-{SEQ}', 'STORE')).toBe(false);
  });

  it('normalises branch codes', () => {
    expect(normalizeStoreCode(' dhk ')).toBe('DHK');
    expect(normalizeStoreCode('S12')).toBe('S12');
    expect(normalizeStoreCode('TOOLONG')).toBeNull();
    expect(normalizeStoreCode('D-1')).toBeNull();
    expect(normalizeStoreCode('')).toBeNull();
    expect(normalizeStoreCode(7)).toBeNull();
  });
});

describe('document types', () => {
  it('defaults each type to the format it printed before it was configurable', () => {
    const october = { year: 2026, month: 10 };
    expect(renderDocumentNumber(DEFAULT_DOCUMENT_NUMBERING.QUOTE, 42, october)).toBe('QT-2627-00042');
    expect(renderDocumentNumber(DEFAULT_DOCUMENT_NUMBERING.PROFORMA, 7, october)).toBe('PI-2627-00007');
    expect(renderDocumentNumber(DEFAULT_DOCUMENT_NUMBERING.PURCHASE, 1848, october)).toBe('PUR-01848');
  });

  it('offers presets in the document\'s own prefix', () => {
    expect(documentNumberingPresets('PURCHASE').map((p) => p.config.template))
      .toEqual(['PUR-{FY}-{SEQ}', '{STORE}-PUR-{FY}-{SEQ}', 'PUR-{YY}{MM}-{SEQ}', 'PUR-{SEQ}']);
    // The purchase default is one of its presets, so the page shows it selected.
    expect(documentNumberingPresets('PURCHASE').some((p) => p.config.template === DEFAULT_DOCUMENT_NUMBERING.PURCHASE.template
      && p.config.seqWidth === DEFAULT_DOCUMENT_NUMBERING.PURCHASE.seqWidth
      && p.config.resetPolicy === DEFAULT_DOCUMENT_NUMBERING.PURCHASE.resetPolicy)).toBe(true);
    // Sales keep the old reference look for their monthly preset.
    expect(documentNumberingPresets('SALE').find((p) => p.key === 'monthly')!.config)
      .toEqual({ template: '{YY}{MM}-{SEQ}', resetPolicy: 'MONTHLY', scope: 'TENANT', seqWidth: 3 });
  });

  it('offers counters only where there is a till', () => {
    expect(numberingScopesFor('SALE')).toEqual(['TENANT', 'STORE', 'COUNTER']);
    expect(numberingScopesFor('PURCHASE')).toEqual(['TENANT', 'STORE']);
    expect(numberingTokensFor('QUOTE')).not.toContain('COUNTER');
    expect(numberingTokensFor('SALE')).toContain('COUNTER');
  });
});

describe('numberingMatcher', () => {
  const october = { year: 2026, month: 10 };

  it('recognises the numbers one counter has printed, whatever their padding', () => {
    const { prefix, seqOf } = numberingMatcher({ template: 'PUR-{SEQ}' }, october);
    expect(prefix).toBe('PUR-');
    expect(seqOf('PUR-00042')).toBe(42);
    expect(seqOf('PUR-1848')).toBe(1848);
    // An import's purchase shares the prefix but is not one of this series.
    expect(seqOf('PUR-IMP-2526-00007')).toBeNull();
    expect(seqOf('XPUR-00001')).toBeNull();
  });

  it('pins the period and branch the counter belongs to', () => {
    const { prefix, seqOf } = numberingMatcher({ template: '{STORE}-{YY}{MM}-{SEQ}/A' }, { ...october, storeCode: 'DHK' });
    expect(prefix).toBe('DHK-2610-');
    expect(seqOf('DHK-2610-007/A')).toBe(7);
    expect(seqOf('DHK-2611-007/A')).toBeNull();
    expect(seqOf('CTG-2610-007/A')).toBeNull();
    expect(seqOf('DHK-2610-007')).toBeNull();
  });

  it('treats literal punctuation literally', () => {
    const { seqOf } = numberingMatcher({ template: 'A.{SEQ}' }, october);
    expect(seqOf('A.12')).toBe(12);
    expect(seqOf('AX12')).toBeNull();
  });
});
