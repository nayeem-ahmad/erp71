import { routes } from './routes';

const ACCOUNTING_ADVANCED_REPORT_PATHS = [
    routes.accounting.reports.comparativePl,
    routes.accounting.reports.budgetVsActual,
    routes.accounting.reports.cashFlow,
    routes.accounting.reports.financialRatios,
] as const;

export function isAccountingAdvancedReportPath(pathname: string): boolean {
    return ACCOUNTING_ADVANCED_REPORT_PATHS.some(
        (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
}