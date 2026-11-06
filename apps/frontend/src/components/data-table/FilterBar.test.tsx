'use client';

import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FilterBar, { isFilterActive, type ResolvedListFilter } from './FilterBar';
import type { NumberCondition } from '@/lib/number-condition';

const STATUS_OPTIONS = [
    { value: 'OPEN', label: 'Open' },
    { value: 'CLOSED', label: 'Closed' },
    { value: 'VOID', label: 'Void' },
];

/** A row's worth of filters, holding their own values like a page would. */
function Harness({ layout = 'row', compact = false, extra = [] }: { layout?: 'wrap' | 'row'; compact?: boolean; extra?: ResolvedListFilter[] }) {
    const [status, setStatus] = useState<string[]>([]);
    const [exclude, setExclude] = useState(false);
    const [amount, setAmount] = useState<NumberCondition | null>(null);
    const [paid, setPaid] = useState<NumberCondition | null>(null);
    const filters: ResolvedListFilter[] = [
        {
            id: 'status',
            type: 'multi-select',
            label: 'Status',
            options: STATUS_OPTIONS,
            value: status,
            onChange: setStatus,
            exclude: { value: exclude, onChange: setExclude },
        },
        { id: 'amount', type: 'number', label: 'Amount', value: amount, onChange: setAmount, money: true },
        ...extra,
        { id: 'paid', type: 'number', label: 'Paid', value: paid, onChange: setPaid, more: true },
    ];
    return <FilterBar filters={filters} compact={compact} layout={layout} />;
}

const chip = (name: string | RegExp) => screen.getByRole('button', { name });

describe('FilterBar — multi-select', () => {
    it('ticks several values, the chip naming the first and counting the rest', () => {
        render(<Harness />);
        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Open' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Void' }));
        expect(chip(/Status: Open \+1/)).toBeInTheDocument();
    });

    it('turns round to "is none of"', () => {
        render(<Harness />);
        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Closed' }));
        fireEvent.click(screen.getByRole('button', { name: 'is none of' }));
        expect(chip(/Status: not Closed/)).toBeInTheDocument();
    });

    it('selects all and clears from the panel footer', () => {
        render(<Harness />);
        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
        expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(screen.getAllByRole('checkbox').some((box) => (box as HTMLInputElement).checked)).toBe(false);
    });

    it('removes the filter from its chip, exclusion included', () => {
        render(<Harness />);
        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Open' }));
        fireEvent.click(screen.getByRole('button', { name: 'is none of' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove filter Status' }));
        expect(chip('Status')).toBeInTheDocument();
        fireEvent.click(chip('Status'));
        expect(screen.getByRole('button', { name: 'is any of' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('asks the server for options as the box is typed in, and keeps the label it found', async () => {
        jest.useFakeTimers();
        const loadOptions = jest.fn().mockResolvedValue([{ value: 'c-7', label: 'Karim Store' }]);
        function Async() {
            const [value, setValue] = useState<string[]>([]);
            return (
                <FilterBar
                    compact={false}
                    layout="row"
                    filters={[{ id: 'customer-test', type: 'multi-select', label: 'Customer', options: [], value, onChange: setValue, loadOptions }]}
                />
            );
        }
        try {
            render(<Async />);
            fireEvent.click(chip('Customer'));
            fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'kar' } });
            expect(loadOptions).not.toHaveBeenCalled();
            await act(async () => {
                jest.advanceTimersByTime(300);
            });
            expect(loadOptions).toHaveBeenCalledWith('kar');
            fireEvent.click(await screen.findByRole('checkbox', { name: 'Karim Store' }));
            expect(chip(/Customer: Karim Store/)).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('FilterBar — amounts', () => {
    it('applies a between on Apply and shows it as money', () => {
        render(<Harness />);
        fireEvent.click(chip('Amount'));
        fireEvent.change(screen.getByRole('textbox', { name: 'Amount (Min)' }), { target: { value: '5000' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Amount (Max)' }), { target: { value: '1000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        // Typed the wrong way round, kept in order.
        expect(chip(/Amount: ৳\s?1,000 – ৳\s?5,000/)).toBeInTheDocument();
    });

    it('applies on Enter', () => {
        render(<Harness />);
        fireEvent.click(chip('Amount'));
        fireEvent.change(screen.getByRole('combobox', { name: 'Amount' }), { target: { value: 'lt' } });
        const box = screen.getByRole('textbox', { name: 'Amount (Amount)' });
        fireEvent.change(box, { target: { value: '250' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(chip(/Amount: < ৳\s?250/)).toBeInTheDocument();
    });

    it('refuses text that is not a number', () => {
        render(<Harness />);
        fireEvent.click(chip('Amount'));
        fireEvent.change(screen.getByRole('textbox', { name: 'Amount (Min)' }), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount');
        expect(chip('Amount')).toBeInTheDocument();
    });
});

describe('FilterBar — one row with More', () => {
    it('keeps `more` filters behind More, counting the ones in use', () => {
        render(<Harness />);
        expect(screen.queryByRole('button', { name: /^Paid/ })).not.toBeInTheDocument();
        fireEvent.click(chip('More'));
        const more = screen.getByRole('dialog', { name: 'More' });
        fireEvent.click(within(more).getByRole('button', { name: /^Paid/ }));
        fireEvent.change(within(more).getByRole('textbox', { name: 'Paid (Min)' }), { target: { value: '1' } });
        fireEvent.change(within(more).getByRole('textbox', { name: 'Paid (Max)' }), { target: { value: '9' } });
        fireEvent.click(within(more).getByRole('button', { name: 'Apply' }));
        // Still open, showing the value beside the filter's name.
        expect(within(screen.getByRole('dialog', { name: 'More' })).getByText('1 – 9')).toBeInTheDocument();
        expect(chip(/^More/)).toHaveTextContent('1');
    });

    it('moves chips into More from the end, idle ones first, when the row runs out of room', async () => {
        // Each chip is 100px wide and the row holds 250px.
        const scrollWidth = jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
            return this.children.length * 100;
        });
        const clientWidth = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(250);
        const extra: ResolvedListFilter[] = [
            { id: 'flag', type: 'toggle', label: 'Flagged', pressed: true, onChange: jest.fn() },
            { id: 'kind', type: 'select', label: 'Kind', options: [{ value: 'a', label: 'A' }], value: null, onChange: jest.fn() },
        ];
        try {
            render(<Harness extra={extra} />);
            // Status, Amount, Flagged (on), Kind: two must go — Kind, then Amount,
            // while the pressed Flagged keeps its place.
            await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Kind' })).not.toBeInTheDocument());
            expect(screen.queryByRole('button', { name: 'Amount' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Flagged' })).toBeInTheDocument();
            expect(chip('Status')).toBeInTheDocument();

            fireEvent.click(chip('More'));
            const more = screen.getByRole('dialog', { name: 'More' });
            const names = within(more).getAllByRole('button', { expanded: false }).map((b) => b.textContent);
            expect(names[0]).toMatch(/^Amount/);
            expect(names[1]).toMatch(/^Kind/);
            expect(names[2]).toMatch(/^Paid/);
        } finally {
            scrollWidth.mockRestore();
            clientWidth.mockRestore();
        }
    });

    it('clears every filter, the ones behind More included', () => {
        render(<Harness />);
        fireEvent.click(chip('Status'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Open' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        expect(chip('Status')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
    });
});

describe('FilterBar — phone sheet', () => {
    it('opens a multi-select and an amount in place inside the sheet', () => {
        render(<Harness compact />);
        fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Status/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Open' }));
        expect(screen.getByText('Status: Open')).toBeInTheDocument();
    });
});

const ACCOUNT_OPTIONS = [
    { value: 'cash', label: '1010 — Cash in Hand' },
    { value: 'bank', label: '1020 — City Bank' },
    { value: 'sales', label: '4010 — Sales Revenue' },
];

/** A searchable one-pick select and a one-day chip, held like a page holds them. */
function PickHarness({ compact = false, required = false, more = false }: { compact?: boolean; required?: boolean; more?: boolean }) {
    const [account, setAccount] = useState<string | null>(null);
    const [asOf, setAsOf] = useState<string | null>(required ? '2026-03-31' : null);
    const filters: ResolvedListFilter[] = [
        { id: 'account', type: 'select', label: 'Account', options: ACCOUNT_OPTIONS, value: account, onChange: setAccount, searchable: true },
        {
            id: 'asOf',
            type: 'date',
            label: 'As of',
            value: asOf,
            // A report that must have a day goes back to its default.
            onChange: (next) => setAsOf(next ?? (required ? '2026-03-31' : null)),
            more,
            ...(required ? { required: true, defaultValue: '2026-03-31' } : {}),
        },
    ];
    return <FilterBar filters={filters} compact={compact} layout="row" />;
}

describe('FilterBar — searchable select', () => {
    it('searches the options and picks one, closing on the pick', () => {
        render(<PickHarness />);
        fireEvent.click(chip('Account'));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search Account…' }), { target: { value: 'bank' } });
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['1020 — City Bank']);
        fireEvent.click(screen.getByRole('option', { name: '1020 — City Bank' }));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(chip(/Account: 1020 — City Bank/)).toBeInTheDocument();
    });

    it('marks the pick, moves it on another pick, and clears from the panel', () => {
        render(<PickHarness />);
        fireEvent.click(chip('Account'));
        fireEvent.click(screen.getByRole('option', { name: '1010 — Cash in Hand' }));
        fireEvent.click(chip(/Account: 1010/));
        expect(screen.getByRole('option', { name: '1010 — Cash in Hand' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('option', { name: '4010 — Sales Revenue' }));
        expect(chip(/Account: 4010 — Sales Revenue/)).toBeInTheDocument();
        fireEvent.click(chip(/Account: 4010/));
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(chip('Account')).toBeInTheDocument();
    });

    it('asks the server as the box is typed in, and names the pick it found', async () => {
        jest.useFakeTimers();
        const loadOptions = jest.fn().mockResolvedValue([{ value: 'acc-9', label: '2050 — Loan Payable' }]);
        function Remote() {
            const [value, setValue] = useState<string | null>(null);
            return (
                <FilterBar
                    compact={false}
                    layout="row"
                    filters={[{ id: 'account-remote', type: 'select', label: 'Account', options: [], value, onChange: setValue, loadOptions }]}
                />
            );
        }
        try {
            render(<Remote />);
            fireEvent.click(chip('Account'));
            fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'loan' } });
            await act(async () => {
                jest.advanceTimersByTime(300);
            });
            expect(loadOptions).toHaveBeenCalledWith('loan');
            fireEvent.click(await screen.findByRole('option', { name: '2050 — Loan Payable' }));
            expect(chip(/Account: 2050 — Loan Payable/)).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('keeps a plain select without `searchable` a native select', () => {
        render(<FilterBar compact={false} layout="row" filters={[{ id: 'k', type: 'select', label: 'Kind', options: ACCOUNT_OPTIONS, value: null, onChange: jest.fn() }]} />);
        expect(screen.getByRole('combobox', { name: 'Kind' })).toBeInTheDocument();
    });
});

describe('FilterBar — one-day date', () => {
    const now = new Date();

    it('sets the day from a shortcut and names it on the chip', () => {
        render(<PickHarness />);
        fireEvent.click(chip('As of'));
        fireEvent.click(screen.getByRole('button', { name: 'End of last year' }));
        expect(screen.queryByRole('dialog', { name: 'As of' })).not.toBeInTheDocument();
        expect(chip(new RegExp(`^As of: 31 Dec ${now.getFullYear() - 1}`))).toBeInTheDocument();
    });

    it('applies a typed day, and asks for one before applying nothing', () => {
        render(<PickHarness />);
        fireEvent.click(chip('As of'));
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(screen.getByText('Pick a date')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('As of', { selector: 'input' }), { target: { value: '2025-06-30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(chip(/^As of: 30 Jun 2025/)).toBeInTheDocument();
    });

    it('clears from its chip', () => {
        render(<PickHarness />);
        fireEvent.click(chip('As of'));
        fireEvent.click(screen.getByRole('button', { name: 'End of last month' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove filter As of' }));
        expect(chip('As of')).toBeInTheDocument();
    });

    it('names a required day at its default, with no ✕, no Clear and no Clear all', () => {
        render(<PickHarness required />);
        expect(chip(/^As of: 31 Mar/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove filter As of' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
        fireEvent.click(chip(/^As of/));
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    });

    it('counts a required day moved off its default, and Clear all puts it back', () => {
        render(<PickHarness required />);
        fireEvent.click(chip(/^As of/));
        fireEvent.click(screen.getByRole('button', { name: 'End of last year' }));
        expect(chip(/^As of: 31 Dec/)).toBeInTheDocument();
        // Still no ✕ — a required day is not removed, only moved.
        expect(screen.queryByRole('button', { name: 'Remove filter As of' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        expect(chip(/^As of: 31 Mar/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
    });

    it('leaves a required day alone when Clear all clears the others', () => {
        render(<PickHarness required />);
        fireEvent.click(chip('Account'));
        fireEvent.click(screen.getByRole('option', { name: '1020 — City Bank' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        expect(chip('Account')).toBeInTheDocument();
        expect(chip(/^As of: 31 Mar/)).toBeInTheDocument();
    });

    it('opens in place behind More', () => {
        render(<PickHarness more />);
        expect(screen.queryByRole('button', { name: /^As of/ })).not.toBeInTheDocument();
        fireEvent.click(chip('More'));
        const more = screen.getByRole('dialog', { name: 'More' });
        fireEvent.click(within(more).getByRole('button', { name: /^As of/ }));
        fireEvent.click(within(more).getByRole('button', { name: 'End of last year' }));
        expect(within(more).getByText(new RegExp(`31 Dec ${now.getFullYear() - 1}`))).toBeInTheDocument();
    });
});

describe('FilterBar — phone sheet, picks and days', () => {
    it('opens a searchable select and a date in place inside the sheet, and lists them as removable chips', () => {
        render(<PickHarness compact />);
        fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
        const sheet = () => screen.getByRole('heading', { name: 'Filters' }).parentElement as HTMLElement;
        fireEvent.click(within(sheet()).getByRole('button', { name: /^Account/ }));
        fireEvent.click(within(sheet()).getByRole('option', { name: '1020 — City Bank' }));
        fireEvent.click(within(sheet()).getByRole('button', { name: /^As of/ }));
        fireEvent.change(within(sheet()).getByLabelText('As of', { selector: 'input' }), { target: { value: '2025-12-31' } });
        fireEvent.click(within(sheet()).getByRole('button', { name: 'Apply' }));
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(screen.getByText('Account: 1020 — City Bank')).toBeInTheDocument();
        expect(screen.getByText('As of: 31 Dec 2025')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove filter As of' }));
        expect(screen.queryByText(/As of: /)).not.toBeInTheDocument();
    });
});

describe('FilterBar — required selects', () => {
    const YEARS = [
        { value: '2025', label: '2025' },
        { value: '2026', label: '2026' },
    ];

    function YearHarness({ compact = false, withDefault = true }: { compact?: boolean; withDefault?: boolean }) {
        const [year, setYear] = useState('2026');
        const [account, setAccount] = useState<string | null>('cash');
        const filters: ResolvedListFilter[] = [
            {
                id: 'year',
                type: 'select',
                label: 'Fiscal year',
                options: YEARS,
                value: year,
                onChange: (next) => setYear(next ?? '2026'),
                required: true,
                ...(withDefault ? { defaultValue: '2026' } : {}),
            },
            {
                id: 'account',
                type: 'select',
                label: 'Account',
                options: ACCOUNT_OPTIONS,
                value: account,
                onChange: (next) => setAccount(next ?? 'cash'),
                searchable: true,
                required: true,
                defaultValue: 'cash',
            },
        ];
        return <FilterBar filters={filters} compact={compact} layout="row" />;
    }

    it('offers no "All" in a required native select', () => {
        render(<YearHarness />);
        const select = screen.getByRole('combobox', { name: 'Fiscal year' });
        expect(within(select).queryByRole('option', { name: 'All' })).not.toBeInTheDocument();
        expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['2025', '2026']);
    });

    it('still offers "All" in a select that is not required', () => {
        render(<FilterBar compact={false} layout="row" filters={[{ id: 'k', type: 'select', label: 'Kind', options: YEARS, value: null, onChange: jest.fn() }]} />);
        expect(within(screen.getByRole('combobox', { name: 'Kind' })).getByRole('option', { name: 'All' })).toBeInTheDocument();
    });

    it('is not on at its default; moved, Clear all resets it', () => {
        render(<YearHarness />);
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Fiscal year' }), { target: { value: '2025' } });
        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue('2026');
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
    });

    it('is never on without a default to go back to', () => {
        render(<YearHarness withDefault={false} />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Fiscal year' }), { target: { value: '2025' } });
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
    });

    it('names a required searchable pick without ✕, and its panel has no Clear', () => {
        render(<YearHarness />);
        expect(chip(/^Account: 1010 — Cash in Hand/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove filter Account' })).not.toBeInTheDocument();
        fireEvent.click(chip(/^Account/));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });

    it('lists required filters under the phone toolbar without ✕, and counts only those moved', () => {
        render(<YearHarness compact />);
        expect(screen.getByText('Fiscal year: 2026')).toBeInTheDocument();
        expect(screen.getByText('Account: 1010 — Cash in Hand')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Remove filter/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Fiscal year' }), { target: { value: '2025' } });
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.getByRole('button', { name: 'Filters 1' })).toBeInTheDocument();
        expect(screen.getByText('Fiscal year: 2025')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Remove filter/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        expect(screen.getByText('Fiscal year: 2026')).toBeInTheDocument();
    });
});

describe('FilterBar — required period', () => {
    it('offers no Clear in a required period, and Clear all goes back to its default', () => {
        const fallback = { from: '2026-11-01', to: '2026-11-06' };
        function PeriodHarness() {
            const [period, setPeriod] = useState<{ from?: string; to?: string }>(fallback);
            return (
                <FilterBar
                    compact={false}
                    layout="row"
                    filters={[{
                        id: 'period',
                        type: 'date-range',
                        label: 'Period',
                        value: period,
                        onChange: (next) => setPeriod(next ?? fallback),
                        required: true,
                        defaultValue: fallback,
                    }]}
                />
            );
        }
        render(<PeriodHarness />);
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove filter Period' })).not.toBeInTheDocument();
        fireEvent.click(chip(/^Period/));
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
        expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument();
        fireEvent.click(chip(/^Period/));
        expect(screen.getByLabelText('From')).toHaveValue('2026-11-01');
    });
});

describe('isFilterActive', () => {
    it('reads a required filter as on only once it leaves its default', () => {
        const base = { id: 'y', type: 'select' as const, label: 'Y', options: [], onChange: jest.fn(), required: true };
        expect(isFilterActive({ ...base, value: '2026' })).toBe(false);
        expect(isFilterActive({ ...base, value: '2026', defaultValue: '2026' })).toBe(false);
        expect(isFilterActive({ ...base, value: '2025', defaultValue: '2026' })).toBe(true);
        const day = { id: 'd', type: 'date' as const, label: 'D', onChange: jest.fn(), required: true, defaultValue: '2026-11-06' };
        expect(isFilterActive({ ...day, value: '2026-11-06' })).toBe(false);
        expect(isFilterActive({ ...day, value: '2026-10-31' })).toBe(true);
        const range = { id: 'r', type: 'date-range' as const, onChange: jest.fn(), required: true, defaultValue: { from: '2026-11-01', to: '2026-11-06' } };
        expect(isFilterActive({ ...range, value: { from: '2026-11-01', to: '2026-11-06' } })).toBe(false);
        expect(isFilterActive({ ...range, value: { from: '2026-01-01', to: '2026-11-06' } })).toBe(true);
        const branches = { id: 'b', type: 'multi-select' as const, label: 'B', options: [], onChange: jest.fn(), required: true, defaultValue: ['a', 'b'] };
        expect(isFilterActive({ ...branches, value: ['b', 'a'] })).toBe(false);
        expect(isFilterActive({ ...branches, value: ['a'] })).toBe(true);
    });

    it('reads each new type', () => {
        expect(isFilterActive({ id: 'a', type: 'multi-select', label: 'A', options: [], value: [], onChange: jest.fn() })).toBe(false);
        expect(isFilterActive({ id: 'a', type: 'multi-select', label: 'A', options: [], value: ['x'], onChange: jest.fn() })).toBe(true);
        expect(isFilterActive({ id: 'b', type: 'number', label: 'B', value: null, onChange: jest.fn() })).toBe(false);
        expect(isFilterActive({ id: 'b', type: 'number', label: 'B', value: { op: 'eq', value: 0 }, onChange: jest.fn() })).toBe(true);
        expect(isFilterActive({ id: 'c', type: 'date', label: 'C', value: null, onChange: jest.fn() })).toBe(false);
        expect(isFilterActive({ id: 'c', type: 'date', label: 'C', value: '2026-03-31', onChange: jest.fn() })).toBe(true);
        expect(isFilterActive({ id: 'd', type: 'select', label: 'D', options: [], value: null, onChange: jest.fn(), searchable: true })).toBe(false);
        expect(isFilterActive({ id: 'd', type: 'select', label: 'D', options: [], value: 'x', onChange: jest.fn(), searchable: true })).toBe(true);
    });
});
