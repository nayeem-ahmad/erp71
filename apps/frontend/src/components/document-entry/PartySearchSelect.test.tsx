import { fireEvent, render, screen, within } from '@testing-library/react';
import PartySearchSelect, { PartySummaryCard } from './PartySearchSelect';

const ANWAR = {
    id: 'cust-1',
    name: 'Anwar Chowdhury',
    phone: '01700100057',
    address: 'Mirpur 10, Dhaka',
};

describe('PartySearchSelect', () => {
    it('keeps the result list out of the form, where nothing can clip it', () => {
        render(
            <form data-testid="entry-form">
                <PartySearchSelect
                    parties={[ANWAR]}
                    selected={null}
                    onSelect={jest.fn()}
                    label="Customer"
                    placeholder="Search by name or phone…"
                />
                <div>Line items table</div>
            </form>,
        );

        fireEvent.focus(screen.getByLabelText('Customer'));

        const option = screen.getByText('Anwar Chowdhury');
        expect(screen.getByTestId('entry-form')).not.toContainElement(option);
        expect(document.body).toContainElement(option);
    });
});

describe('PartySummaryCard', () => {
    it('captions every figure and drops the ones with nothing to show', () => {
        render(
            <PartySummaryCard
                name="Anwar Chowdhury"
                details={[
                    { label: 'Phone', value: '01700100057' },
                    { label: 'Due', value: '৳ 1,590.00', tone: 'warning' },
                    null,
                    { label: 'Credit Limit', value: '৳ 50,000.00' },
                ]}
            />,
        );

        expect(screen.getByText('Anwar Chowdhury')).toBeInTheDocument();

        for (const [label, value] of [
            ['Phone', '01700100057'],
            ['Due', '৳ 1,590.00'],
            ['Credit Limit', '৳ 50,000.00'],
        ]) {
            const caption = screen.getByText(label);
            expect(caption.tagName).toBe('DT');
            // Caption and figure are one pair, so neither can be read as a
            // stray number the way the old dot-separated line allowed.
            expect(within(caption.parentElement!).getByText(value).tagName).toBe('DD');
        }

        expect(screen.getByText('৳ 1,590.00')).toHaveClass('text-amber-700');
        expect(screen.queryAllByRole('definition')).toHaveLength(3);
    });
});
