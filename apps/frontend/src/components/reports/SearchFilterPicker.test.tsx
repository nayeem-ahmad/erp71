import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import SearchFilterPicker, { type FilterOption } from './SearchFilterPicker';

const COPY = {
    label: 'Customer',
    placeholder: 'All customers',
    searchLabel: 'Filter by customer',
    clear: 'Clear',
    searching: 'Searching…',
    noMatches: 'No matches',
};

const RAHIM: FilterOption = { id: 'c1', name: 'Rahim Uddin', detail: '01711000001' };
const KARIM: FilterOption = { id: 'c2', name: 'Karim Ahmed', detail: null };

function Harness({
    search,
    onSelect = () => {},
    initial = null,
    reopenOnClear,
}: {
    search: (term: string) => Promise<FilterOption[]>;
    onSelect?: (option: FilterOption | null) => void;
    initial?: FilterOption | null;
    reopenOnClear?: boolean;
}) {
    const [selected, setSelected] = useState<FilterOption | null>(initial);
    return (
        <SearchFilterPicker
            copy={COPY}
            selected={selected}
            search={search}
            reopenOnClear={reopenOnClear}
            onSelect={(option) => {
                setSelected(option);
                onSelect(option);
            }}
        />
    );
}

describe('SearchFilterPicker', () => {
    it('browses on focus with an empty term and picks a result by click', async () => {
        const search = jest.fn().mockResolvedValue([RAHIM, KARIM]);
        const onSelect = jest.fn();
        render(<Harness search={search} onSelect={onSelect} />);

        fireEvent.focus(screen.getByLabelText('Filter by customer'));
        await waitFor(() => expect(search).toHaveBeenCalledWith(''));

        fireEvent.click(await screen.findByText('Karim Ahmed'));

        expect(onSelect).toHaveBeenCalledWith(KARIM);
        // Picked: the box now names the choice and offers to let go of it.
        expect(screen.getByText('Karim Ahmed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument();
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('searches the trimmed term and picks the highlighted result with the keyboard', async () => {
        const search = jest.fn().mockResolvedValue([RAHIM, KARIM]);
        const onSelect = jest.fn();
        render(<Harness search={search} onSelect={onSelect} />);

        const input = screen.getByLabelText('Filter by customer');
        fireEvent.change(input, { target: { value: '  ah  ' } });
        await waitFor(() => expect(search).toHaveBeenLastCalledWith('ah'));
        await screen.findByText('Rahim Uddin');

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onSelect).toHaveBeenCalledWith(KARIM);
    });

    it('shows only the newest term’s results when an older search answers late', async () => {
        const pending = new Map<string, (rows: FilterOption[]) => void>();
        const search = jest.fn(
            (term: string) => new Promise<FilterOption[]>((resolve) => pending.set(term, resolve)),
        );
        render(<Harness search={search} />);

        const input = screen.getByLabelText('Filter by customer');
        fireEvent.change(input, { target: { value: 'r' } });
        await waitFor(() => expect(pending.has('r')).toBe(true));
        fireEvent.change(input, { target: { value: 'ra' } });
        await waitFor(() => expect(pending.has('ra')).toBe(true));

        await act(async () => pending.get('ra')!([RAHIM]));
        await act(async () => pending.get('r')!([KARIM]));

        expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
        expect(screen.queryByText('Karim Ahmed')).not.toBeInTheDocument();
    });

    it('says so when nothing matches', async () => {
        const search = jest.fn().mockResolvedValue([]);
        render(<Harness search={search} />);

        fireEvent.focus(screen.getByLabelText('Filter by customer'));

        expect(await screen.findByText('No matches')).toBeInTheDocument();
    });

    it('clears the pick and stays shut for an optional filter', async () => {
        const search = jest.fn().mockResolvedValue([RAHIM]);
        const onSelect = jest.fn();
        render(<Harness search={search} onSelect={onSelect} initial={RAHIM} />);

        expect(screen.getByText('01711000001')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Clear/ }));

        expect(onSelect).toHaveBeenCalledWith(null);
        expect(screen.getByLabelText('Filter by customer')).toHaveValue('');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('reopens the list after clearing when the report cannot run without a pick', async () => {
        const search = jest.fn().mockResolvedValue([KARIM]);
        render(<Harness search={search} initial={RAHIM} reopenOnClear />);

        fireEvent.click(screen.getByRole('button', { name: /Clear/ }));

        expect(await screen.findByText('Karim Ahmed')).toBeInTheDocument();
        expect(search).toHaveBeenCalledWith('');
    });
});
