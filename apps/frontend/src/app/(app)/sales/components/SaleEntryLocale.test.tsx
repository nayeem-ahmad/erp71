import { render, screen, waitFor } from '@testing-library/react';
import TotalsFooter from './TotalsFooter';
import CustomerSelection from './CustomerSelection';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import { bnMessages } from '@/lib/localization/messages/bn';

/*
 * The sale entry screen with the UI switched to বাংলা. The global jest setup
 * pins every component to English, so this suite swaps in the Bangla catalog
 * to prove the screen's copy comes from the catalog rather than the source.
 */
jest.mock('@/lib/i18n', () => {
    const actual = jest.requireActual('@/lib/i18n');
    const { bnMessages: messages } = jest.requireActual('@/lib/localization/messages/bn');
    return {
        ...actual,
        useI18n: () => ({
            locale: 'bn',
            setLocale: jest.fn(),
            locales: [],
            localeInfo: { code: 'bn', label: 'Bangla', nativeLabel: 'বাংলা', htmlLang: 'bn', dir: 'ltr', numberLocale: 'bn-BD', dateLocale: 'bn-BD', enabled: true },
            t: messages,
            fmt: (template: string, values: Record<string, string | number>) =>
                actual.formatMessage(template, values, 'bn'),
        }),
    };
});

jest.mock('@/lib/api', () => ({
    api: { getCustomers: jest.fn().mockResolvedValue([]) },
}));

const totals = {
    subtotal: 1000,
    discount: 0,
    discountPercent: 0,
    discountAmount: 0,
    discountMode: 'PERCENT' as const,
    rounding: 0,
    vat: 50,
    transportCost: 0,
    laborCost: 0,
    total: 1000,
};

describe('sale entry in Bangla', () => {
    it('labels the totals panel from the bn catalog', () => {
        render(<TotalsFooter totals={totals} onTotalsChange={jest.fn()} tenantVatRate={5} previousDue={200} />);

        const copy = bnMessages.sales.entry.totals;
        expect(screen.getByText(copy.subtotal)).toBeInTheDocument();
        expect(screen.getByText('ডিসকাউন্ট')).toBeInTheDocument();
        expect(screen.getByText('পরিবহন খরচ')).toBeInTheDocument();
        expect(screen.getByText('শ্রমিক খরচ')).toBeInTheDocument();
        expect(screen.getByText('রাউন্ডিং')).toBeInTheDocument();
        expect(screen.getByText('মোট')).toBeInTheDocument();
        expect(screen.getByText('ভ্যাটসহ')).toBeInTheDocument();
        expect(screen.getByText('আগের বাকি')).toBeInTheDocument();
        expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
    });

    it('labels the customer picker from the bn catalog', async () => {
        render(<CustomerSelection customer={null} setCustomer={jest.fn()} />);

        expect(screen.getByText('গ্রাহক')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('নাম বা ফোন নম্বর দিয়ে খুঁজুন…')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Customer')).not.toBeInTheDocument());
    });

    it('falls back to Bangla column headings and empty state in the line items table', () => {
        render(<LineItemsTable items={[]} onUpdateItem={jest.fn()} onRemoveItem={jest.fn()} />);

        expect(screen.getByText('দর')).toBeInTheDocument();
        expect(screen.getByText('পরিমাণ')).toBeInTheDocument();
        expect(screen.getByText('এখনো কোনো আইটেম নেই — ওপরে খুঁজে পণ্য যোগ করুন।')).toBeInTheDocument();
    });
});
