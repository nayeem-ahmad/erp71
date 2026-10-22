'use client';

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import {
    DEFAULT_SECTION_VALUES,
    type LegacyBrowserSection,
    type MyPreferencesResponse,
    type PreferenceSource,
    type TableColumnsPrefs,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { SAVE_DEBOUNCE_MS, usePreferencesStore } from '@/lib/preferences/store';
import DataTable from './DataTable';
import { useTablePreferences } from './useTablePreferences';

/**
 * The real column store and the real preferences store, with only the network
 * mocked: what a list writes, and where, when it opens and when the viewer
 * changes it.
 */

jest.mock('@/lib/api', () => {
    const actual = jest.requireActual('@/lib/api');
    return {
        ...actual,
        fetchWithAuth: jest.fn().mockResolvedValue(null),
        api: {
            ...actual.api,
            saveMyPreferenceSection: jest.fn(),
            resetMyPreferenceSection: jest.fn(),
        },
    };
});
const saveApi = api.saveMyPreferenceSection as jest.Mock;

/** Captures the drag handler the table hands dnd-kit, so a test can fire a drag jsdom cannot. */
const mockDnd: { onDragEnd?: (event: unknown) => void } = {};

jest.mock('@dnd-kit/core', () => ({
    DndContext: ({ children, onDragEnd }: any) => {
        mockDnd.onDragEnd = onDragEnd;
        return <>{children}</>;
    },
    closestCenter: jest.fn(),
    KeyboardSensor: jest.fn(),
    PointerSensor: jest.fn(),
    useSensor: jest.fn(),
    useSensors: jest.fn(() => []),
}));

jest.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: any) => <>{children}</>,
    horizontalListSortingStrategy: jest.fn(),
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: jest.fn(),
        transform: null,
        transition: undefined,
        isDragging: false,
    }),
}));

jest.mock('@dnd-kit/utilities', () => ({
    CSS: { Translate: { toString: () => '' } },
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

interface Row {
    id: string;
    name: string;
    amount: number;
}

const columns: ColumnDef<Row, any>[] = [
    { accessorKey: 'name', header: 'Name', id: 'name' },
    { accessorKey: 'amount', header: 'Amount', id: 'amount' },
];

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: `Row ${i + 1}`, amount: i }));

const props = { tableId: 'orders', columns, data: rows, title: 'Orders' };

const STORAGE_KEY = 'data-table-preferences';

function hydrate(
    tableColumns: TableColumnsPrefs,
    { source = 'member', legacy = [] }: { source?: PreferenceSource; legacy?: LegacyBrowserSection[] } = {},
) {
    act(() =>
        usePreferencesStore.getState().hydrate('t1:user-a', {
            profile: null,
            legacy_browser_sections: legacy,
            sections: {
                invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
                tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
                tableColumns: { value: tableColumns, source },
                sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
                alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
                device: { value: {}, source: 'default' },
            },
        } as MyPreferencesResponse),
    );
}

const flush = () => act(async () => void jest.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1));

function stored(): Record<string, Record<string, unknown>> | null {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
}

/** Header labels in the order the table rendered them. */
function headers(): string[] {
    return screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '');
}

function hideColumn(label: string) {
    fireEvent.click(screen.getByTitle('Columns'));
    fireEvent.click(screen.getByLabelText(label));
}

beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    act(() => usePreferencesStore.getState().clear());
    act(() => useTablePreferences.setState({ tables: {} }));
    saveApi.mockReset();
    saveApi.mockImplementation(async (_key: string, body: TableColumnsPrefs) => ({
        value: usePreferencesStore.getState().data?.sections.tableColumns.value ?? body,
        source: 'member',
    }));
    delete mockDnd.onDragEnd;
});

afterEach(() => {
    jest.useRealTimers();
    act(() => usePreferencesStore.getState().clear());
});

describe('DataTable column preferences', () => {
    it('does not save on mount', async () => {
        // A profile's columns, which the member never chose: opening the list must not make them theirs.
        hydrate({ orders: { hidden: ['amount'], pageSize: 20 } }, { source: 'profile' });

        render(<DataTable {...props} />);
        await flush();

        expect(headers()).toEqual(['Name']);
        expect(screen.getByTestId('page-size-select')).toHaveValue('20');
        expect(saveApi).not.toHaveBeenCalled();
        expect(stored()).toBeNull();
    });

    it('does not save on mount before preferences load, nor when they arrive', async () => {
        render(<DataTable {...props} />);
        await flush();
        expect(stored()).toBeNull();

        hydrate({}, { source: 'default' });
        await flush();

        expect(saveApi).not.toHaveBeenCalled();
        expect(stored()).toBeNull();
    });

    it('hiding a column saves { [tableId]: { hidden, order, pageSize } }', async () => {
        hydrate({ orders: { order: ['amount', 'name'], pageSize: 20 } });
        render(<DataTable {...props} />);

        hideColumn('Amount');
        await flush();

        expect(headers()).toEqual(['Name']);
        expect(saveApi).toHaveBeenCalledTimes(1);
        expect(saveApi).toHaveBeenCalledWith('tableColumns', {
            orders: { hidden: ['amount'], order: ['amount', 'name'], pageSize: 20 },
        });
        expect(stored()).toBeNull();
    });

    it('dragging a column saves the order', async () => {
        hydrate({ orders: { pageSize: 20 } });
        render(<DataTable {...props} />);

        act(() => mockDnd.onDragEnd?.({ active: { id: 'amount' }, over: { id: 'name' } }));
        await flush();

        expect(headers()).toEqual(['Amount', 'Name']);
        expect(saveApi).toHaveBeenCalledWith('tableColumns', {
            orders: { order: ['amount', 'name'], pageSize: 20 },
        });
        expect(stored()).toBeNull();
    });

    it('changing page size saves pageSize', async () => {
        hydrate({ orders: { hidden: ['amount'] } });
        render(<DataTable {...props} />);

        fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '50' } });
        await flush();

        expect(screen.getByTestId('page-size-select')).toHaveValue('50');
        expect(saveApi).toHaveBeenCalledWith('tableColumns', { orders: { hidden: ['amount'], pageSize: 50 } });
        expect(stored()).toBeNull();
    });

    it('saves the page size the viewer picks in server mode', async () => {
        hydrate({});
        const onPageSizeChange = jest.fn();
        render(
            <DataTable
                {...props}
                showSearch={false}
                serverPagination={{
                    total: 400,
                    page: 1,
                    pageSize: 20,
                    onPageChange: jest.fn(),
                    onPageSizeChange,
                    sort: null,
                    onSortChange: jest.fn(),
                }}
            />,
        );
        await flush();
        expect(saveApi).not.toHaveBeenCalled();

        fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '100' } });
        await flush();

        expect(onPageSizeChange).toHaveBeenCalledWith(100);
        expect(saveApi).toHaveBeenCalledWith('tableColumns', { orders: { pageSize: 100 } });
    });

    it('resizing still writes widths to localStorage only', async () => {
        hydrate({ orders: { hidden: ['amount'] } });
        const { container } = render(<DataTable {...props} />);

        const grip = container.querySelector('.cursor-col-resize') as HTMLElement;
        fireEvent.mouseDown(grip, { clientX: 100 });
        fireEvent.mouseMove(document, { clientX: 160 });
        fireEvent.mouseUp(document, { clientX: 160 });
        await flush();

        expect(saveApi).not.toHaveBeenCalled();
        const widths = stored()?.orders;
        expect(widths?.columnWidths).toEqual({ name: expect.any(Number) });
        expect(widths).not.toHaveProperty('columnVisibility');
        expect(widths).not.toHaveProperty('columnOrder');
        expect(widths).not.toHaveProperty('pageSize');
    });

    it('re-seeds columns once when preferences become ready if the user has not changed them', async () => {
        // This browser's leftovers draw the list until the member's own columns arrive.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders: { columnVisibility: { name: false } } }));
        act(() => useTablePreferences.setState({ tables: stored() as never }));
        render(<DataTable {...props} />);
        expect(headers()).toEqual(['Amount']);
        expect(screen.getByTestId('page-size-select')).toHaveValue('10');

        hydrate({ orders: { hidden: ['amount'], pageSize: 20 } }, { source: 'profile' });

        expect(headers()).toEqual(['Name']);
        expect(screen.getByTestId('page-size-select')).toHaveValue('20');
        await flush();
        expect(saveApi).not.toHaveBeenCalled();
    });

    it('keeps a change the viewer made before preferences loaded', async () => {
        render(<DataTable {...props} />);
        hideColumn('Name');
        expect(headers()).toEqual(['Amount']);

        hydrate({ orders: { hidden: ['amount'], pageSize: 20 } }, { source: 'profile' });

        // Their columns stay as they left them; the page size they did not touch follows the profile.
        expect(headers()).toEqual(['Amount']);
        expect(screen.getByTestId('page-size-select')).toHaveValue('20');
    });

    it('a change after loading is not undone by a later refresh', async () => {
        hydrate({ orders: { pageSize: 20 } });
        render(<DataTable {...props} />);
        hideColumn('Amount');
        await flush();

        hydrate({ orders: { hidden: ['name'], pageSize: 20 } });

        expect(headers()).toEqual(['Name']);
    });
});
