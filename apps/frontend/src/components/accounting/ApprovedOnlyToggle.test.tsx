import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovedOnlyToggle } from './ApprovedOnlyToggle';

describe('ApprovedOnlyToggle', () => {
    it('renders nothing when the tenant does not require approval', () => {
        // Every voucher is already APPROVED, so the control could only be a no-op.
        const { container } = render(
            <ApprovedOnlyToggle checked={false} onChange={jest.fn()} enabled={false} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('reports both directions of the flip', () => {
        const onChange = jest.fn();
        const { rerender } = render(
            <ApprovedOnlyToggle checked={false} onChange={onChange} enabled />,
        );

        fireEvent.click(screen.getByLabelText('Approved vouchers only'));
        expect(onChange).toHaveBeenLastCalledWith(true);

        rerender(<ApprovedOnlyToggle checked onChange={onChange} enabled />);
        fireEvent.click(screen.getByLabelText('Approved vouchers only'));
        expect(onChange).toHaveBeenLastCalledWith(false);
    });
});
