import { render, screen } from '@testing-library/react';
import { Field } from './Field';

describe('Field', () => {
    it('renders the label and children', () => {
        render(
            <Field label="Name" htmlFor="name">
                <input id="name" />
            </Field>,
        );
        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('shows a required marker when required is set', () => {
        render(
            <Field label="Name" required htmlFor="name">
                <input id="name" />
            </Field>,
        );
        expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('does not show a required marker by default', () => {
        render(
            <Field label="Name" htmlFor="name">
                <input id="name" />
            </Field>,
        );
        expect(screen.queryByText('*')).not.toBeInTheDocument();
    });

    it('renders an error message with role=alert', () => {
        render(
            <Field label="Name" htmlFor="name" error="Name is required">
                <input id="name" />
            </Field>,
        );
        const err = screen.getByRole('alert');
        expect(err).toHaveTextContent('Name is required');
    });

    it('renders a hint when provided', () => {
        render(
            <Field label="Name" htmlFor="name" hint="As shown on ID">
                <input id="name" />
            </Field>,
        );
        expect(screen.getByText('As shown on ID')).toBeInTheDocument();
    });

    it('does not render an error or hint when not provided', () => {
        render(
            <Field label="Name" htmlFor="name">
                <input id="name" />
            </Field>,
        );
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('associates the label with the control via htmlFor', () => {
        render(
            <Field label="Name" htmlFor="name">
                <input id="name" />
            </Field>,
        );
        const label = screen.getByText('Name').closest('label');
        expect(label).toHaveAttribute('for', 'name');
    });
});
