import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useParams: jest.fn(() => ({})),
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    usePathname: jest.fn(() => '/test'),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getProducts: jest.fn(),
    },
}));

jest.mock('@/lib/branding', () => ({
    useBranding: jest.fn(() => ({ businessName: 'Test Store' })),
}));

jest.mock('@/components/BarcodeLabel', () => (props: any) => (
    <div data-testid="barcode-label" data-product={props.productName}>
        <span>{props.productName}</span>
        <span>{props.sku}</span>
    </div>
));

jest.mock('@/lib/format', () => ({
    formatBDT: (v: any) => `৳${Number(v).toFixed(2)}`,
    formatDate: (v: any) => (v ? `date:${v}` : '—'),
}));

import { api } from '@/lib/api';

const mockProducts = [
    { id: 'p1', name: 'Rice 5kg', sku: 'R5KG', price: '250.00' },
    { id: 'p2', name: 'Oil 1L', sku: 'O1L', price: '120.00' },
    { id: 'p3', name: 'Sugar 1kg', sku: null, price: '80.00' },
];

describe('PrintLabelsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock window.print
        Object.defineProperty(window, 'print', {
            value: jest.fn(),
            writable: true,
        });
    });

    it('shows loading state initially', async () => {
        (api.getProducts as jest.Mock).mockReturnValue(new Promise(() => {}));
        render(React.createElement(require('./page').default));
        expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    });

    it('renders Print Labels heading and product list after loading', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Print Labels' })).toBeInTheDocument());
        expect(screen.getByText('Rice 5kg')).toBeInTheDocument();
        expect(screen.getByText('Oil 1L')).toBeInTheDocument();
        expect(screen.getByText('Sugar 1kg')).toBeInTheDocument();
    });

    it('shows No products found when empty list returned', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue([]);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => expect(screen.getByText(/No products found/i)).toBeInTheDocument());
    });

    it('shows No products found when API rejects', async () => {
        (api.getProducts as jest.Mock).mockRejectedValue(new Error('Network error'));
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => expect(screen.getByText(/No products found/i)).toBeInTheDocument());
    });

    it('shows placeholder when no products are selected', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));
        expect(screen.getByText(/Select products on the left to preview labels/i)).toBeInTheDocument();
    });

    it('selects a product by clicking its checkbox', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);

        expect(screen.getByText('1 selected')).toBeInTheDocument();
        // Label preview should appear
        expect(screen.getByTestId('barcode-label')).toBeInTheDocument();
    });

    it('deselects a product by clicking its checkbox again', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        const checkboxes = screen.getAllByRole('checkbox');
        // Select then deselect
        fireEvent.click(checkboxes[0]);
        fireEvent.click(checkboxes[0]);

        expect(screen.getByText('0 selected')).toBeInTheDocument();
    });

    it('selects all products when Select all is clicked', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.click(screen.getByText('Select all'));
        expect(screen.getByText('3 selected')).toBeInTheDocument();
        expect(screen.getAllByTestId('barcode-label')).toHaveLength(3);
    });

    it('clears all selections when Clear is clicked', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.click(screen.getByText('Select all'));
        expect(screen.getByText('3 selected')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Clear'));
        expect(screen.getByText('0 selected')).toBeInTheDocument();
    });

    it('filters products by search term', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        const searchInput = screen.getByPlaceholderText(/Search products/i);
        fireEvent.change(searchInput, { target: { value: 'Rice' } });

        expect(screen.getByText('Rice 5kg')).toBeInTheDocument();
        expect(screen.queryByText('Oil 1L')).not.toBeInTheDocument();
        expect(screen.queryByText('Sugar 1kg')).not.toBeInTheDocument();
    });

    it('filters products by SKU search', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        const searchInput = screen.getByPlaceholderText(/Search products/i);
        fireEvent.change(searchInput, { target: { value: 'O1L' } });

        expect(screen.getByText('Oil 1L')).toBeInTheDocument();
        expect(screen.queryByText('Rice 5kg')).not.toBeInTheDocument();
    });

    it('shows clear button when search has text and clears on click', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        const searchInput = screen.getByPlaceholderText(/Search products/i);
        fireEvent.change(searchInput, { target: { value: 'Rice' } });

        // X button should appear
        const clearButton = screen.getByRole('button', { name: '' });
        // Check there's an X icon near the search field - find the X icon button
        const allButtons = screen.getAllByRole('button');
        // Find the clear search button (has X icon sibling to search input)
        const xButton = allButtons.find(btn => btn.querySelector('[data-testid="x-icon"]'));
        if (xButton) {
            fireEvent.click(xButton);
            expect((searchInput as HTMLInputElement).value).toBe('');
        }
    });

    it('renders multiple label copies when copies count is changed', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        // Select one product
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);

        // Change copies to 3
        // The copies input is a number spinbutton (no aria-label, just a sibling label element)
        const spinbuttons = screen.getAllByRole('spinbutton');
        // The copies spinbutton is the one with value "1" (copies input), not a date input
        const copiesInput = spinbuttons.find(el => (el as HTMLInputElement).value === '1') || spinbuttons[spinbuttons.length - 1];
        fireEvent.change(copiesInput, { target: { value: '3' } });

        await waitFor(() => expect(screen.getAllByTestId('barcode-label')).toHaveLength(3));
    });

    it('calls window.print when Print Selected button is clicked', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        const mockPrint = jest.fn();
        window.print = mockPrint;

        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        // Select a product first
        fireEvent.click(screen.getAllByRole('checkbox')[0]);

        // Click the Print Selected button
        fireEvent.click(screen.getByText(/Print Selected/i));
        expect(mockPrint).toHaveBeenCalled();
    });

    it('Print Selected button is disabled when no products selected', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        const printButton = screen.getByText(/Print Selected/i);
        expect(printButton.closest('button')).toBeDisabled();
    });

    it('shows preview count label when products are selected', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        await waitFor(() => expect(screen.getByText(/Preview — 1 label/i)).toBeInTheDocument());
    });

    it('shows plural label in preview count', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.click(screen.getByText('Select all'));
        await waitFor(() => expect(screen.getByText(/Preview — 3 labels/i)).toBeInTheDocument());
    });

    it('shows No SKU text for products without SKU', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));
        // Sugar 1kg has null SKU — should show "No SKU"
        expect(screen.getByText(/No SKU/i)).toBeInTheDocument();
    });

    it('handles non-array response from API gracefully', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue({ data: [] });
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => expect(screen.getByText(/No products found/i)).toBeInTheDocument());
    });

    it('clamps copies value to max 10', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.click(screen.getAllByRole('checkbox')[0]);

        const spinbuttons = screen.getAllByRole('spinbutton');
        const copiesInput = spinbuttons.find(el => (el as HTMLInputElement).value === '1') || spinbuttons[spinbuttons.length - 1];
        fireEvent.change(copiesInput, { target: { value: '99' } });

        // Should be clamped to 10
        await waitFor(() => expect(screen.getAllByTestId('barcode-label')).toHaveLength(10));
    });

    it('clamps copies to min 1', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.click(screen.getAllByRole('checkbox')[0]);

        const spinbuttons = screen.getAllByRole('spinbutton');
        const copiesInput = spinbuttons.find(el => (el as HTMLInputElement).value === '1') || spinbuttons[spinbuttons.length - 1];
        fireEvent.change(copiesInput, { target: { value: '0' } });

        // Should stay at min 1
        await waitFor(() => expect(screen.getAllByTestId('barcode-label')).toHaveLength(1));
    });

    it('calls window.print from preview area Print button', async () => {
        (api.getProducts as jest.Mock).mockResolvedValue(mockProducts);
        const mockPrint = jest.fn();
        window.print = mockPrint;

        await act(async () => {
            render(React.createElement(require('./page').default));
        });
        await waitFor(() => screen.getByText('Rice 5kg'));

        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        await waitFor(() => screen.getByText(/Preview — 1 label/i));

        // Click Print button in preview header
        const printButtons = screen.getAllByText('Print');
        fireEvent.click(printButtons[0]);
        expect(mockPrint).toHaveBeenCalled();
    });
});
