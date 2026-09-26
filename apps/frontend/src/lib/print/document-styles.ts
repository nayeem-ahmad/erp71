import { COMPACT_SCOPE } from './density';

/**
 * Styles for the plain "title + table + footer" documents — quotations, orders,
 * returns and list reports. Each of those pages used to carry its own near
 * identical copy of this block.
 *
 * Every one of them is a list of rows, so every one of them is `compactable`
 * and the compact rules ride along here: pass this block and the document's
 * Compact switch has something to switch.
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

    /* Compact. The page wrapper is a table too, and these leave it alone: its
       cells keep their zero padding because \`.p71-doc > tbody > tr > td\`
       outranks the rule below, and its margin is excluded outright — a
       pinned footer sizes that table to the page. */
    ${COMPACT_SCOPE} h1 { font-size: 16px; margin-bottom: 2px; }
    ${COMPACT_SCOPE} .subtitle { font-size: 11px; margin-bottom: 6px; }
    ${COMPACT_SCOPE} table:not(.p71-doc) { margin: 6px 0; }
    ${COMPACT_SCOPE} th, ${COMPACT_SCOPE} td { padding: 2px 6px; }
    ${COMPACT_SCOPE} th { font-size: 9px; letter-spacing: 0.5px; }
    ${COMPACT_SCOPE} .section, ${COMPACT_SCOPE} .note-section { margin-top: 8px; padding: 6px 8px; }
    ${COMPACT_SCOPE} .footer { margin-top: 12px; font-size: 10px; }
`;
