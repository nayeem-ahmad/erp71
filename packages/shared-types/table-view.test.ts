import { DEFAULT_TABLE_VIEW, isTableStripeColor, sanitizeTableView } from './table-view';

describe('sanitizeTableView', () => {
  it('keeps a preset stripe colour', () => {
    expect(sanitizeTableView({ stripeColor: 'amber' })).toEqual({ stripeColor: 'amber' });
  });

  it('keeps a custom #rrggbb stripe colour, lower-cased', () => {
    expect(sanitizeTableView({ stripeColor: '#F5F0FF' })).toEqual({ stripeColor: '#f5f0ff' });
  });

  it('drops a stripe colour that is neither a preset nor a hex colour', () => {
    // Anything else would end up inside a style attribute.
    expect(sanitizeTableView({ stripeColor: 'red; background:url(x)' })).toEqual({});
    expect(sanitizeTableView({ stripeColor: '#fff' })).toEqual({});
    expect(sanitizeTableView({ stripeColor: 'purple' })).toEqual({});
  });

  it('defaults to the grey stripe', () => {
    expect(DEFAULT_TABLE_VIEW.stripeColor).toBe('gray');
    expect(isTableStripeColor(DEFAULT_TABLE_VIEW.stripeColor)).toBe(true);
  });
});
