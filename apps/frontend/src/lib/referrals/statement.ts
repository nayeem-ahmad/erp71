import { openPrintWindow } from '@/lib/print';
import { formatBDT } from '@/lib/format';
import type { RefereeLedger } from '@/components/admin/referrals/types';

/**
 * The partner's own copy of the ledger.
 *
 * A referral partner is an independent earner: they have income to account for
 * and no way to evidence it beyond a screen they can scroll. This is that
 * evidence. It is generated in the browser from the ledger the portal already
 * holds rather than on the server, because there is nothing here the partner
 * cannot already see — no new endpoint, no second source of the same arithmetic.
 *
 * Uses `openPrintWindow` rather than jsPDF for the same reason the one-pager
 * does: business names and the partner's own name can be in Bangla, and only a
 * real browser window has the fonts for that.
 */

export type StatementLabels = {
    title: string;
    generatedOn: string;
    partner: string;
    code: string;
    summaryTitle: string;
    commissionsTitle: string;
    paymentsTitle: string;
    none: string;
    summary: Record<string, string>;
    commissionColumns: { tenant: string; status: string; commission: string; signedUp: string };
    paymentColumns: { date: string; amount: string; method: string; reference: string };
    status: Record<string, string>;
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function row(cells: string[], tag: 'td' | 'th' = 'td'): string {
    return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
}

export function printStatement(
    ledger: RefereeLedger,
    labels: StatementLabels,
    formatDate: (value: string | Date) => string,
): Window | null {
    const s = ledger.summary;

    const summaryRows = [
        [labels.summary.totalReferrals, String(s.total_referrals)],
        [labels.summary.totalEarned, formatBDT(s.total_earned_amount)],
        [labels.summary.totalPaid, formatBDT(s.total_paid_amount)],
        [labels.summary.balanceDue, formatBDT(s.balance_due)],
        // Only shown when non-zero: a zero row here reads as a problem that is not
        // there, and both of these mean something went wrong when they are not zero.
        ...(s.total_reversed_amount > 0
            ? [[labels.summary.reversed, formatBDT(s.total_reversed_amount)]]
            : []),
        ...(s.overpaid_amount > 0
            ? [[labels.summary.overpaid, formatBDT(s.overpaid_amount)]]
            : []),
    ]
        .map(([label, value]) => row([escapeHtml(label), `<strong>${escapeHtml(value)}</strong>`]))
        .join('');

    const commissionRows = ledger.commissions.length
        ? ledger.commissions
              .map((c) =>
                  row([
                      escapeHtml(c.tenant?.name ?? c.tenant_id),
                      escapeHtml(labels.status[c.status] ?? c.status),
                      escapeHtml(
                          c.commission_amount === null ? '—' : formatBDT(c.commission_amount),
                      ),
                      escapeHtml(formatDate(c.signed_up_at)),
                  ]),
              )
              .join('')
        : row([`<em>${escapeHtml(labels.none)}</em>`, '', '', '']);

    const paymentRows = ledger.payments.length
        ? ledger.payments
              .map((p) =>
                  row([
                      escapeHtml(formatDate(p.paid_at)),
                      escapeHtml(formatBDT(p.amount)),
                      escapeHtml(p.method ?? '—'),
                      escapeHtml(p.reference ?? '—'),
                  ]),
              )
              .join('')
        : row([`<em>${escapeHtml(labels.none)}</em>`, '', '', '']);

    const bodyHtml = `
<div class="stmt">
    <h1>${escapeHtml(labels.title)}</h1>
    <p class="meta">${escapeHtml(labels.generatedOn.replace('{date}', formatDate(new Date())))}</p>

    <table class="meta-table">
        ${row([escapeHtml(labels.partner), escapeHtml(ledger.referee.name)])}
        ${row([escapeHtml(labels.code), escapeHtml(ledger.referee.referral_code)])}
    </table>

    <h2>${escapeHtml(labels.summaryTitle)}</h2>
    <table class="data">${summaryRows}</table>

    <h2>${escapeHtml(labels.commissionsTitle)}</h2>
    <table class="data">
        <thead>${row(
            [
                labels.commissionColumns.tenant,
                labels.commissionColumns.status,
                labels.commissionColumns.commission,
                labels.commissionColumns.signedUp,
            ].map(escapeHtml),
            'th',
        )}</thead>
        <tbody>${commissionRows}</tbody>
    </table>

    <h2>${escapeHtml(labels.paymentsTitle)}</h2>
    <table class="data">
        <thead>${row(
            [
                labels.paymentColumns.date,
                labels.paymentColumns.amount,
                labels.paymentColumns.method,
                labels.paymentColumns.reference,
            ].map(escapeHtml),
            'th',
        )}</thead>
        <tbody>${paymentRows}</tbody>
    </table>
</div>`;

    return openPrintWindow({
        title: `${labels.title} — ${ledger.referee.referral_code}`,
        paperSize: 'A4',
        bodyHtml,
        autoPrint: true,
        styles: `
            .stmt h1 { font-size: 20px; margin-bottom: 4px; }
            .stmt h2 { font-size: 14px; margin: 20px 0 6px; }
            .stmt .meta { font-size: 11px; color: #6b7280; margin-bottom: 14px; }
            .stmt table { width: 100%; border-collapse: collapse; }
            .stmt .meta-table td { padding: 3px 0; font-size: 12px; }
            .stmt .meta-table td:first-child { color: #6b7280; width: 140px; }
            .stmt .data th, .stmt .data td {
                border-bottom: 1px solid #e5e7eb; padding: 6px 4px;
                font-size: 12px; text-align: left;
            }
            .stmt .data th {
                background: #f9fafb; font-weight: 600;
                border-bottom: 2px solid #d1d5db;
            }
            .stmt .data td:not(:first-child) { text-align: right; }
            .stmt .data th:not(:first-child) { text-align: right; }
        `,
    });
}
