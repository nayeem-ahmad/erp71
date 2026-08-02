import type { StatementGroup } from '@/components/accounting/StatementSection';
import { formatBDT } from './format';
import { openPrintWindow, renderHeaderHtml } from './print';
import type { DeepPartial, PaperSize, PrintHeaderConfig } from './print';

/**
 * Printers for the three financial statements.
 *
 * They render the same figures the page shows rather than re-fetching, so what
 * comes out of the printer always matches what was on screen — including the
 * scope, level, as-of date and hide-zero choices the user made in the toolbar.
 */

export interface StatementPrintMeta {
    businessName?: string;
    /** Tenant header design; falls back to the built-in default when omitted. */
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    title: string;
    /** e.g. "Period" / "As of" — printed beside `periodValue`. */
    periodLabel: string;
    periodValue: string;
    /** Scope, level and approved-only, spelled out so a filed copy is unambiguous. */
    contextLines?: string[];
    /** "Balanced" / "Not balanced" — omitted where the statement has no such check. */
    statusNote?: string;
    locale?: string;
    generatedLabel: string;
    generatedAt: string;
}

/**
 * The toolbar choices spelled out for the printed copy. A statement filed
 * without them is ambiguous — the same date range gives different numbers per
 * branch, per detail level, and with approved-only on or off.
 */
export function reportContextLines(
    input: {
        scope: string;
        storeName?: string;
        level: string;
        levelLabel: string;
        approvedOnly: boolean;
        approvalEnabled: boolean;
    },
    labels: {
        scopeBranch: string;
        scopeCompany: string;
        levelLabel: string;
        approvedOnly: string;
        allVouchers: string;
    },
): string[] {
    const lines = [
        input.scope === 'branch'
            ? `${labels.scopeBranch}: ${input.storeName ?? '—'}`
            : labels.scopeCompany,
        `${labels.levelLabel}: ${input.levelLabel}`,
    ];
    // Only meaningful where the tenant actually runs voucher approval.
    if (input.approvalEnabled) {
        lines.push(input.approvedOnly ? labels.approvedOnly : labels.allVouchers);
    }
    return lines;
}

export interface StatementPrintSection {
    label: string;
    groups: StatementGroup[];
    totalLabel: string;
    total: number;
}

export interface StatementPrintFooterRow {
    label: string;
    amount: number;
    strong?: boolean;
}

const STATEMENT_STYLES = `
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
    .meta { margin-bottom: 10px; }
    .meta .period { font-size: 12px; font-weight: bold; }
    .meta .context { color: #555; font-size: 10px; margin-top: 2px; }
    .status { margin-top: 4px; font-size: 10px; font-weight: bold; }
    table.stmt { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    table.stmt th, table.stmt td { padding: 4px 6px; }
    table.stmt th { background: #f0f0f0; border-bottom: 1px solid #999; text-align: left;
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr.section td { background: #f0f0f0; font-weight: bold; border-top: 1px solid #999;
        border-bottom: 1px solid #999; text-transform: uppercase; font-size: 10px; }
    tr.group td { font-weight: bold; border-bottom: 1px solid #ddd; }
    tr.row td { border-bottom: 1px solid #f0f0f0; }
    tr.row td.name { padding-left: 22px; }
    tr.subtotal td { font-weight: bold; border-top: 1px solid #999; border-bottom: 2px solid #999; }
    tr.footer td { font-weight: bold; border-top: 2px solid #333; }
    tr.footer.strong td { border-top: 3px double #333; font-size: 12px; }
    .code { font-family: "Courier New", monospace; color: #666; width: 66px; }
    .num { text-align: right; white-space: nowrap; }
    .empty { color: #666; font-style: italic; }
    .footnote { margin-top: 10px; color: #666; font-size: 9px; }
`;

function escHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function metaHtml(meta: StatementPrintMeta): string {
    const context = (meta.contextLines ?? []).filter(Boolean);
    return `
    <div class="meta">
        <div class="period">${escHtml(meta.periodLabel)}: ${escHtml(meta.periodValue)}</div>
        ${context.length ? `<div class="context">${context.map(escHtml).join(' &nbsp;·&nbsp; ')}</div>` : ''}
        ${meta.statusNote ? `<div class="status">${escHtml(meta.statusNote)}</div>` : ''}
    </div>`;
}

function footnoteHtml(meta: StatementPrintMeta): string {
    return `<div class="footnote">${escHtml(meta.generatedLabel)}: ${escHtml(meta.generatedAt)}</div>`;
}

/**
 * A grouped statement — profit &amp; loss and balance sheet share this shape:
 * headed sections, each holding groups of accounts, each with a subtotal.
 */
export function printStatementReport(
    meta: StatementPrintMeta,
    sections: StatementPrintSection[],
    footerRows: StatementPrintFooterRow[],
    labels: { account: string; amount: string; noRows: string },
    paperSize: PaperSize = 'A4',
): void {
    const money = (value: number) => escHtml(formatBDT(value, { locale: meta.locale }));

    const sectionsHtml = sections.map((section) => {
        const groupsHtml = section.groups.length === 0
            ? `<tr class="row"><td colspan="3" class="empty">${escHtml(labels.noRows)}</td></tr>`
            : section.groups.map((entry) => `
                <tr class="group">
                    <td class="code">${escHtml(entry.group.code ?? '')}</td>
                    <td>${escHtml(entry.group.name)}</td>
                    <td class="num">${entry.rows.length === 0 ? money(entry.total) : ''}</td>
                </tr>
                ${entry.rows.map((row) => `
                <tr class="row">
                    <td class="code">${escHtml(row.code ?? '')}</td>
                    <td class="name">${escHtml(row.name)}</td>
                    <td class="num">${money(row.balance)}</td>
                </tr>`).join('')}
                ${entry.rows.length > 0 ? `
                <tr class="row">
                    <td class="code"></td>
                    <td class="name"><em>${escHtml(entry.group.name)}</em></td>
                    <td class="num">${money(entry.total)}</td>
                </tr>` : ''}
            `).join('');

        return `
            <tr class="section"><td colspan="3">${escHtml(section.label)}</td></tr>
            ${groupsHtml}
            <tr class="subtotal">
                <td class="code"></td>
                <td>${escHtml(section.totalLabel)}</td>
                <td class="num">${money(section.total)}</td>
            </tr>`;
    }).join('');

    const footerHtml = footerRows.map((row) => `
        <tr class="footer${row.strong ? ' strong' : ''}">
            <td class="code"></td>
            <td>${escHtml(row.label)}</td>
            <td class="num">${money(row.amount)}</td>
        </tr>`).join('');

    const bodyHtml = `
    ${metaHtml(meta)}
    <table class="stmt">
        <thead>
            <tr>
                <th class="code"></th>
                <th>${escHtml(labels.account)}</th>
                <th class="num">${escHtml(labels.amount)}</th>
            </tr>
        </thead>
        <tbody>${sectionsHtml}${footerHtml}</tbody>
    </table>
    ${footnoteHtml(meta)}`;

    openPrintWindow({
        title: `${meta.title} — ${meta.periodValue}`,
        paperSize,
        headerConfig: meta.headerConfig,
        headerHtml: renderHeaderHtml(
            meta.headerConfig,
            { docTitle: meta.title, companyName: meta.businessName },
            paperSize,
        ),
        bodyHtml,
        styles: STATEMENT_STYLES,
        repeatHeader: true,
    });
}

export interface TrialBalancePrintRow {
    code: string;
    name: string;
    group?: string;
    type: string;
    debitTotal: number;
    creditTotal: number;
    debitBalance: number;
    creditBalance: number;
}

/** The trial balance is a flat seven-column table rather than a grouped statement. */
export function printTrialBalanceReport(
    meta: StatementPrintMeta,
    rows: TrialBalancePrintRow[],
    totals: { debit: number; credit: number },
    labels: {
        code: string;
        account: string;
        type: string;
        grossDebit: string;
        grossCredit: string;
        debitBalance: string;
        creditBalance: string;
        totals: string;
        noRows: string;
    },
    paperSize: PaperSize = 'A4',
): void {
    const money = (value: number) => escHtml(formatBDT(value, { locale: meta.locale }));

    const rowsHtml = rows.length === 0
        ? `<tr class="row"><td colspan="7" class="empty">${escHtml(labels.noRows)}</td></tr>`
        : rows.map((row) => `
        <tr class="row">
            <td class="code">${escHtml(row.code || '—')}</td>
            <td>${escHtml(row.name)}${row.group ? `<div style="color:#888;font-size:9px">${escHtml(row.group)}</div>` : ''}</td>
            <td>${escHtml(row.type)}</td>
            <td class="num">${money(row.debitTotal)}</td>
            <td class="num">${money(row.creditTotal)}</td>
            <td class="num">${row.debitBalance > 0 ? money(row.debitBalance) : '—'}</td>
            <td class="num">${row.creditBalance > 0 ? money(row.creditBalance) : '—'}</td>
        </tr>`).join('');

    const bodyHtml = `
    ${metaHtml(meta)}
    <table class="stmt">
        <thead>
            <tr>
                <th class="code">${escHtml(labels.code)}</th>
                <th>${escHtml(labels.account)}</th>
                <th>${escHtml(labels.type)}</th>
                <th class="num">${escHtml(labels.grossDebit)}</th>
                <th class="num">${escHtml(labels.grossCredit)}</th>
                <th class="num">${escHtml(labels.debitBalance)}</th>
                <th class="num">${escHtml(labels.creditBalance)}</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
            <tr class="footer strong">
                <td colspan="5">${escHtml(labels.totals)}</td>
                <td class="num">${money(totals.debit)}</td>
                <td class="num">${money(totals.credit)}</td>
            </tr>
        </tbody>
    </table>
    ${footnoteHtml(meta)}`;

    openPrintWindow({
        title: `${meta.title} — ${meta.periodValue}`,
        paperSize,
        headerConfig: meta.headerConfig,
        headerHtml: renderHeaderHtml(
            meta.headerConfig,
            { docTitle: meta.title, companyName: meta.businessName },
            paperSize,
        ),
        bodyHtml,
        styles: STATEMENT_STYLES,
        repeatHeader: true,
    });
}
