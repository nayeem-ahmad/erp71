import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactPage from './page';

jest.mock('next/link', () => {
    return function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) {
        return <a href={href} {...props}>{children}</a>;
    };
});

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ContactPage', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    describe('Initial render', () => {
        beforeEach(() => {
            render(<ContactPage />);
        });

        it('renders the Get in touch heading', () => {
            expect(screen.getByRole('heading', { name: /get in touch/i, level: 1 })).toBeInTheDocument();
        });

        it('renders the Contact Information heading', () => {
            expect(screen.getByRole('heading', { name: /contact information/i })).toBeInTheDocument();
        });

        it('renders the Send us a message heading', () => {
            expect(screen.getByRole('heading', { name: /send us a message/i })).toBeInTheDocument();
        });

        it('renders the Name input', () => {
            expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
        });

        it('renders the Email input', () => {
            expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
        });

        it('renders the Subject select', () => {
            expect(screen.getByLabelText(/^subject/i)).toBeInTheDocument();
        });

        it('renders the Message textarea', () => {
            expect(screen.getByLabelText(/^message/i)).toBeInTheDocument();
        });

        it('renders the Send message button', () => {
            expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
        });

        it('renders contact email address', () => {
            expect(screen.getAllByText(/support@erp71\.com/i).length).toBeGreaterThan(0);
        });

        it('renders Location info', () => {
            expect(screen.getByText(/dhaka, bangladesh/i)).toBeInTheDocument();
        });

        it('renders Response time info', () => {
            expect(screen.getByText(/within 24 hours/i)).toBeInTheDocument();
        });

        it('renders default subject value as General Inquiry', () => {
            const select = screen.getByLabelText(/^subject/i) as HTMLSelectElement;
            expect(select.value).toBe('General Inquiry');
        });

        it('does not show error initially', () => {
            expect(screen.queryByText(/all fields are required/i)).not.toBeInTheDocument();
        });

        it('does not show success message initially', () => {
            expect(screen.queryByText(/message sent/i)).not.toBeInTheDocument();
        });
    });

    describe('Form field interactions', () => {
        beforeEach(() => {
            render(<ContactPage />);
        });

        it('updates name field when typed', async () => {
            const nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
            fireEvent.change(nameInput, { target: { value: 'John Doe' } });
            expect(nameInput.value).toBe('John Doe');
        });

        it('updates email field when typed', async () => {
            const emailInput = screen.getByLabelText(/^email/i) as HTMLInputElement;
            fireEvent.change(emailInput, { target: { value: 'john@example.com' } });
            expect(emailInput.value).toBe('john@example.com');
        });

        it('updates subject select when changed', async () => {
            const subjectSelect = screen.getByLabelText(/^subject/i) as HTMLSelectElement;
            fireEvent.change(subjectSelect, { target: { value: 'Sales' } });
            expect(subjectSelect.value).toBe('Sales');
        });

        it('renders all subject options', () => {
            const subjectSelect = screen.getByLabelText(/^subject/i);
            expect(screen.getByRole('option', { name: 'General Inquiry' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Sales' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Technical Support' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Billing' })).toBeInTheDocument();
        });

        it('updates message textarea when typed', async () => {
            const messageTextarea = screen.getByLabelText(/^message/i) as HTMLTextAreaElement;
            fireEvent.change(messageTextarea, { target: { value: 'Hello there!' } });
            expect(messageTextarea.value).toBe('Hello there!');
        });
    });

    describe('Form validation', () => {
        beforeEach(() => {
            render(<ContactPage />);
        });

        it('shows error when submitting empty form', async () => {
            const button = screen.getByRole('button', { name: /send message/i });
            fireEvent.click(button);
            expect(await screen.findByText(/all fields are required/i)).toBeInTheDocument();
        });

        it('shows error when name is empty but other fields filled', async () => {
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'test@test.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });
            const button = screen.getByRole('button', { name: /send message/i });
            fireEvent.click(button);
            expect(await screen.findByText(/all fields are required/i)).toBeInTheDocument();
        });

        it('shows invalid email error when email is malformed', async () => {
            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'notanemail' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message that is long enough' } });
            const button = screen.getByRole('button', { name: /send message/i });
            fireEvent.click(button);
            expect(await screen.findByText(/please enter a valid email address/i)).toBeInTheDocument();
        });

        it('shows short message error when message is under 10 characters', async () => {
            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'Short' } });
            const button = screen.getByRole('button', { name: /send message/i });
            fireEvent.click(button);
            expect(await screen.findByText(/message must be at least 10 characters/i)).toBeInTheDocument();
        });
    });

    describe('Form submission - success', () => {
        it('shows success message on successful submission', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            const button = screen.getByRole('button', { name: /send message/i });
            fireEvent.click(button);

            await waitFor(() => {
                expect(screen.getByText(/message sent/i)).toBeInTheDocument();
            });
        });

        it('hides the form after successful submission', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            fireEvent.click(screen.getByRole('button', { name: /send message/i }));

            await waitFor(() => {
                expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
            });
        });

        it('calls fetch with correct URL and method', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            fireEvent.click(screen.getByRole('button', { name: /send message/i }));

            await waitFor(() => {
                expect(mockFetch).toHaveBeenCalledWith(
                    expect.stringContaining('/api/v1/contact'),
                    expect.objectContaining({ method: 'POST' }),
                );
            });
        });
    });

    describe('Form submission - error', () => {
        it('shows server error message when response is not ok', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ message: 'Server error occurred' }),
            });
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            fireEvent.click(screen.getByRole('button', { name: /send message/i }));

            await waitFor(() => {
                expect(screen.getByText(/server error occurred/i)).toBeInTheDocument();
            });
        });

        it('shows array error message joined when server returns array', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ message: ['Error one', 'Error two'] }),
            });
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            fireEvent.click(screen.getByRole('button', { name: /send message/i }));

            await waitFor(() => {
                expect(screen.getByText(/error one error two/i)).toBeInTheDocument();
            });
        });

        it('shows fallback error message when server returns no message', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({}),
            });
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            fireEvent.click(screen.getByRole('button', { name: /send message/i }));

            await waitFor(() => {
                expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
            });
        });

        it('shows network error message when fetch throws', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            fireEvent.click(screen.getByRole('button', { name: /send message/i }));

            await waitFor(() => {
                expect(screen.getByText(/unable to send your message/i)).toBeInTheDocument();
            });
        });

        it('shows error message field on error variant with error field key', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Bad request' }),
            });
            render(<ContactPage />);

            fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
            fireEvent.change(screen.getByLabelText(/^message/i), { target: { value: 'This is a test message long enough' } });

            fireEvent.click(screen.getByRole('button', { name: /send message/i }));

            await waitFor(() => {
                expect(screen.getByText(/bad request/i)).toBeInTheDocument();
            });
        });
    });

    describe('Navigation and footer', () => {
        beforeEach(() => {
            render(<ContactPage />);
        });

        it('renders ERP71 brand link', () => {
            expect(screen.getAllByText('ERP71').length).toBeGreaterThan(0);
        });

        it('renders Sign in nav link', () => {
            expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0);
        });

        it('renders Start free trial nav link', () => {
            expect(screen.getAllByText(/start free trial/i).length).toBeGreaterThan(0);
        });

        it('renders footer Terms of Service link', () => {
            expect(screen.getByRole('link', { name: /terms of service/i })).toBeInTheDocument();
        });

        it('renders footer Privacy Policy link', () => {
            expect(screen.getByRole('link', { name: /privacy policy/i })).toBeInTheDocument();
        });

        it('renders copyright notice', () => {
            expect(screen.getByText(/erp71\. all rights reserved/i)).toBeInTheDocument();
        });
    });
});
