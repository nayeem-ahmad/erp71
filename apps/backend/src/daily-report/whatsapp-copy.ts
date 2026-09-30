export type WhatsAppCopy = {
    noSales: string;
    sales: string;
    salesWithReturns: string;
    paid: string;
    due: string;
    cashTill: string;
    tillOpen: string;
    out: string;
    purchases: string;
    expenses: string;
    dues: string;
    top: string;
    need: string;
    moreOnReport: string;
    asOf: string;
    openTill: string;
    reorder: string;
    pendingDelivery: string;
};

export const WHATSAPP_COPY: Record<'en' | 'bn', WhatsAppCopy> = {
    en: {
        noSales: 'No sales',
        sales: 'Sales ৳{net} ({bills} bills)',
        salesWithReturns: 'Sales ৳{net} ({bills} bills, {returns} returns)',
        paid: 'Paid: {methods}',
        due: 'due',
        cashTill: 'Cash {cash} · till {till}',
        tillOpen: 'open',
        out: 'Out: {parts}',
        purchases: 'purchases {n}',
        expenses: 'expenses {n}',
        dues: 'Dues now ৳{ar} · suppliers ৳{ap}',
        top: 'Top: {name} ×{units}',
        need: 'Need: {items}',
        moreOnReport: '+{n} more on the full report',
        asOf: 'As of {time}',
        openTill: '{count} till open',
        reorder: '{count} to reorder',
        pendingDelivery: '{count} pending delivery',
    },
    bn: {
        noSales: 'বিক্রি নেই',
        sales: 'বিক্রি ৳{net} ({bills} বিল)',
        salesWithReturns: 'বিক্রি ৳{net} ({bills} বিল, {returns} রিটার্ন)',
        paid: 'পেইড: {methods}',
        due: 'বাকি',
        cashTill: 'নগদ {cash} · তল্লা {till}',
        tillOpen: 'খোলা',
        out: 'খরচ: {parts}',
        purchases: 'ক্রয় {n}',
        expenses: 'খরচ {n}',
        dues: 'বাকি ৳{ar} · সরবরাহকারী ৳{ap}',
        top: 'শীর্ষ: {name} ×{units}',
        need: 'করতে: {items}',
        moreOnReport: 'পূর্ণ রিপোর্টে আরও +{n}',
        asOf: '{time} পর্যন্ত',
        openTill: '{count} তল্লা খোলা',
        reorder: '{count} রিঅর্ডার',
        pendingDelivery: '{count} ডেলিভারি বাকি',
    },
};

export function whatsappCopyFor(locale: string): WhatsAppCopy {
    return locale.toLowerCase().startsWith('bn') ? WHATSAPP_COPY.bn : WHATSAPP_COPY.en;
}
