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

    /**
     * Activities carry both a created date and a due date, so the chip has to say
     * which one it is filtering — two identical "Created ·" buttons would be a trap.
     */
    it('names the filtered field in the chip when given a label', () => {
        render(<CreatedRangeFilter value={null} label="Due" onChange={() => undefined} />);
        expect(screen.getByRole('button', { name: /due · any time/i })).toBeInTheDocument();
    });

    it('labels its popover with the same field name', () => {
        render(<CreatedRangeFilter value={null} label="Due" onChange={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: /due · any time/i }));
        expect(screen.getByRole('dialog', { name: 'Due' })).toBeInTheDocument();
    });

    it('still says Created when no label is given', () => {
        render(<CreatedRangeFilter value={null} onChange={() => undefined} />);
        expect(screen.getByRole('button', { name: /created · any time/i })).toBeInTheDocument();
    });

    describe('with times', () => {
        const open = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

        it('has no time inputs unless asked', () => {
            render(<CreatedRangeFilter value={null} onChange={() => undefined} />);
            open(/created · any time/i);
            expect(screen.queryByLabelText('From (Time)')).not.toBeInTheDocument();
        });

        it('keeps a time disabled until its date is set, then applies both', () => {
            const onChange = jest.fn();
            render(<CreatedRangeFilter value={null} label="Date" withTime onChange={onChange} />);
            open(/date · any time/i);

            expect(screen.getByLabelText('From (Time)')).toBeDisabled();
            fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-12' } });
            fireEvent.change(screen.getByLabelText('From (Time)'), { target: { value: '18:00' } });
            fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-13' } });
            fireEvent.change(screen.getByLabelText('To (Time)'), { target: { value: '02:00' } });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

            expect(onChange).toHaveBeenCalledWith({ from: '2026-10-12T18:00', to: '2026-10-13T02:00' });
        });

        it('drops a time whose date was cleared', () => {
            const onChange = jest.fn();
            render(<CreatedRangeFilter value={null} label="Date" withTime onChange={onChange} />);
            open(/date · any time/i);

            fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-12' } });
            fireEvent.change(screen.getByLabelText('From (Time)'), { target: { value: '18:00' } });
            fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
            fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-13' } });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

            expect(onChange).toHaveBeenCalledWith({ from: undefined, to: '2026-10-13' });
        });

        it('refuses a From after To inline and stays open', () => {
            const onChange = jest.fn();
            render(<CreatedRangeFilter value={null} label="Date" withTime onChange={onChange} />);
            open(/date · any time/i);

            fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-12' } });
            fireEvent.change(screen.getByLabelText('From (Time)'), { target: { value: '18:00' } });
            fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-12' } });
            fireEvent.change(screen.getByLabelText('To (Time)'), { target: { value: '02:00' } });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

            expect(onChange).not.toHaveBeenCalled();
            expect(screen.getByText('From must be on or before To')).toBeInTheDocument();
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        it('refuses a From day after the To day even without times', () => {
            const onChange = jest.fn();
            render(<CreatedRangeFilter value={null} onChange={onChange} />);
            open(/created · any time/i);

            fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-13' } });
            fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-12' } });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

            expect(onChange).not.toHaveBeenCalled();
            expect(screen.getByText('From must be on or before To')).toBeInTheDocument();
        });

        it('shows the chosen times on the chip and seeds the inputs from them', () => {
            render(
                <CreatedRangeFilter
                    value={{ from: '2026-10-12T18:00', to: '2026-10-13T02:00' }}
                    label="Date"
                    withTime
                    onChange={() => undefined}
                />,
            );
            open(/^date · 12 oct 18:00 – 13 oct 02:00$/i);

            expect(screen.getByLabelText('From')).toHaveValue('2026-10-12');
            expect(screen.getByLabelText('From (Time)')).toHaveValue('18:00');
            expect(screen.getByLabelText('To (Time)')).toHaveValue('02:00');
        });
    });

    it('is exported as DateRangeFilter too', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        expect(require('./index').DateRangeFilter).toBe(CreatedRangeFilter);
    });
});
