/**
 * Styles for the plain "title + table + footer" documents — quotations, orders,
 * returns and list reports. Each of those pages used to carry its own near
 * identical copy of this block.
 */
export const SIMPLE_DOC_STYLES = `
    body { font-family: Arial, Helvetica, sans-serif; color: #111; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
    th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .total-row { font-weight: bold; border-top: 2px solid #333; }
    .total-row td { background: #fff; }
    .section, .note-section { margin-top: 20px; padding: 12px; background: #f9f9f9; border-radius: 8px; }
    .footer { margin-top: 32px; text-align: center; color: #999; font-size: 11px; }
`;
