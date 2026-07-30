import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BusinessCardScanner from './BusinessCardScanner';

jest.mock('@/lib/api', () => ({
    api: { scanBusinessCard: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

/**
 * jsdom has no image decoder, so `loadImage` always rejects and the component
 * falls back to sending the original bytes — which is the path this suite
 * covers, and the same fallback a browser takes on an undecodable format.
 */
function fileInputs(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll('input[type="file"]'));
}

function pickImage(input: HTMLInputElement, type = 'image/png') {
    const file = new File(['card-bytes'], 'card.png', { type });
    fireEvent.change(input, { target: { files: [file] } });
}

describe('BusinessCardScanner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders nothing while closed', () => {
        const { container } = render(
            <BusinessCardScanner open={false} onClose={jest.fn()} onApply={jest.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('offers both a camera capture and a file pick', () => {
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        const inputs = fileInputs();
        expect(inputs).toHaveLength(2);
        expect(inputs.some((input) => input.hasAttribute('capture'))).toBe(true);
        expect(inputs.every((input) => input.accept === 'image/*')).toBe(true);
    });

    it('rejects a non-image file without calling the API', async () => {
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        const file = new File(['%PDF'], 'card.pdf', { type: 'application/pdf' });
        fireEvent.change(fileInputs()[0], { target: { files: [file] } });

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(api.scanBusinessCard).not.toHaveBeenCalled();
    });

    it('scans a chosen image and shows the extracted fields for review', async () => {
        api.scanBusinessCard.mockResolvedValue({
            fields: { name: 'Rafiq Islam', company: 'Karim Traders' },
        });
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        pickImage(fileInputs()[0]);
        fireEvent.click(await screen.findByRole('button', { name: /read card/i }));

        expect(await screen.findByText('Rafiq Islam')).toBeInTheDocument();
        expect(screen.getByText('Karim Traders')).toBeInTheDocument();
    });

    // The user must see the fields before they land in the form.
    it('keeps the apply button disabled until a scan has produced fields', async () => {
        api.scanBusinessCard.mockResolvedValue({ fields: { name: 'Rafiq Islam' } });
        const onApply = jest.fn();
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={onApply} />);

        const apply = screen.getByRole('button', { name: /use these details/i });
        expect(apply).toBeDisabled();

        pickImage(fileInputs()[0]);
        fireEvent.click(await screen.findByRole('button', { name: /read card/i }));
        await screen.findByText('Rafiq Islam');

        fireEvent.click(screen.getByRole('button', { name: /use these details/i }));
        expect(onApply).toHaveBeenCalledWith({ name: 'Rafiq Islam' });
    });

    it('surfaces a scan failure instead of silently doing nothing', async () => {
        api.scanBusinessCard.mockRejectedValue(new Error('AI credit limit reached'));
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        pickImage(fileInputs()[0]);
        fireEvent.click(await screen.findByRole('button', { name: /read card/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('AI credit limit reached');
    });

    it('reports a card it could read nothing from', async () => {
        api.scanBusinessCard.mockResolvedValue({ fields: {} });
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        pickImage(fileInputs()[0]);
        fireEvent.click(await screen.findByRole('button', { name: /read card/i }));

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /use these details/i })).toBeDisabled();
    });
});
