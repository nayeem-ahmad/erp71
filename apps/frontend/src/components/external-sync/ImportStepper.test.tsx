import { fireEvent, render, screen } from '@testing-library/react';
import { ImportStepper } from './ImportStepper';
import type { ImportWizardContext } from '@/lib/import-wizard';

const connected: ImportWizardContext = {
    hasConnection: true,
    hasReadySnapshot: true,
    matchesConfirmed: false,
};

describe('ImportStepper', () => {
    it('marks the current step and lets completed steps be opened', () => {
        const onSelect = jest.fn();
        render(<ImportStepper current="mapping" context={connected} onSelect={onSelect} />);

        expect(screen.getByRole('tab', { name: /mapping decisions/i })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: /connection/i }));
        expect(onSelect).toHaveBeenCalledWith('connection');
        fireEvent.click(screen.getByRole('tab', { name: /extract \/ upload/i }));
        expect(onSelect).toHaveBeenCalledWith('extract');
    });

    it('blocks Import until matches are confirmed', () => {
        const onSelect = jest.fn();
        render(<ImportStepper current="mapping" context={connected} onSelect={onSelect} />);

        expect(screen.getByRole('tab', { name: /4 import/i })).toBeDisabled();
        fireEvent.click(screen.getByRole('tab', { name: /4 import/i }));
        expect(onSelect).not.toHaveBeenCalled();
    });
});
