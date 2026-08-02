import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

function mockCamera(getUserMedia: jest.Mock) {
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
    });
}

describe('BusinessCardScanner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'mediaDevices');
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

    // `capture="environment"` is a hint desktop browsers ignore, which left the
    // camera button opening a file dialog. The live stream is the real path.
    it('opens a live camera stream when asked for a photo', async () => {
        const stop = jest.fn();
        const getUserMedia = jest.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
        mockCamera(getUserMedia);
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /take photo/i }));

        expect(await screen.findByRole('button', { name: /capture/i })).toBeInTheDocument();
        expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } } });
        expect(document.querySelector('video')).toBeInTheDocument();
    });

    // A frame has no dimensions until metadata lands, so capturing early would
    // silently produce nothing.
    it('holds capture disabled until the stream reports its dimensions', async () => {
        mockCamera(jest.fn().mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }));
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /take photo/i }));
        expect(await screen.findByRole('button', { name: /capture/i })).toBeDisabled();

        fireEvent.loadedMetadata(document.querySelector('video')!);
        expect(screen.getByRole('button', { name: /capture/i })).toBeEnabled();
    });

    it('releases the camera when the stream is dismissed', async () => {
        const stop = jest.fn();
        mockCamera(jest.fn().mockResolvedValue({ getTracks: () => [{ stop }] }));
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /take photo/i }));
        // The header and footer carry a Cancel too — this is the viewfinder's own.
        const capture = await screen.findByRole('button', { name: /capture/i });
        fireEvent.click(within(capture.parentElement!).getByRole('button', { name: /^cancel$/i }));

        await waitFor(() => expect(stop).toHaveBeenCalled());
        expect(document.querySelector('video')).not.toBeInTheDocument();
    });

    // Permission denied, no device, or an insecure origin still needs a way in.
    it('falls back to the capture input when the camera is refused', async () => {
        mockCamera(jest.fn().mockRejectedValue(new Error('NotAllowedError')));
        render(<BusinessCardScanner open onClose={jest.fn()} onApply={jest.fn()} />);
        const capture = fileInputs().find((input) => input.hasAttribute('capture'))!;
        const click = jest.spyOn(capture, 'click');

        fireEvent.click(screen.getByRole('button', { name: /take photo/i }));

        await waitFor(() => expect(click).toHaveBeenCalled());
        expect(document.querySelector('video')).not.toBeInTheDocument();
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

        // The photo rides along with the fields so the caller can keep it once
        // the contact is actually saved.
        fireEvent.click(screen.getByRole('button', { name: /use these details/i }));
        expect(onApply).toHaveBeenCalledWith(
            { name: 'Rafiq Islam' },
            { dataUrl: expect.stringMatching(/^data:image\//), mimeType: 'image/png' },
        );
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
