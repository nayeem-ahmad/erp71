import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    DEFAULT_INVOICE_PRINT_PREFS,
    DEFAULT_SECTION_VALUES,
    type MyPreferencesResponse,
    type PreferenceSource,
} from '@erp71/shared-types';
import { reloadInvoicePrintPrefs } from '@/lib/hooks/useInvoicePrintPrefs';
import { usePreferencesStore } from '@/lib/preferences/store';
import MyPreferencesSection from './MyPreferencesSection';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => ({ api: {} }));
jest.mock('@/lib/hooks/useInvoicePrintPrefs', () => ({
    reloadInvoicePrintPrefs: jest.fn(),
}));

const reload = reloadInvoicePrintPrefs as jest.Mock;

function response(sources: Partial<Record<string, PreferenceSource>> = {}): MyPreferencesResponse {
    const source = (key: string): PreferenceSource => sources[key] ?? 'default';
    return {
        profile: { id: 'p1', name: 'Cashier setup' },
        legacy_browser_sections: [],
        sections: {
            invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: source('invoicePrint') },
            tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: source('tableView') },
            tableColumns: { value: DEFAULT_SECTION_VALUES.tableColumns, source: source('tableColumns') },
            sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: source('sidebar') },
            alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: source('alerts') },
            device: { value: {}, source: 'default' },
        },
    };
}

function row(label: string): HTMLElement {
    return screen.getByText(label).closest('li') as HTMLElement;
}

beforeEach(() => {
    signInForPreferences('t:u');
    usePreferencesStore.getState().clear();
    reload.mockReset();
    reload.mockResolvedValue(DEFAULT_INVOICE_PRINT_PREFS);
});

describe('MyPreferencesSection', () => {
    it('names the source of each person section, one row each', () => {
        usePreferencesStore.getState().hydrate('t:u', response({
            invoicePrint: 'profile',
            tableView: 'default',
            tableColumns: 'member',
            sidebar: 'browser',
        }));
        render(<MyPreferencesSection />);

        expect(screen.getAllByRole('listitem')).toHaveLength(5);
        expect(within(row('Invoice layout')).getByText('Following Cashier setup default')).toBeInTheDocument();
        expect(within(row('List look')).getByText('Using the built-in setting')).toBeInTheDocument();
        expect(within(row('List columns')).getByText('Customised')).toBeInTheDocument();
        expect(within(row('Sidebar groups')).getByText('Set on this browser')).toBeInTheDocument();
        expect(within(row('Alerts')).getByText('Using the built-in setting')).toBeInTheDocument();
    });

    it('offers Reset only where the member or this browser has answered', () => {
        usePreferencesStore.getState().hydrate('t:u', response({
            invoicePrint: 'profile',
            tableColumns: 'member',
            sidebar: 'browser',
        }));
        render(<MyPreferencesSection />);

        expect(within(row('Invoice layout')).queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
        expect(within(row('List look')).queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
        expect(within(row('List columns')).getByRole('button', { name: 'Reset' })).toBeInTheDocument();
        expect(within(row('Sidebar groups')).getByRole('button', { name: 'Reset' })).toBeInTheDocument();
        expect(within(row('Alerts')).queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });

    it('Reset calls reset(key)', async () => {
        usePreferencesStore.getState().hydrate('t:u', response({ tableColumns: 'member', alerts: 'member' }));
        const resetMock = jest.fn().mockResolvedValue(undefined);
        usePreferencesStore.setState({ reset: resetMock });
        render(<MyPreferencesSection />);

        fireEvent.click(within(row('List columns')).getByRole('button', { name: 'Reset' }));
        await waitFor(() => expect(resetMock).toHaveBeenCalledWith('tableColumns'));
        expect(resetMock).toHaveBeenCalledTimes(1);
        expect(reload).not.toHaveBeenCalled();
    });

    it('disables Reset while it is running', async () => {
        usePreferencesStore.getState().hydrate('t:u', response({ alerts: 'member' }));
        let finish: () => void = () => undefined;
        usePreferencesStore.setState({
            reset: jest.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
        });
        render(<MyPreferencesSection />);

        fireEvent.click(within(row('Alerts')).getByRole('button', { name: 'Reset' }));
        expect(within(row('Alerts')).getByRole('button', { name: 'Reset' })).toBeDisabled();
        await act(async () => finish());
        await waitFor(() => expect(within(row('Alerts')).getByRole('button', { name: 'Reset' })).not.toBeDisabled());
    });

    it('resetting invoicePrint reloads the invoice print hook', async () => {
        usePreferencesStore.getState().hydrate('t:u', response({ invoicePrint: 'member' }));
        const order: string[] = [];
        usePreferencesStore.setState({
            reset: jest.fn(async () => {
                order.push('reset');
            }),
        });
        reload.mockImplementation(async () => {
            order.push('reload');
            return DEFAULT_INVOICE_PRINT_PREFS;
        });
        render(<MyPreferencesSection />);

        fireEvent.click(within(row('Invoice layout')).getByRole('button', { name: 'Reset' }));
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(order).toEqual(['reset', 'reload']);
    });

    it('renders nothing until preferences are loaded', () => {
        const { container } = render(<MyPreferencesSection />);
        expect(container).toBeEmptyDOMElement();
    });
});
