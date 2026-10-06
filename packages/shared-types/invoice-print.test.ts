import {
  DEFAULT_INVOICE_PRINT_PREFS,
  INVOICE_FOOTER_MAX_LENGTH,
  normalizeInvoicePrintPrefs,
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
      footer_text: null,
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
      footer_text: 'Goods once sold are not returnable.',
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
});
