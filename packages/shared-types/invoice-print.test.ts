import {
  DEFAULT_INVOICE_PRINT_PREFS,
  INVOICE_FOOTER_MAX_LENGTH,
  INVOICE_SIGNATURE_SPACE_MM,
  normalizeInvoicePrintPrefs,
  normalizeInvoicePrintPrefsPartial,
} from './invoice-print';

describe('normalizeInvoicePrintPrefs', () => {
  it('reads nothing saved as the built-in layout', () => {
    expect(normalizeInvoicePrintPrefs(null)).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
    expect(normalizeInvoicePrintPrefs(undefined)).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
    expect(normalizeInvoicePrintPrefs('garbage')).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
  });

  it('defaults to how the invoice printed before the setting existed', () => {
    expect(DEFAULT_INVOICE_PRINT_PREFS).toEqual({
      version: 1,
      layout: 'standard',
      padding: 'normal',
      balance: 'when-owed',
      table_style: 'minimal',
      amount_in_words: false,
      serial_column: false,
      signature_lines: false,
      hide_empty_discount: false,
      warranty_column: 'always',
      table_borders: 'none',
      footer_text: null,
      signature_space_mm: null,
    });
  });

  it('keeps every valid answer', () => {
    const saved = {
      version: 1,
      layout: 'detailed',
      padding: 'wide',
      balance: 'never',
      table_style: 'grid',
      amount_in_words: true,
      serial_column: true,
      signature_lines: true,
      hide_empty_discount: true,
      warranty_column: 'never',
      table_borders: 'columns',
      footer_text: 'Goods once sold are not returnable.',
      signature_space_mm: 25,
    };
    expect(normalizeInvoicePrintPrefs(saved)).toEqual(saved);
  });

  it('replaces only the fields that are not valid, keeping the rest', () => {
    expect(
      normalizeInvoicePrintPrefs({ padding: 'huge', table_style: 'striped', serial_column: 'yes' }),
    ).toEqual({ ...DEFAULT_INVOICE_PRINT_PREFS, table_style: 'striped' });
  });

  it('reads an unknown layout as the standard one', () => {
    expect(normalizeInvoicePrintPrefs({ layout: 'fancy' }).layout).toBe('standard');
    expect(normalizeInvoicePrintPrefs({ layout: 'detailed' }).layout).toBe('detailed');
  });

  it('reads the table borders choice, and an unknown one as none', () => {
    expect(normalizeInvoicePrintPrefs({ table_borders: 'columns' }).table_borders).toBe('columns');
    expect(normalizeInvoicePrintPrefs({ table_borders: 'thick' }).table_borders).toBe('none');
    expect(normalizeInvoicePrintPrefs({}).table_borders).toBe('none');
  });

  it('reads each warranty column choice, and an unknown one as always', () => {
    expect(normalizeInvoicePrintPrefs({ warranty_column: 'when-used' }).warranty_column).toBe('when-used');
    expect(normalizeInvoicePrintPrefs({ warranty_column: 'never' }).warranty_column).toBe('never');
    expect(normalizeInvoicePrintPrefs({ warranty_column: 'sometimes' }).warranty_column).toBe('always');
  });

  it('carries the old hide-when-empty switch over as "only when an item has one"', () => {
    expect(normalizeInvoicePrintPrefs({ hide_empty_warranty: true }).warranty_column).toBe('when-used');
    expect(normalizeInvoicePrintPrefs({ hide_empty_warranty: false }).warranty_column).toBe('always');
    // A choice made with the new control wins over the leftover switch.
    expect(
      normalizeInvoicePrintPrefs({ hide_empty_warranty: true, warranty_column: 'always' }).warranty_column,
    ).toBe('always');
  });

  it('keeps an empty footer as "no footer", distinct from the default', () => {
    expect(normalizeInvoicePrintPrefs({ footer_text: '' }).footer_text).toBe('');
  });

  it('cuts an over-long footer to the limit rather than dropping it', () => {
    const long = 'x'.repeat(INVOICE_FOOTER_MAX_LENGTH + 20);
    expect(normalizeInvoicePrintPrefs({ footer_text: long }).footer_text).toHaveLength(
      INVOICE_FOOTER_MAX_LENGTH,
    );
  });

  it('reads no signature space as the built-in gap', () => {
    expect(normalizeInvoicePrintPrefs({}).signature_space_mm).toBeNull();
    expect(normalizeInvoicePrintPrefs({ signature_space_mm: null }).signature_space_mm).toBeNull();
    expect(normalizeInvoicePrintPrefs({ signature_space_mm: '20' }).signature_space_mm).toBeNull();
    expect(normalizeInvoicePrintPrefs({ signature_space_mm: Number.NaN }).signature_space_mm).toBeNull();
  });

  it('keeps a signature space in whole mm, pulled inside the allowed range', () => {
    const { min, max } = INVOICE_SIGNATURE_SPACE_MM;
    expect(normalizeInvoicePrintPrefs({ signature_space_mm: 30 }).signature_space_mm).toBe(30);
    expect(normalizeInvoicePrintPrefs({ signature_space_mm: 12.6 }).signature_space_mm).toBe(13);
    expect(normalizeInvoicePrintPrefs({ signature_space_mm: 1 }).signature_space_mm).toBe(min);
    expect(normalizeInvoicePrintPrefs({ signature_space_mm: 500 }).signature_space_mm).toBe(max);
  });
});

describe('normalizeInvoicePrintPrefsPartial', () => {
  it('keeps only the answers that are present and valid', () => {
    expect(normalizeInvoicePrintPrefsPartial({ table_style: 'grid', layout: 'bogus' })).toEqual({
      table_style: 'grid',
    });
  });

  it('reads nothing as no answers at all', () => {
    expect(normalizeInvoicePrintPrefsPartial({})).toEqual({});
    expect(normalizeInvoicePrintPrefsPartial(null)).toEqual({});
    expect(normalizeInvoicePrintPrefsPartial('garbage')).toEqual({});
  });

  it('keeps a present null as an answer', () => {
    const partial = normalizeInvoicePrintPrefsPartial({ footer_text: null, signature_space_mm: null });
    expect(partial).toEqual({ footer_text: null, signature_space_mm: null });
    expect(Object.keys(partial).sort()).toEqual(['footer_text', 'signature_space_mm']);
  });

  it('drops a footer or signature gap that is the wrong type', () => {
    expect(normalizeInvoicePrintPrefsPartial({ footer_text: 5, signature_space_mm: '20' })).toEqual({});
    expect(normalizeInvoicePrintPrefsPartial({ signature_space_mm: Number.NaN })).toEqual({});
  });

  it('clamps like the full reader does', () => {
    const { max } = INVOICE_SIGNATURE_SPACE_MM;
    expect(normalizeInvoicePrintPrefsPartial({ signature_space_mm: 500 })).toEqual({ signature_space_mm: max });
    expect(
      normalizeInvoicePrintPrefsPartial({ footer_text: 'x'.repeat(INVOICE_FOOTER_MAX_LENGTH + 10) }).footer_text,
    ).toHaveLength(INVOICE_FOOTER_MAX_LENGTH);
  });

  it('maps the legacy hide_empty_warranty switch only when warranty_column is absent', () => {
    expect(normalizeInvoicePrintPrefsPartial({ hide_empty_warranty: true })).toEqual({
      warranty_column: 'when-used',
    });
    expect(normalizeInvoicePrintPrefsPartial({ hide_empty_warranty: true, warranty_column: 'never' })).toEqual({
      warranty_column: 'never',
    });
    expect(normalizeInvoicePrintPrefsPartial({ hide_empty_warranty: false })).toEqual({});
  });
});
