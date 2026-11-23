import { fireEvent, render, screen } from '@testing-library/react';
import UnitConverterPage from './page';

describe('UnitConverterPage', () => {
    it('shows one maund in kg, and a maund price per kg', () => {
        render(<UnitConverterPage />);
        expect(screen.getByText('কেজি · Kilogram', { selector: 'span' }).nextSibling).toHaveTextContent('37.3248');
        fireEvent.click(screen.getByLabelText('Convert a price instead'));
        fireEvent.change(screen.getByLabelText('Price (Tk) per'), { target: { value: '2400' } });
        expect(screen.getByText('Price per কেজি · Kilogram').nextSibling).toHaveTextContent('64.30');
    });

    it('converts gold: one vori is 16 ana', () => {
        render(<UnitConverterPage />);
        fireEvent.click(screen.getByRole('tab', { name: 'Gold & silver' }));
        expect(screen.getByText('আনা · Ana', { selector: 'span' }).nextSibling).toHaveTextContent('16');
    });
});
