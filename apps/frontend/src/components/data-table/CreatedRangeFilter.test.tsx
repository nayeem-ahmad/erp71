jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
    };
});

import { fireEvent, render, screen } from '@testing-library/react';
import CreatedRangeFilter from './CreatedRangeFilter';
import { createdRangeFromPreset } from '@/lib/created-range';

describe('CreatedRangeFilter', () => {
    it('shows Any time until a range is chosen', () => {
        render(<CreatedRangeFilter value={null} onChange={() => undefined} />);
        expect(screen.getByRole('button', { name: /created · any time/i })).toBeInTheDocument();
    });

    it('applies Today immediately and reports the Dhaka calendar day', () => {
        const onChange = jest.fn();
        render(<CreatedRangeFilter value={null} onChange={onChange} now={new Date('2026-08-19T04:00:00.000Z')} />);

        fireEvent.click(screen.getByRole('button', { name: /created · any time/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Today' }));

        expect(onChange).toHaveBeenCalledWith(createdRangeFromPreset('today', new Date('2026-08-19T04:00:00.000Z')));
    });

    it('applies a custom from/to pair on Apply', () => {
        const onChange = jest.fn();
        render(<CreatedRangeFilter value={null} onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: /created · any time/i }));
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-12' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-19' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        expect(onChange).toHaveBeenCalledWith({ from: '2026-08-12', to: '2026-08-19' });
    });

    it('clears back to an unfiltered list', () => {
        const onChange = jest.fn();
        render(
            <CreatedRangeFilter
                value={{ from: '2026-08-12', to: '2026-08-19' }}
                onChange={onChange}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /created · 12 aug/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

        expect(onChange).toHaveBeenCalledWith(null);
    });
});
