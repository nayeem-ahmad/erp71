'use client';

import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { publicApiBase } from '@/lib/api-base';
import { useI18n } from '@/lib/i18n';

/**
 * The "get in touch" form on a shop's storefront.
 *
 * A company website's main conversion element, and until now the storefront had
 * none: the footer's "Contact Us" pointed at `#contact`, which was the footer
 * itself, and a shop's only way to be reached from its own site was to type a
 * phone number into a Markdown page.
 *
 * What it posts to lands in the shop's CRM as a lead — see
 * `storefront-enquiries.service.ts`, which also explains why a second enquiry
 * from the same person is appended to their existing lead rather than refused.
 *
 * The success state is deliberately terminal: the form is replaced rather than
 * cleared, so a visitor who submits does not sit looking at empty fields
 * wondering whether it went.
 */
export default function StorefrontEnquiryForm({ slug }: { slug: string }) {
    const { t } = useI18n();
    const m = t.storefront.public.enquiry;

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [mobile, setMobile] = useState('');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const field =
        'w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--sf-accent)] focus:border-transparent transition-all';

    const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSending(true);
        setError(null);

        try {
            const response = await fetch(
                `${publicApiBase()}/storefront/${encodeURIComponent(slug)}/enquiries`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name.trim(),
                        email: email.trim() || undefined,
                        mobile: mobile.trim() || undefined,
                        message: message.trim(),
                    }),
                },
            );

            if (!response.ok) {
                // The backend's own sentence when it has one — it is the half
                // that knows a message was too short or a mobile unparseable.
                const body = await response.json().catch(() => null);
                const detail = Array.isArray(body?.message) ? body.message[0] : body?.message;
                throw new Error(typeof detail === 'string' && detail ? detail : m.error);
            }

            setSent(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : m.error);
        } finally {
            setSending(false);
        }
    };

    if (sent) {
        return (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />
                <p className="text-sm font-medium text-emerald-800">{m.success}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
                <label htmlFor="enquiry-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                    {m.name}
                </label>
                <input
                    id="enquiry-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={120}
                    className={field}
                />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor="enquiry-email" className="mb-1.5 block text-sm font-medium text-gray-700">
                        {m.email}
                    </label>
                    <input
                        id="enquiry-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        maxLength={180}
                        className={field}
                    />
                </div>
                <div>
                    <label htmlFor="enquiry-mobile" className="mb-1.5 block text-sm font-medium text-gray-700">
                        {m.mobile}
                    </label>
                    <input
                        id="enquiry-mobile"
                        type="tel"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        maxLength={32}
                        className={field}
                    />
                </div>
            </div>
            {/* Neither field is individually required, but one of them is. */}
            <p className="text-xs text-gray-500">{m.contactHint}</p>

            <div>
                <label htmlFor="enquiry-message" className="mb-1.5 block text-sm font-medium text-gray-700">
                    {m.message}
                </label>
                <textarea
                    id="enquiry-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={5}
                    maxLength={2000}
                    placeholder={m.messagePlaceholder}
                    className={field}
                />
            </div>

            {error && (
                <p role="alert" className="text-sm font-medium text-red-600">
                    {error}
                </p>
            )}

            <button
                type="submit"
                disabled={sending || !name.trim() || !message.trim() || (!email.trim() && !mobile.trim())}
                className="min-h-touch w-full rounded-xl bg-[color:var(--sf-accent)] px-6 py-3 font-semibold text-[color:var(--sf-accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40 sm:w-auto"
            >
                {sending ? m.sending : m.send}
            </button>
        </form>
    );
}
