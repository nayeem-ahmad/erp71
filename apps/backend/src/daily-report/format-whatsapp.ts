import type { DailyReport, DailyReportChecklistCode } from './daily-report.types';
import { whatsappCopyFor, type WhatsAppCopy } from './whatsapp-copy';

function fill(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
    );
}

function formatTaka(n: number): string {
    const abs = Math.abs(n);
    const grouped = abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const signed = n < 0 ? `-${grouped}` : grouped;
    return `৳${signed}`;
}

function compactTaka(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1000) {
        const k = n / 1000;
        const body = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '');
        return `${body}k`;
    }
    return String(n);
}

function signedTaka(n: number): string {
    if (n > 0) return `+${formatTaka(n)}`;
    if (n < 0) return `-${formatTaka(Math.abs(n))}`;
    return formatTaka(0);
}

function formatTime(iso: string, timeZone: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(date);
}

function formatDay(date: string, timeZone: string): string {
    const start = `${date}T12:00:00.000Z`;
    const parsed = new Date(start);
    if (Number.isNaN(parsed.getTime())) return date;
    return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: 'numeric',
        month: 'short',
    }).format(parsed);
}

function tenderLabel(method: string, copy: WhatsAppCopy): string {
    if (method === 'Credit') return copy.due;
    if (method.toLowerCase() === 'cash') return 'cash';
    return method;
}

function checklistLabel(code: DailyReportChecklistCode, count: number, copy: WhatsAppCopy): string {
    if (code === 'OPEN_TILL') return fill(copy.openTill, { count });
    if (code === 'REORDER') return fill(copy.reorder, { count });
    return fill(copy.pendingDelivery, { count });
}

export function formatDailyReportWhatsApp(report: DailyReport, locale: string): string {
    const copy = whatsappCopyFor(locale);
    const header = `${report.tenantName} · ${report.storeName} · ${formatDay(report.date, report.timezone)}`;
    const asOf = fill(copy.asOf, { time: formatTime(report.asOf, report.timezone) });

    if (report.sales.bills === 0 && report.sales.net === 0) {
        return [header, copy.noSales, asOf].join('\n');
    }

    const salesLine =
        report.sales.returnsCount > 0
            ? fill(copy.salesWithReturns, {
                  net: formatTaka(report.sales.net).replace('৳', ''),
                  bills: report.sales.bills,
                  returns: report.sales.returnsCount,
              })
            : fill(copy.sales, {
                  net: formatTaka(report.sales.net).replace('৳', ''),
                  bills: report.sales.bills,
              });

    const lines: string[] = [header, salesLine];

    const tenderParts = report.tenders
        .filter((t) => t.amount !== 0)
        .map((t) => `${tenderLabel(t.method, copy)} ${compactTaka(t.amount)}`);
    if (tenderParts.length > 0) {
        lines.push(fill(copy.paid, { methods: tenderParts.join(' · ') }));
    }

    const tillOpen = (report.till?.openSessionCount ?? 0) > 0;
    const variance = report.till?.rollup.variance ?? null;
    let tillPart = copy.tillOpen;
    if (!tillOpen && variance !== null) {
        tillPart = signedTaka(variance);
    } else if (!tillOpen && variance === null) {
        tillPart = formatTaka(0);
    }
    lines.push(fill(copy.cashTill, { cash: signedTaka(report.headlines.cashMovement), till: tillPart }));

    const outParts: string[] = [];
    const purchasesNet = report.moneyOut?.purchases?.net ?? 0;
    const expensesAmount = report.moneyOut?.expenses?.amount ?? 0;
    if (purchasesNet !== 0) outParts.push(fill(copy.purchases, { n: compactTaka(purchasesNet) }));
    if (expensesAmount !== 0) outParts.push(fill(copy.expenses, { n: compactTaka(expensesAmount) }));
    if (outParts.length > 0) {
        lines.push(fill(copy.out, { parts: outParts.join(' · ') }));
    }

    if (report.dues) {
        const ar = report.dues.accountsReceivable;
        const ap = report.dues.accountsPayable;
        if (ar != null || ap != null) {
            lines.push(
                fill(copy.dues, {
                    ar: ar == null ? '—' : formatTaka(ar).replace('৳', ''),
                    ap: ap == null ? '—' : formatTaka(ap).replace('৳', ''),
                }),
            );
        }
    }

    const top = report.topProducts[0];
    if (top) {
        lines.push(fill(copy.top, { name: top.name, units: top.units }));
    }

    if (report.checklist.length > 0) {
        const shown = report.checklist.slice(0, 2).map((item) => checklistLabel(item.code, item.count, copy));
        const extra = report.checklist.length - 2;
        if (extra > 0) shown.push(fill(copy.moreOnReport, { n: extra }));
        lines.push(fill(copy.need, { items: shown.join(' · ') }));
    }

    lines.push(asOf);
    const text = lines.join('\n');
    if (text.length <= 700) return text;

    const compactTenders = report.tenders
        .filter((t) => t.amount !== 0)
        .map((t) => `${tenderLabel(t.method, copy)} ${compactTaka(t.amount)}`);
    if (compactTenders.length > 0) {
        lines[2] = fill(copy.paid, { methods: compactTenders.join(' · ') });
    }
    return lines.join('\n').slice(0, 700);
}
