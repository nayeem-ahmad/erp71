import {
  DEFAULT_DOCUMENT_NUMBERING,
  DOCUMENT_NUMBERING_PRESETS,
  fiscalYearLabel,
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
  it('accepts the default and every preset', () => {
    expect(validateNumberingConfig(DEFAULT_DOCUMENT_NUMBERING.SALE)).toEqual([]);
    for (const preset of DOCUMENT_NUMBERING_PRESETS) {
      expect(validateNumberingConfig(preset.config)).toEqual([]);
    }
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
