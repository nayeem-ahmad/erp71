import { render, screen } from '@testing-library/react';
import { ContactFormFields, contactFormToPayload, emptyContactForm } from './contact-form-fields';

const form = { ...emptyContactForm(), company: 'Karim Traders' };

describe('ContactFormFields organization line', () => {
    it('shows the organization name and still submits company, not organization_id', () => {
        render(
            <ContactFormFields
                form={form}
                onChange={() => undefined}
                organizationName="Karim Traders"
            />,
        );

        expect(screen.getByText('Organization')).toBeInTheDocument();
        expect(screen.getByText('Karim Traders')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Karim Traders')).toBeInTheDocument();

        const payload = contactFormToPayload(form);
        expect(payload.company).toBe('Karim Traders');
        expect(payload).not.toHaveProperty('organization_id');
    });

    it('renders no organization line when organizationName is null or omitted', () => {
        const { rerender } = render(<ContactFormFields form={form} onChange={() => undefined} />);
        expect(screen.queryByText('Organization')).not.toBeInTheDocument();

        rerender(
            <ContactFormFields form={form} onChange={() => undefined} organizationName={null} />,
        );
        expect(screen.queryByText('Organization')).not.toBeInTheDocument();
    });
});
