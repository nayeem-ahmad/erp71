'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewContactPage from './page';
import { SCANNED_CARD_IMAGE_STORAGE_KEY, SCANNED_CARD_STORAGE_KEY } from '../contact-form-fields';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: (...args: unknown[]) => push(...args) }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getTeamMembers: jest.fn().mockResolvedValue([]),
        createContact: jest.fn(),
        addContactAttachment: jest.fn(),
    },
}));

const toastError = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: (...args: unknown[]) => toastError(...args) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const CARD = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', mimeType: 'image/jpeg' };

function handOffScan(fields: Record<string, string>, image?: typeof CARD) {
    sessionStorage.setItem(SCANNED_CARD_STORAGE_KEY, JSON.stringify(fields));
    if (image) sessionStorage.setItem(SCANNED_CARD_IMAGE_STORAGE_KEY, JSON.stringify(image));
}

async function saveContact() {
    fireEvent.click(await screen.findByRole('button', { name: /new contact/i }));
}

describe('NewContactPage — keeping the scanned card', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionStorage.clear();
        api.createContact.mockResolvedValue({ id: 'contact-1' });
        api.addContactAttachment.mockResolvedValue({ id: 'attachment-1' });
    });

    // The card is uploaded only once the contact exists, which is what keeps
    // storage free of images from scans the user walked away from.
    it('attaches the card after the contact is created, never before', async () => {
        handOffScan({ name: 'Rafiq Islam' }, CARD);
        render(<NewContactPage />);

        await screen.findByDisplayValue('Rafiq Islam');
        await saveContact();

        await waitFor(() => expect(api.addContactAttachment).toHaveBeenCalled());
        expect(api.addContactAttachment).toHaveBeenCalledWith('contact-1', {
            imageBase64: CARD.dataUrl,
            mimeType: CARD.mimeType,
            fileName: 'Rafiq Islam',
        });
        expect(api.createContact.mock.invocationCallOrder[0])
            .toBeLessThan(api.addContactAttachment.mock.invocationCallOrder[0]);
    });

    it('drains the hand-off so a later visit does not re-attach the same card', async () => {
        handOffScan({ name: 'Rafiq Islam' }, CARD);
        render(<NewContactPage />);

        await screen.findByDisplayValue('Rafiq Islam');
        expect(sessionStorage.getItem(SCANNED_CARD_IMAGE_STORAGE_KEY)).toBeNull();
        expect(sessionStorage.getItem(SCANNED_CARD_STORAGE_KEY)).toBeNull();
    });

    // Losing the photo must not read as losing the contact.
    it('keeps the contact and still navigates when the card upload fails', async () => {
        api.addContactAttachment.mockRejectedValue(new Error('storage down'));
        handOffScan({ name: 'Rafiq Islam' }, CARD);
        render(<NewContactPage />);

        await screen.findByDisplayValue('Rafiq Islam');
        await saveContact();

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(push).toHaveBeenCalledWith(expect.stringContaining('contact-1'));
    });

    // The fields and the photo are handed over under separate keys, so a photo
    // lost to a storage quota must not take the extracted fields with it.
    it('creates the contact with no attachment call when only fields were handed over', async () => {
        handOffScan({ name: 'Rafiq Islam' });
        render(<NewContactPage />);

        await screen.findByDisplayValue('Rafiq Islam');
        await saveContact();

        await waitFor(() => expect(api.createContact).toHaveBeenCalled());
        expect(api.addContactAttachment).not.toHaveBeenCalled();
    });
});
