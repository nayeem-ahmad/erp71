export type DailyReportTender = { method: string; amount: number };

export type DailyReportTillSession = {
    sessionId: string;
    counterName: string;
    cashierName: string;
    status: 'OPEN' | 'CLOSED';
    openingCash: number;
    cashTakings: number;
    refunds: number;
    cashIn: number;
    cashOut: number;
    expectedCash: number;
    closingCash: number | null;
    variance: number | null;
};

export type DailyReportTillRollup = {
    openingCash: number;
    cashTakings: number;
    refunds: number;
    cashIn: number;
    cashOut: number;
    expectedCash: number;
    closingCash: number | null;
    variance: number | null;
};

export type DailyReportChecklistCode = 'OPEN_TILL' | 'REORDER' | 'PENDING_DELIVERY';

export type DailyReport = {
    tenantName: string;
    storeName: string;
    date: string;
    timezone: string;
    generatedAt: string;
    asOf: string;
    firstSaleAt: string | null;
    lastSaleAt: string | null;
    headlines: {
        netSales: number;
        cashMovement: number;
        newDues: number;
        vsPreviousPct: number | null;
    };
    sales: {
        bills: number;
        gross: number;
        returnsAmount: number;
        returnsCount: number;
        net: number;
        avgBill: number;
    };
    tenders: DailyReportTender[];
    till: {
        sessions: DailyReportTillSession[];
        rollup: DailyReportTillRollup;
        openSessionCount: number;
        unassignedSalesCount: number;
    } | null;
    moneyOut: {
        purchases: { count: number; net: number } | null;
        paidToSuppliers: number | null;
        expenses: { count: number; amount: number } | null;
    } | null;
    dues: {
        newDues: number;
        collected: number;
        accountsReceivable: number | null;
        accountsPayable: number | null;
    } | null;
    topProducts: Array<{ name: string; units: number; revenue: number }>;
    returns: {
        rows: Array<{ label: string; amount: number }>;
        moreCount: number;
    };
    stock: {
        reorder: Array<{ name: string; onHand: number; level: number }>;
        reorderCount: number;
        zeroCount: number;
        shrinkageCount: number;
        shrinkageAmount: number;
    } | null;
    checklist: Array<{
        code: DailyReportChecklistCode;
        count: number;
        href: string;
    }>;
    whatsappText: string;
};
