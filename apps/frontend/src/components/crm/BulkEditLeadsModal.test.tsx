import { fireEvent, render, screen } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react.
import BulkEditLeadsModal from './BulkEditLeadsModal';

function renderModal(overrides: Partial<React.ComponentProps<typeof BulkEditLeadsModal>> = {}) {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(
        <BulkEditLeadsModal
            count={3}
            stages={[
                { value: 'st-new', label: 'New' },
                { value: 'st-neg', label: 'Negotiation' },
            ]}
            members={[{ id: 'user-1', label: 'Nayeem' }]}
            categories={[{ id: 'cat-1', name: 'Wholesale' }]}
            sources={[{ id: 'src-1', name: 'Walk-in' }]}
            customFields={[{ key: 'area', label: 'Area' }]}
            busy={false}
            onSubmit={onSubmit}
            onClose={onClose}
            {...overrides}
        />,
    );
    return { onSubmit, onClose };
}

const fieldSelect = () => screen.getByLabelText('Field') as HTMLSelectElement;
const valueControl = () => screen.getByLabelText('New value') as HTMLSelectElement | HTMLInputElement;
const applyButton = () => screen.getByRole('button', { name: 'Apply to 3 lead(s)' });

describe('BulkEditLeadsModal', () => {
    it('asks for a field first, and cannot apply until a value is chosen', () => {
        renderModal();

        expect(screen.getByText('Edit 3 lead(s)')).toBeInTheDocument();
        expect(screen.queryByLabelText('New value')).not.toBeInTheDocument();
        expect(applyButton()).toBeDisabled();

        fireEvent.change(fieldSelect(), { target: { value: 'priority' } });
        expect(applyButton()).toBeDisabled();

        fireEvent.change(valueControl(), { target: { value: 'URGENT' } });
        expect(applyButton()).toBeEnabled();
    });

    it('sets the priority', () => {
        const { onSubmit } = renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'priority' } });
        fireEvent.change(valueControl(), { target: { value: 'HIGH' } });
        fireEvent.click(applyButton());

        expect(onSubmit).toHaveBeenCalledWith({ priority: 'HIGH' });
    });

    it('moves leads to one of the stages it was given', () => {
        const { onSubmit } = renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'status' } });
        const options = Array.from((valueControl() as HTMLSelectElement).options).map((o) => o.value);
        expect(options).toEqual(['', 'st-new', 'st-neg']);

        fireEvent.change(valueControl(), { target: { value: 'st-neg' } });
        fireEvent.click(applyButton());

        expect(onSubmit).toHaveBeenCalledWith({ status_id: 'st-neg' });
    });

    it('unassigns the owner with an explicit null', () => {
        const { onSubmit } = renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'owner' } });
        fireEvent.change(valueControl(), { target: { value: '__none__' } });
        fireEvent.click(applyButton());

        expect(onSubmit).toHaveBeenCalledWith({ assigned_to: null });
    });

    it('assigns an owner', () => {
        const { onSubmit } = renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'owner' } });
        fireEvent.change(valueControl(), { target: { value: 'user-1' } });
        fireEvent.click(applyButton());

        expect(onSubmit).toHaveBeenCalledWith({ assigned_to: 'user-1' });
    });

    it('clears the category with an empty value', () => {
        const { onSubmit } = renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'category' } });
        fireEvent.change(valueControl(), { target: { value: '__none__' } });
        fireEvent.click(applyButton());

        expect(onSubmit).toHaveBeenCalledWith({ category: '' });
    });

    it('sets the source', () => {
        const { onSubmit } = renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'source' } });
        fireEvent.change(valueControl(), { target: { value: 'src-1' } });
        fireEvent.click(applyButton());

        expect(onSubmit).toHaveBeenCalledWith({ source: 'src-1' });
    });

    it('sets a custom field, and an empty one clears it', () => {
        const { onSubmit } = renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'cf:area' } });
        // Typing nothing is a real choice here: it clears the field.
        expect(applyButton()).toBeEnabled();
        fireEvent.click(applyButton());
        expect(onSubmit).toHaveBeenLastCalledWith({ custom_fields: { area: '' } });

        fireEvent.change(valueControl(), { target: { value: '  Mirpur ' } });
        fireEvent.click(applyButton());
        expect(onSubmit).toHaveBeenLastCalledWith({ custom_fields: { area: 'Mirpur' } });
    });

    it('starts the value over when another field is picked', () => {
        renderModal();

        fireEvent.change(fieldSelect(), { target: { value: 'priority' } });
        fireEvent.change(valueControl(), { target: { value: 'HIGH' } });
        fireEvent.change(fieldSelect(), { target: { value: 'source' } });

        expect(valueControl().value).toBe('');
        expect(applyButton()).toBeDisabled();
    });

    it('offers no custom-field group when the tenant has none', () => {
        renderModal({ customFields: [] });

        expect(screen.queryByRole('group', { name: 'Custom fields' })).not.toBeInTheDocument();
    });

    it('cannot be applied or closed while the change is being sent', () => {
        const { onClose } = renderModal({ busy: true });

        expect(fieldSelect()).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).not.toHaveBeenCalled();
    });
});
