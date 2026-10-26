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

describe('isFilterActive', () => {
    it('reads each new type', () => {
        expect(isFilterActive({ id: 'a', type: 'multi-select', label: 'A', options: [], value: [], onChange: jest.fn() })).toBe(false);
        expect(isFilterActive({ id: 'a', type: 'multi-select', label: 'A', options: [], value: ['x'], onChange: jest.fn() })).toBe(true);
        expect(isFilterActive({ id: 'b', type: 'number', label: 'B', value: null, onChange: jest.fn() })).toBe(false);
        expect(isFilterActive({ id: 'b', type: 'number', label: 'B', value: { op: 'eq', value: 0 }, onChange: jest.fn() })).toBe(true);
    });
});
