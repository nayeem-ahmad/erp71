import type { DailyReport, DailyReportChecklistCode } from './daily-report.types';
import { round2 } from './money';
import { whatsappCopyFor, type WhatsAppCopy } from './whatsapp-copy';

export type SummaryBranch = {
    storeId: string;
    storeName: string;
    report: DailyReport;
};

export type DailySummaryEmailContent = {
    subject: string;
    text: string;
    html: string;
};

type EmailCopy = { allBranches: string; openReport: string; cash: string };

const EMAIL_COPY: Record<'en' | 'bn', EmailCopy> = {
    en: { allBranches: 'All branches', openReport: 'Open the report', cash: 'Cash {cash}' },
    bn: { allBranches: 'সব শাখা', openReport: 'রিপোর্ট খুলুন', cash: 'নগদ {cash}' },
};

const CHECKLIST_ORDER: DailyReportChecklistCode[] = ['OPEN_TILL', 'REORDER', 'PENDING_DELIVERY'];

function emailCopyFor(locale: string): EmailCopy {
    return locale.toLowerCase().startsWith('bn') ? EMAIL_COPY.bn : EMAIL_COPY.en;
}

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
    const parsed = new Date(`${date}T12:00:00.000Z`);
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

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function isQuiet(report: DailyReport): boolean {
    const purchases = report.moneyOut?.purchases?.net ?? 0;
    const expenses = report.moneyOut?.expenses?.amount ?? 0;
    const openTill = report.till?.openSessionCount ?? 0;
    const variance = report.till?.rollup.variance ?? 0;
    return (
        report.sales.bills === 0 &&
        report.sales.net === 0 &&
        purchases === 0 &&
        expenses === 0 &&
        openTill === 0 &&
        !variance &&
        report.checklist.length === 0 &&
        report.topProducts.length === 0
    );
}

function salesLine(report: Pick<DailyReport, 'sales'>, copy: WhatsAppCopy): string {
    if (report.sales.bills === 0 && report.sales.net === 0) return copy.noSales;
    const net = formatTaka(report.sales.net).replace('৳', '');
    if (report.sales.returnsCount > 0) {
        return fill(copy.salesWithReturns, { net, bills: report.sales.bills, returns: report.sales.returnsCount });
    }
    return fill(copy.sales, { net, bills: report.sales.bills });
}

function paidLine(tenders: Array<{ method: string; amount: number }>, copy: WhatsAppCopy): string | null {
    const parts = tenders
        .filter((tender) => tender.amount !== 0)
        .map((tender) => `${tenderLabel(tender.method, copy)} ${compactTaka(tender.amount)}`);
    if (parts.length === 0) return null;
    return fill(copy.paid, { methods: parts.join(' · ') });
}

function outLine(purchases: number, expenses: number, copy: WhatsAppCopy): string | null {
    const parts: string[] = [];
    if (purchases !== 0) parts.push(fill(copy.purchases, { n: compactTaka(purchases) }));
    if (expenses !== 0) parts.push(fill(copy.expenses, { n: compactTaka(expenses) }));
    if (parts.length === 0) return null;
    return fill(copy.out, { parts: parts.join(' · ') });
}

function duesLine(dues: DailyReport['dues'], copy: WhatsAppCopy): string | null {
    if (!dues) return null;
    const ar = dues.accountsReceivable;
    const ap = dues.accountsPayable;
    if (ar == null && ap == null) return null;
    return fill(copy.dues, {
        ar: ar == null ? '—' : formatTaka(ar).replace('৳', ''),
        ap: ap == null ? '—' : formatTaka(ap).replace('৳', ''),
    });
}

function needLine(items: Array<{ code: DailyReportChecklistCode; count: number }>, copy: WhatsAppCopy): string | null {
    const shown = CHECKLIST_ORDER
        .map((code) => {
            const count = items.find((item) => item.code === code)?.count ?? 0;
            return count > 0 ? checklistLabel(code, count, copy) : null;
        })
        .filter((line): line is string => line !== null);
    if (shown.length === 0) return null;
    return fill(copy.need, { items: shown.join(' · ') });
}

function branchLines(report: DailyReport, locale: string, includeDues: boolean): string[] {
    const copy = whatsappCopyFor(locale);
    const extra = emailCopyFor(locale);
    if (isQuiet(report)) {
        const lines = [copy.noSales];
        if (includeDues) {
            const dues = duesLine(report.dues, copy);
            if (dues) lines.push(dues);
        }
        return lines;
    }

    const lines = [salesLine(report, copy)];
    const paid = paidLine(report.tenders, copy);
    if (paid) lines.push(paid);

    const tillOpen = (report.till?.openSessionCount ?? 0) > 0;
    const variance = report.till?.rollup.variance ?? null;
    let tillPart = copy.tillOpen;
    if (!tillOpen && variance !== null) tillPart = signedTaka(variance);
    else if (!tillOpen && variance === null) tillPart = formatTaka(0);
    const showTill = report.till !== null && (tillOpen || variance !== null);
    if (report.headlines.cashMovement !== 0 || showTill) {
        lines.push(
            showTill
                ? fill(copy.cashTill, { cash: signedTaka(report.headlines.cashMovement), till: tillPart })
                : fill(extra.cash, { cash: signedTaka(report.headlines.cashMovement) }),
        );
    }

    const out = outLine(report.moneyOut?.purchases?.net ?? 0, report.moneyOut?.expenses?.amount ?? 0, copy);
    if (out) lines.push(out);
    if (includeDues) {
        const dues = duesLine(report.dues, copy);
        if (dues) lines.push(dues);
    }
    const top = report.topProducts[0];
    if (top) lines.push(fill(copy.top, { name: top.name, units: top.units }));
    const need = needLine(report.checklist, copy);
    if (need) lines.push(need);
    return lines;
}

type Totals = {
    net: number;
    bills: number;
    returnsCount: number;
    cashMovement: number;
    purchases: number;
    expenses: number;
    tenders: Map<string, number>;
    dues: DailyReport['dues'];
    top: { name: string; units: number; revenue: number } | null;
    checklist: Array<{ code: DailyReportChecklistCode; count: number }>;
};

function sumBranches(branches: SummaryBranch[]): Totals {
    const tenders = new Map<string, number>();
    const products = new Map<string, { name: string; units: number; revenue: number }>();
    const checklist = new Map<DailyReportChecklistCode, number>();
    const totals: Totals = {
        net: 0,
        bills: 0,
        returnsCount: 0,
        cashMovement: 0,
        purchases: 0,
        expenses: 0,
        tenders,
        dues: null,
        top: null,
        checklist: [],
    };

    for (const branch of branches) {
        const report = branch.report;
        totals.net += report.sales.net;
        totals.bills += report.sales.bills;
        totals.returnsCount += report.sales.returnsCount;
        totals.cashMovement += report.headlines.cashMovement;
        totals.purchases += report.moneyOut?.purchases?.net ?? 0;
        totals.expenses += report.moneyOut?.expenses?.amount ?? 0;
        for (const tender of report.tenders) {
            tenders.set(tender.method, (tenders.get(tender.method) ?? 0) + tender.amount);
        }
        // Customer and supplier balances are kept once for the company. Each
        // branch report carries the same pair, so summing them would repeat it.
        if (!totals.dues && report.dues && (report.dues.accountsReceivable != null || report.dues.accountsPayable != null)) {
            totals.dues = report.dues;
        }
        for (const product of report.topProducts) {
            const existing = products.get(product.name) ?? { name: product.name, units: 0, revenue: 0 };
            existing.units += product.units;
            existing.revenue += product.revenue;
            products.set(product.name, existing);
        }
        for (const item of report.checklist) {
            if (item.code === 'REORDER') {
                // Reorder is counted across the company, and every branch
                // report repeats that same count.
                checklist.set('REORDER', Math.max(checklist.get('REORDER') ?? 0, item.count));
            } else {
                checklist.set(item.code, (checklist.get(item.code) ?? 0) + item.count);
            }
        }
    }

    totals.net = round2(totals.net);
    totals.cashMovement = round2(totals.cashMovement);
    totals.purchases = round2(totals.purchases);
    totals.expenses = round2(totals.expenses);
    for (const [method, amount] of tenders) tenders.set(method, round2(amount));
    totals.top = [...products.values()].sort(
        (a, b) => b.units - a.units || b.revenue - a.revenue || a.name.localeCompare(b.name),
    )[0] ?? null;
    totals.checklist = CHECKLIST_ORDER
        .filter((code) => (checklist.get(code) ?? 0) > 0)
        .map((code) => ({ code, count: checklist.get(code) ?? 0 }));
    return totals;
}

function overallLines(totals: Totals, locale: string): string[] {
    const copy = whatsappCopyFor(locale);
    const extra = emailCopyFor(locale);
    const lines = [
        salesLine(
            { sales: { bills: totals.bills, net: totals.net, returnsCount: totals.returnsCount, gross: 0, returnsAmount: 0, avgBill: 0 } },
            copy,
        ),
    ];
    const paid = paidLine(
        [...totals.tenders.entries()].map(([method, amount]) => ({ method, amount })),
        copy,
    );
    if (paid) lines.push(paid);
    if (totals.cashMovement !== 0 || totals.bills > 0) {
        lines.push(fill(extra.cash, { cash: signedTaka(totals.cashMovement) }));
    }
    const out = outLine(totals.purchases, totals.expenses, copy);
    if (out) lines.push(out);
    const dues = duesLine(totals.dues, copy);
    if (dues) lines.push(dues);
    if (totals.top) lines.push(fill(copy.top, { name: totals.top.name, units: totals.top.units }));
    const need = needLine(totals.checklist, copy);
    if (need) lines.push(need);
    if (lines.length === 1 && lines[0] === copy.noSales && !dues && !need) return [copy.noSales];
    return lines;
}

function reportUrl(baseUrl: string, date: string, storeId: string): string {
    const base = baseUrl.replace(/\/$/, '');
    const query = new URLSearchParams({ date, storeId });
    return `${base}/sales/daily-report?${query.toString()}`;
}

type Block = { heading: string; href: string | null; lines: string[] };

function renderText(header: string, blocks: Block[], asOf: string, openReport: { label: string; href: string } | null): string {
    const parts = [header];
    for (const [index, block] of blocks.entries()) {
        if (block.heading || block.href || index > 0) parts.push('');
        if (block.heading) parts.push(block.heading);
        if (block.href) parts.push(block.href);
        parts.push(...block.lines);
    }
    parts.push('', asOf);
    if (openReport) parts.push('', openReport.label, openReport.href);
    return parts.join('\n');
}

function renderHtml(header: string, blocks: Block[], asOf: string, openReport: { label: string; href: string } | null): string {
    const sections = blocks
        .map((block) => {
            const lines = block.lines.map((line) => escapeHtml(line)).join('<br>');
            if (!block.heading) return `<p style="margin:12px 0 0;">${lines}</p>`;
            const heading = block.href
                ? `<a href="${escapeHtml(block.href)}" style="color:#2563eb;font-weight:600;text-decoration:none;">${escapeHtml(block.heading)}</a>`
                : `<strong>${escapeHtml(block.heading)}</strong>`;
            return `<p style="margin:16px 0 4px;">${heading}</p><p style="margin:0;">${lines}</p>`;
        })
        .join('');
    const opener = openReport
        ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(openReport.href)}" style="color:#2563eb;">${escapeHtml(openReport.label)}</a></p>`
        : '';
    return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
<p style="margin:0;"><strong>${escapeHtml(header)}</strong></p>
${sections}
<p style="margin:16px 0 0;font-size:12px;color:#6b7280;">${escapeHtml(asOf)}</p>
${opener}
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">Powered by ERP71</p>
</div>`;
}

export function formatDailySummaryEmail(input: {
    tenantName: string;
    date: string;
    timezone: string;
    locale: string;
    asOf: string;
    branches: SummaryBranch[];
    reportBaseUrl: string;
}): DailySummaryEmailContent {
    const copy = whatsappCopyFor(input.locale);
    const extra = emailCopyFor(input.locale);
    const day = formatDay(input.date, input.timezone);
    const branches = [...input.branches].sort(
        (a, b) => b.report.sales.net - a.report.sales.net || a.storeName.localeCompare(b.storeName),
    );
    const single = branches.length === 1;
    const header = single
        ? `${input.tenantName} · ${branches[0].storeName} · ${day}`
        : `${input.tenantName} · ${day}`;
    const asOf = fill(copy.asOf, { time: formatTime(input.asOf, input.timezone) });

    const blocks: Block[] = [];
    if (!single) {
        blocks.push({
            heading: extra.allBranches,
            href: null,
            lines: branches.length === 0 ? [copy.noSales] : overallLines(sumBranches(branches), input.locale),
        });
    }
    for (const branch of branches) {
        const href = reportUrl(input.reportBaseUrl, input.date, branch.storeId);
        blocks.push({
            // The single-branch header already names the shop, so the body
            // starts with the figures. The link is "Open the report" instead.
            heading: single ? '' : branch.storeName,
            href: single ? null : href,
            lines: branchLines(branch.report, input.locale, single),
        });
    }

    const openReport = single
        ? { label: extra.openReport, href: reportUrl(input.reportBaseUrl, input.date, branches[0].storeId) }
        : null;

    return {
        subject: header,
        text: renderText(header, blocks, asOf, openReport),
        html: renderHtml(header, blocks, asOf, openReport),
    };
}
