'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import POSPage from './page';

jest.mock('@/components/HelpTooltip', () => ({
  HelpTooltip: () => null,
}));

jest.mock('@/lib/i18n', () => {
  const { enMessages } = require('@/lib/localization/messages/en');

  return {
    useI18n: () => ({
      t: enMessages,
    }),
  };
}, { virtual: true });

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  ShoppingCart: () => <span data-testid="icon-cart" />,
  Search: () => <span data-testid="icon-search" />,
  Package: () => <span data-testid="icon-package" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Plus: () => <span data-testid="icon-plus" />,
  Minus: () => <span data-testid="icon-minus" />,
  CreditCard: () => <span data-testid="icon-card" />,
  ChevronRight: () => <span data-testid="icon-chevron" />,
  Store: () => <span data-testid="icon-store" />,
  X: () => <span data-testid="icon-x" />,
  Banknote: () => <span data-testid="icon-banknote" />,
  CheckCircle: () => <span data-testid="icon-check" />,
  AlertCircle: () => <span data-testid="icon-alert" />,
  XCircle: () => <span data-testid="icon-x-circle" />,
  Printer: () => <span data-testid="icon-printer" />,
  WifiOff: () => <span data-testid="icon-wifi-off" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
  LayoutGrid: () => <span data-testid="icon-layout-grid" />,
  List: () => <span data-testid="icon-list" />,
  Gift: () => <span data-testid="icon-gift" />,
  User: () => <span data-testid="icon-user" />,
  History: () => <span data-testid="icon-history" />,
  Receipt: () => <span data-testid="icon-receipt" />,
}));

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
  MockLink.displayName = 'Link';
  return MockLink;
});

// Mock the API
jest.mock('@/lib/api', () => ({
  api: {
    getProducts: jest.fn(),
    getInventorySettings: jest.fn(),
    createSale: jest.fn(),
    getSales: jest.fn(),
  },
}));

const mockProducts = [
  { id: 'p1', name: 'Coffee Beans', sku: 'CB-001', price: '15.00', stocks: [{ quantity: 50, warehouse_id: 'wh-sales' }] },
  { id: 'p2', name: 'Green Tea', sku: 'GT-001', price: '8.00', stocks: [{ quantity: 20, warehouse_id: 'wh-sales' }] },
];

describe('POSPage — Story 10.2: POS Interface UI', () => {
  beforeEach(() => {
    const { api } = require('@/lib/api');
    localStorage.setItem('store_id', 'store-test');
    jest.clearAllMocks();
    api.getProducts.mockResolvedValue(mockProducts);
    api.getInventorySettings.mockResolvedValue({ default_sales_warehouse_id: 'wh-sales' });
    api.createSale.mockResolvedValue({ id: 'sale-1' });
    api.getSales.mockResolvedValue([
      {
        id: 'sale-1',
        serial_number: 'SL-00001',
        created_at: '2026-07-03T10:00:00.000Z',
        total_amount: '150.00',
        items: [{ id: 'i1' }, { id: 'i2' }],
        customer: { name: 'Walk-in Customer' },
      },
    ]);
  });

  it('renders the POS Terminal heading', async () => {
    render(<POSPage />);
    expect(screen.getByText('POS Terminal')).toBeInTheDocument();
  });

  it('shows empty cart state initially', async () => {
    render(<POSPage />);
    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
  });

  it('displays products after loading', async () => {
    render(<POSPage />);
    await waitFor(() => {
      expect(screen.getByText('Coffee Beans')).toBeInTheDocument();
      expect(screen.getByText('Green Tea')).toBeInTheDocument();
    });
  });

  it('shows stock quantity for each product', async () => {
    render(<POSPage />);
    await waitFor(() => {
      expect(screen.getByText('50 left')).toBeInTheDocument();
      expect(screen.getByText('20 left')).toBeInTheDocument();
    });
  });

  it('adds a product to the cart when clicked', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));

    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);

    expect(screen.getByText('1 Items')).toBeInTheDocument();
  });

  it('increments quantity when same product is added twice', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));

    const productCard = screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!;
    fireEvent.click(productCard);
    fireEvent.click(productCard);

    expect(screen.getByText('1 Items')).toBeInTheDocument(); // unique items still 1
    // quantity display should show 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('disables checkout button when cart is empty', async () => {
    render(<POSPage />);
    const checkoutBtn = screen.getByRole('button', { name: /complete checkout/i });
    expect(checkoutBtn).toBeDisabled();
  });

  it('enables checkout button when cart has items', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));

    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);

    const checkoutBtn = screen.getByRole('button', { name: /complete checkout/i });
    expect(checkoutBtn).not.toBeDisabled();
  });

  it('shows checkout modal when checkout button is clicked', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));
    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);

    const checkoutBtn = screen.getByRole('button', { name: /complete checkout/i });
    fireEvent.click(checkoutBtn);

    expect(screen.getByText('Payment Details')).toBeInTheDocument();
  });

  it('filters products by search query', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));

    fireEvent.change(screen.getByPlaceholderText(/search sku or name/i), {
      target: { value: 'green' },
    });

    expect(screen.queryByText('Coffee Beans')).not.toBeInTheDocument();
    expect(screen.getByText('Green Tea')).toBeInTheDocument();
  });
});

describe('POSPage — Story 10.3 & 10.4: Checkout & Advanced Payments', () => {
  beforeEach(() => {
    const { api } = require('@/lib/api');
    api.getProducts.mockResolvedValue(mockProducts);
    api.getInventorySettings.mockResolvedValue({ default_sales_warehouse_id: 'wh-sales' });
    api.createSale.mockResolvedValue({ id: 'sale-1' });
    localStorage.setItem('store_id', 'store-test');
  });

  it('checkout modal shows bKash, Cash, Card inputs', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));
    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);
    fireEvent.click(screen.getByRole('button', { name: /complete checkout/i }));

    expect(screen.getByText(/cash paid/i)).toBeInTheDocument();
    expect(screen.getByText(/bkash/i)).toBeInTheDocument();
    expect(screen.getByText(/credit card/i)).toBeInTheDocument();
  });

  it('disables confirm transaction when amount paid is less than total', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));
    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);
    fireEvent.click(screen.getByRole('button', { name: /complete checkout/i }));

    // Clear pre-filled cash (first input = cash)
    const [cashInput] = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(cashInput, { target: { value: '0' } });

    const confirmBtn = screen.getByRole('button', { name: /confirm transaction/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('displays change due when total paid exceeds total', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));
    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);
    fireEvent.click(screen.getByRole('button', { name: /complete checkout/i }));

    // Total = 15 * 1.1 = 16.50, pay 20 cash
    const cashInput = screen.getAllByPlaceholderText('0.00')[0];
    fireEvent.change(cashInput, { target: { value: '20' } });

    await waitFor(() => {
      expect(screen.getByText(/change due/i)).toBeInTheDocument();
    });
  });

  it('calls api.createSale with split payment data on confirm', async () => {
    const { api } = require('@/lib/api');
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));
    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);
    fireEvent.click(screen.getByRole('button', { name: /complete checkout/i }));

    // Set bKash payment (second input) in addition to pre-filled cash
    const inputs = screen.getAllByPlaceholderText('0.00');
    // inputs[0]=cash, inputs[1]=bkash, inputs[2]=card
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.change(inputs[1], { target: { value: '8.25' } }); // top up to >= total

    await waitFor(() => {
      const confirmBtn = screen.queryByRole('button', { name: /confirm transaction/i });
      if (confirmBtn && !confirmBtn.hasAttribute('disabled')) {
        fireEvent.click(confirmBtn);
      }
    });

    await waitFor(() => {
      expect(api.createSale).toHaveBeenCalled();
      expect(api.createSale).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: 'wh-sales' }));
    });
  });

  it('clears cart and closes modal after successful checkout', async () => {
    const { api } = require('@/lib/api');
    api.createSale.mockResolvedValue({ id: 'sale-ok' });

    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));
    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);
    fireEvent.click(screen.getByRole('button', { name: /complete checkout/i }));

    // Pre-filled cash should cover the total; just confirm
    const confirmBtn = screen.getByRole('button', { name: /confirm transaction/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
    });
  });

  it('displays remaining balance label when underpaid', async () => {
    render(<POSPage />);
    await waitFor(() => screen.getByText('Coffee Beans'));
    fireEvent.click(screen.getByText('Coffee Beans').closest('div[class*="cursor-pointer"]')!);
    fireEvent.click(screen.getByRole('button', { name: /complete checkout/i }));

    // Set cash to 0
    const cashInput = screen.getAllByPlaceholderText('0.00')[0];
    fireEvent.change(cashInput, { target: { value: '0' } });

    await waitFor(() => {
      expect(screen.getByText(/remaining/i)).toBeInTheDocument();
    });
  });

  it('shows recent sales in the history tab for the current user', async () => {
    const { api } = require('@/lib/api');
    render(<POSPage />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));

    await waitFor(() => {
      expect(api.getSales).toHaveBeenCalledWith({ mine: true, limit: 50 });
      expect(screen.getByText('SL-00001')).toBeInTheDocument();
      expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
    });
  });
});
