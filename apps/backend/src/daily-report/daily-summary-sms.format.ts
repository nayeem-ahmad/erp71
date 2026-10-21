import type { DailyReport } from './daily-report.types';
import type { SummaryBranch } from './daily-summary-email.format';
import { round2 } from './money';

type SmsCopy = {
    noSales: string;
    sales: string;
    salesWithReturns: string;
    cash: string;
    purchases: string;
    expenses: string;
    dues: string;
    suppliers: string;
};

const SMS_COPY: Record<'en' | 'bn', SmsCopy> = {
    en: {
        noSales: 'No sales',
        sales: 'Sales {net} ({bills} bills)',
        salesWithReturns: 'Sales {net} ({bills} bills, {returns} returns)',
        cash: 'Cash {cash}',
        purchases: 'Purchases {n}',
        expenses: 'Expenses {n}',
        dues: 'Dues {ar}',
        suppliers: 'Suppliers {ap}',
    },
    bn: {
        noSales: 'বিক্রি নেই',
        sales: 'বিক্রি {net} ({bills} বিল)',
        salesWithReturns: 'বিক্রি {net} ({bills} বিল, {returns} রিটার্ন)',
        cash: 'নগদ {cash}',
        purchases: 'ক্রয় {n}',
        expenses: 'খরচ {n}',
        dues: 'বাকি {ar}',
        suppliers: 'সরবরাহকারী {ap}',
    },
};

function copyFor(locale: string): SmsCopy {
    return locale.toLowerCase().startsWith('bn') ? SMS_COPY.bn : SMS_COPY.en;
}

function fill(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        template,
    );
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

/** English stays in GSM-7 (`Tk`) so a normal summary is one SMS credit. Bangla is already Unicode, so it keeps ৳. */
function money(n: number, locale: string): string {
    const grouped = Math.abs(Math.round(n)).toLocaleString('en-US');
    const mark = locale.toLowerCase().startsWith('bn') ? '৳' : 'Tk';
    return `${n < 0 ? '-' : ''}${mark}${grouped}`;
}

function signedMoney(n: number, locale: string): string {
    if (n > 0) return `+${money(n, locale)}`;
    return money(n, locale);
}

/**
 * One short text for the whole shop. Company totals only: a branch list does
 * not fit, and customer or supplier dues are not added up across branches.
 */
export function formatDailySummarySms(input: {
    tenantName: string;
    date: string;
    timezone: string;
    locale: string;
    branches: SummaryBranch[];
}): string {
    const locale = input.locale;
    const copy = copyFor(locale);
    let net = 0;
    let bills = 0;
    let returnsCount = 0;
    let cash = 0;
    let purchases = 0;
    let expenses = 0;
    let dues: DailyReport['dues'] = null;

    for (const branch of input.branches) {
        const report = branch.report;
        net += report.sales.net;
        bills += report.sales.bills;
        returnsCount += report.sales.returnsCount;
        cash += report.headlines.cashMovement;
        purchases += report.moneyOut?.purchases?.net ?? 0;
        expenses += report.moneyOut?.expenses?.amount ?? 0;
        if (!dues && report.dues && (report.dues.accountsReceivable != null || report.dues.accountsPayable != null)) {
            dues = report.dues;
        }
    }

    net = round2(net);
    cash = round2(cash);
    purchases = round2(purchases);
    expenses = round2(expenses);

    const parts: string[] = [];
    if (bills === 0 && net === 0) {
        parts.push(copy.noSales);
    } else {
        const salesNet = money(net, locale);
        parts.push(
            returnsCount > 0
                ? fill(copy.salesWithReturns, { net: salesNet, bills, returns: returnsCount })
                : fill(copy.sales, { net: salesNet, bills }),
        );
    }
    if (cash !== 0) parts.push(fill(copy.cash, { cash: signedMoney(cash, locale) }));
    if (purchases !== 0) parts.push(fill(copy.purchases, { n: money(purchases, locale) }));
    if (expenses !== 0) parts.push(fill(copy.expenses, { n: money(expenses, locale) }));
    const ar = dues?.accountsReceivable;
    const ap = dues?.accountsPayable;
    if (ar) parts.push(fill(copy.dues, { ar: money(ar, locale) }));
    if (ap) parts.push(fill(copy.suppliers, { ap: money(ap, locale) }));

    return `${input.tenantName} ${formatDay(input.date, input.timezone)}: ${parts.join('. ')}.`;
}
