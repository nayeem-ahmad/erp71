import { formatBDT } from '@/lib/format';
import type { DailyReport } from '@/lib/daily-report';

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export type DailyReportPrintLabels = {
    title: string;
    openTill: string;
    asOf: string;
    sales: string;
    tenders: string;
    till: string;
    moneyOut: string;
    dues: string;
    topProducts: string;
    returns: string;
    stock: string;
    checklist: string;
    credit: string;
    noSales: string;
};

export function isStockVisible(stock: DailyReport['stock']): boolean {
    if (!stock) return false;
    return (
        stock.reorder.length > 0 ||
        stock.reorderCount > 0 ||
        stock.zeroCount > 0 ||
        stock.shrinkageCount > 0 ||
        stock.shrinkageAmount > 0
    );
}

export function isMoneyOutVisible(moneyOut: DailyReport['moneyOut']): boolean {
    if (!moneyOut) return false;
    const purchases = moneyOut.purchases != null && (moneyOut.purchases.count !== 0 || moneyOut.purchases.net !== 0);
    const paid = moneyOut.paidToSuppliers != null && moneyOut.paidToSuppliers !== 0;
    const expenses = moneyOut.expenses != null && (moneyOut.expenses.count !== 0 || moneyOut.expenses.amount !== 0);
    return purchases || paid || expenses;
}

export function isDuesVisible(dues: DailyReport['dues']): boolean {
    return dues != null;
}

export function isTillVisible(till: DailyReport['till']): boolean {
    return till != null;
}

function money(amount: number): string {
    return escapeHtml(formatBDT(amount));
}

function kvTable(rows: Array<[string, string]>): string {
    if (rows.length === 0) return '';
    return `<table><tbody>${rows
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`)
        .join('')}</tbody></table>`;
}

function section(title: string, inner: string): string {
    return `<section class="section"><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

function checklistLabel(code: string, labels: DailyReportPrintLabels): string {
    if (code === 'OPEN_TILL') return labels.openTill;
    if (code === 'REORDER') return labels.stock;
    return code;
}

export function buildDailyReportHtml(report: DailyReport, labels: DailyReportPrintLabels): string {
    const parts: string[] = [];

    parts.push(
        `<div class="subtitle">${escapeHtml(report.tenantName)} · ${escapeHtml(report.storeName)} · ${escapeHtml(report.date)}</div>`,
    );

    const vs =
        report.headlines.vsPreviousPct == null
            ? ''
            : ` (${report.headlines.vsPreviousPct > 0 ? '+' : ''}${report.headlines.vsPreviousPct}%)`;
    parts.push(
        kvTable([
            [labels.sales, `${money(report.headlines.netSales)}${escapeHtml(vs)}`],
            [labels.till, money(report.headlines.cashMovement)],
            [labels.dues, money(report.headlines.newDues)],
        ]),
    );

    if (report.sales.bills === 0 && report.sales.gross === 0) {
        parts.push(section(labels.sales, `<p>${escapeHtml(labels.noSales)}</p>`));
    } else {
        parts.push(
            section(
                labels.sales,
                kvTable([
                    [labels.sales, String(report.sales.bills)],
                    [labels.sales, money(report.sales.gross)],
                    [labels.sales, money(report.sales.returnsAmount)],
                    [labels.sales, money(report.sales.net)],
                ]),
            ),
        );
    }

    if (report.tenders.length > 0) {
        parts.push(
            section(
                labels.tenders,
                kvTable(
                    report.tenders.map((row) => [
                        row.method.toLowerCase() === 'credit' ? labels.credit : row.method,
                        money(row.amount),
                    ]),
                ),
            ),
        );
    }

    if (isTillVisible(report.till) && report.till) {
        const openNote =
            report.till.openSessionCount > 0
                ? `<p>${escapeHtml(labels.openTill)} (${report.till.openSessionCount})</p>`
                : '';
        const r = report.till.rollup;
        parts.push(
            section(
                labels.till,
                `${openNote}${kvTable([
                    [labels.till, money(r.expectedCash)],
                    [labels.till, r.variance == null ? '—' : money(r.variance)],
                ])}`,
            ),
        );
    }

    if (isMoneyOutVisible(report.moneyOut) && report.moneyOut) {
        const rows: Array<[string, string]> = [];
        if (report.moneyOut.purchases && (report.moneyOut.purchases.count !== 0 || report.moneyOut.purchases.net !== 0)) {
            rows.push([labels.moneyOut, money(report.moneyOut.purchases.net)]);
        }
        if (report.moneyOut.paidToSuppliers) {
            rows.push([labels.moneyOut, money(report.moneyOut.paidToSuppliers)]);
        }
        if (report.moneyOut.expenses && (report.moneyOut.expenses.count !== 0 || report.moneyOut.expenses.amount !== 0)) {
            rows.push([labels.moneyOut, money(report.moneyOut.expenses.amount)]);
        }
        parts.push(section(labels.moneyOut, kvTable(rows)));
    }

    if (isDuesVisible(report.dues) && report.dues) {
        parts.push(
            section(
                labels.dues,
                kvTable([
                    [labels.dues, money(report.dues.newDues)],
                    [labels.dues, money(report.dues.collected)],
                    [labels.dues, report.dues.accountsReceivable == null ? '—' : money(report.dues.accountsReceivable)],
                    [labels.dues, report.dues.accountsPayable == null ? '—' : money(report.dues.accountsPayable)],
                ]),
            ),
        );
    }

    if (report.topProducts.length > 0) {
        const rows = report.topProducts
            .map(
                (p) =>
                    `<tr><td>${escapeHtml(p.name)}</td><td>${p.units}</td><td>${money(p.revenue)}</td></tr>`,
            )
            .join('');
        parts.push(
            section(
                labels.topProducts,
                `<table><thead><tr><th>${escapeHtml(labels.topProducts)}</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`,
            ),
        );
    }

    if (report.returns.rows.length > 0) {
        const rows = report.returns.rows
            .map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${money(row.amount)}</td></tr>`)
            .join('');
        const more =
            report.returns.moreCount > 0 ? `<p>+${report.returns.moreCount}</p>` : '';
        parts.push(section(labels.returns, `<table><tbody>${rows}</tbody></table>${more}`));
    }

    if (isStockVisible(report.stock) && report.stock) {
        const reorder = report.stock.reorder
            .map(
                (row) =>
                    `<tr><td>${escapeHtml(row.name)}</td><td>${row.onHand}</td><td>${row.level}</td></tr>`,
            )
            .join('');
        parts.push(
            section(
                labels.stock,
                kvTable([
                    [labels.stock, String(report.stock.reorderCount)],
                    [labels.stock, String(report.stock.zeroCount)],
                    [labels.stock, String(report.stock.shrinkageCount)],
                ]) + (reorder ? `<table><tbody>${reorder}</tbody></table>` : ''),
            ),
        );
    }

    if (report.checklist.length > 0) {
        const items = report.checklist
            .map((item) => `<li>${escapeHtml(checklistLabel(item.code, labels))} (${item.count})</li>`)
            .join('');
        parts.push(section(labels.checklist, `<ul>${items}</ul>`));
    }

    if (report.till && report.till.openSessionCount > 0) {
        parts.push(`<div class="footer">${escapeHtml(labels.asOf)} ${escapeHtml(report.asOf)}</div>`);
    }

    return parts.join('\n');
}
