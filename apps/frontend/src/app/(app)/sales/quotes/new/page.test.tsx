import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewQuotationPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
// `?kind=` decides whether the screen is a quotation or a proforma, so the
// search params have to be mockable per test, not fixed at module scope.
const searchParams = { get: jest.fn().mockReturnValue(null) };
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
    useSearchParams: () => searchParams,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCurrentUser: jest.fn(),
        getCustomers: jest.fn(),
        searchProductsByQuantity: jest.fn(),
        createQuotation: jest.fn(),
    },
}));

const addRiceToCart = async () => {
    const searchInput = screen.getByPlaceholderText(/Add product/i);
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'Rice' } });
    await waitFor(() => screen.getByText('Rice 5kg'));
    fireEvent.click(screen.getByText('Rice 5kg'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
};

describe('NewQuotationPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams.get.mockReturnValue(null);
        (api.getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Test User' });
        (api.getCustomers as jest.Mock).mockResolvedValue([
            { id: 'cust-1', name: 'Rahim Ahmed', phone: '01700000001' },
        ]);
        (api.searchProductsByQuantity as jest.Mock).mockResolvedValue([
            { id: 'prod-1', name: 'Rice 5kg', sku: 'R5KG', price: '250.00', stocks: [{ quantity: 4 }] },
        ]);
        (api.createQuotation as jest.Mock).mockResolvedValue({ id: 'quote-1' });

        Object.defineProperty(window, 'localStorage', {
            value: { getItem: jest.fn(() => 'store-1'), setItem: jest.fn(), removeItem: jest.fn() },
            writable: true,
        });
    });

    it('renders on the shared entry shell with a Valid Until field', async () => {
        await act(async () => { render(<NewQuotationPage />); });

        expect(screen.getByText('New Quotation')).toBeInTheDocument();
        expect(screen.getByText('Valid Until')).toBeInTheDocument();
        expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
    });

    it('hides the fields a quotation cannot store', async () => {
        await act(async () => { render(<NewQuotationPage />); });

        // No document-level adjustments and no per-line discount: CreateQuotationDto
        // stores only a total and productId/quantity/unitPrice.
        expect(screen.queryByText('Transport')).not.toBeInTheDocument();
        expect(screen.queryByText('VAT (0%)')).not.toBeInTheDocument();
        expect(screen.queryByText('Disc %')).not.toBeInTheDocument();
        // No back-dating either — the API assigns the date server-side.
        expect(document.querySelector('input[type="datetime-local"]')).not.toBeInTheDocument();
    });

    it('adds a product through the shared staged product search', async () => {
        await act(async () => { render(<NewQuotationPage />); });
        await addRiceToCart();

        const lineTotal = screen.getAllByRole('cell').find((cell) => cell.textContent === '৳250.00');
        expect(lineTotal).toBeDefined();
    });

    it('submits the quotation and returns to the list', async () => {
        await act(async () => { render(<NewQuotationPage />); });
        await addRiceToCart();

        fireEvent.change(screen.getByPlaceholderText(/Notes/i), { target: { value: 'Bulk order' } });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Quotation/i }));
        });

        await waitFor(() => {
            expect(api.createQuotation).toHaveBeenCalledWith(
                expect.objectContaining({
                    storeId: 'store-1',
                    totalAmount: 250,
                    notes: 'Bulk order',
                    items: [{ productId: 'prod-1', quantity: 1, unitPrice: 250 }],
                }),
            );
        });
        expect(push).toHaveBeenCalledWith('/sales/quotes');
    });

    it('keeps the submit button disabled until an item is added', async () => {
        await act(async () => { render(<NewQuotationPage />); });

        expect(screen.getByRole('button', { name: /Create Quotation/i })).toBeDisabled();
        await addRiceToCart();
        expect(screen.getByRole('button', { name: /Create Quotation/i })).toBeEnabled();
    });

    it('surfaces a failed create and stays on the page', async () => {
        (api.createQuotation as jest.Mock).mockRejectedValue(new Error('Server error'));
        await act(async () => { render(<NewQuotationPage />); });
        await addRiceToCart();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Quotation/i }));
        });

        await waitFor(() => expect(api.createQuotation).toHaveBeenCalled());
        expect(push).not.toHaveBeenCalled();
    });

    describe('proforma mode', () => {
        const asProforma = () => searchParams.get.mockReturnValue('PROFORMA');

        it('stays an ordinary quotation without ?kind=PROFORMA', async () => {
            await act(async () => { render(<NewQuotationPage />); });

            expect(screen.getByText('New Quotation')).toBeInTheDocument();
            expect(screen.queryByText('Commercial Terms')).not.toBeInTheDocument();
        });

        it('renders the commercial terms block', async () => {
            asProforma();
            await act(async () => { render(<NewQuotationPage />); });

            expect(screen.getByText('New Proforma Invoice')).toBeInTheDocument();
            expect(screen.getByText('Commercial Terms')).toBeInTheDocument();
            expect(screen.getByText('Incoterm')).toBeInTheDocument();
            expect(screen.getByText('Payment terms')).toBeInTheDocument();
        });

        it('hides the exchange rate until the currency is not BDT', async () => {
            asProforma();
            await act(async () => { render(<NewQuotationPage />); });

            expect(screen.queryByText('BDT / USD')).not.toBeInTheDocument();

            const currency = screen.getByDisplayValue('BDT');
            await act(async () => { fireEvent.change(currency, { target: { value: 'USD' } }); });

            expect(screen.getByText('BDT / USD')).toBeInTheDocument();
        });

        it('refuses a foreign-currency proforma with no rate, without calling the API', async () => {
            asProforma();
            await act(async () => { render(<NewQuotationPage />); });
            await addRiceToCart();

            await act(async () => {
                fireEvent.change(screen.getByDisplayValue('BDT'), { target: { value: 'USD' } });
            });
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /Create Proforma Invoice/i }));
            });

            expect(api.createQuotation).not.toHaveBeenCalled();
            expect(push).not.toHaveBeenCalled();
        });

        it('sends the terms with the document', async () => {
            asProforma();
            await act(async () => { render(<NewQuotationPage />); });
            await addRiceToCart();

            await act(async () => {
                fireEvent.change(screen.getByDisplayValue('BDT'), { target: { value: 'USD' } });
            });
            await act(async () => {
                fireEvent.change(screen.getByLabelText('BDT / USD'), { target: { value: '121.5' } });
            });
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /Create Proforma Invoice/i }));
            });

            await waitFor(() => {
                expect(api.createQuotation).toHaveBeenCalledWith(
                    expect.objectContaining({
                        docKind: 'PROFORMA',
                        currency: 'USD',
                        exchangeRate: 121.5,
                    }),
                );
            });
            expect(push).toHaveBeenCalledWith('/sales/quotes');
        });

        it('never sends a rate on a BDT proforma', async () => {
            asProforma();
            await act(async () => { render(<NewQuotationPage />); });
            await addRiceToCart();

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /Create Proforma Invoice/i }));
            });

            await waitFor(() => expect(api.createQuotation).toHaveBeenCalled());
            const payload = (api.createQuotation as jest.Mock).mock.calls[0][0];
            expect(payload).toMatchObject({ docKind: 'PROFORMA', currency: 'BDT' });
            expect(payload.exchangeRate).toBeUndefined();
        });
    });
});
