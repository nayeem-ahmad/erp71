'use client';

import { useState, FormEvent } from 'react';
import { Mail, MapPin, Clock } from 'lucide-react';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import { useI18n, formatMessage } from '@/lib/i18n';

export default function ContactPage() {
    const { t } = useI18n();
    const m = t.marketing.contact;
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [subject, setSubject] = useState(m.subjects[0]);
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError('');

        // Frontend validation
        if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
            setError(m.validation.required);
            return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setError(m.validation.invalidEmail);
            return;
        }
        if (message.trim().length < 10) {
            setError(m.validation.messageTooShort);
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/contact`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, subject, message }),
                },
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const msg = data?.message ?? data?.error ?? m.errors.default;
                setError(Array.isArray(msg) ? msg.join(' ') : String(msg));
            } else {
                setSuccess(true);
            }
        } catch {
            setError(m.errors.network);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">

            <MarketingNav />

            <main className="pt-32 pb-24 px-6">
                <div className="max-w-6xl mx-auto">

                    {/* Hero */}
                    <div className="text-center mb-16">
                        <h1 className="text-5xl font-black tracking-tight text-gray-900 mb-4">{m.title}</h1>
                        <p className="text-lg text-gray-500">{m.subtitle}</p>
                    </div>

                    {/* Two-column layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

                        {/* Left: contact info */}
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-gray-900">{m.infoTitle}</h2>
                            <p className="text-gray-500">{m.infoDescription}</p>

                            <div className="space-y-4 mt-8">
                                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-2xl">
                                    <div className="bg-blue-100 p-3 rounded-xl shrink-0">
                                        <Mail className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 mb-1">{m.info.email}</p>
                                        <a
                                            href={`mailto:${m.info.emailValue}`}
                                            className="text-blue-600 hover:underline text-sm"
                                        >
                                            {m.info.emailValue}
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-2xl">
                                    <div className="bg-blue-100 p-3 rounded-xl shrink-0">
                                        <MapPin className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 mb-1">{m.info.location}</p>
                                        <p className="text-gray-500 text-sm">{m.info.addressValue}</p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-2xl">
                                    <div className="bg-blue-100 p-3 rounded-xl shrink-0">
                                        <Clock className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 mb-1">{m.info.responseTime}</p>
                                        <p className="text-gray-500 text-sm">{m.info.responseTimeValue}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right: contact form */}
                        <div>
                            {success ? (
                                <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                                    <div className="bg-green-50 border border-green-200 rounded-2xl p-10">
                                        <div className="text-green-600 text-5xl mb-4">&#10003;</div>
                                        <p className="text-green-800 font-semibold text-lg">{m.form.successTitle}</p>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                                    <h2 className="text-2xl font-bold text-gray-900 mb-6">{m.form.title}</h2>

                                    {error && (
                                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                                            {error}
                                        </div>
                                    )}

                                    {/* Name */}
                                    <div>
                                        <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {m.form.name} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            id="name"
                                            type="text"
                                            required
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder={m.form.namePlaceholder}
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        />
                                    </div>

                                    {/* Email */}
                                    <div>
                                        <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {m.form.email} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            id="email"
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder={m.form.emailPlaceholder}
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        />
                                    </div>

                                    {/* Subject dropdown */}
                                    <div>
                                        <label htmlFor="subject" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {m.form.subject} <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            id="subject"
                                            required
                                            value={subject}
                                            onChange={(e) => setSubject(e.target.value)}
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        >
                                            {m.subjects.slice(0, 4).map((s) => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Message */}
                                    <div>
                                        <label htmlFor="message" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            {m.form.message} <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            id="message"
                                            required
                                            minLength={10}
                                            rows={5}
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            placeholder={m.form.messagePlaceholder}
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl transition-colors"
                                    >
                                        {submitting ? m.form.submitting : m.form.submit}
                                    </button>
                                </form>
                            )}
                        </div>

                    </div>
                </div>
            </main>

            <MarketingFooter />
        </div>
    );
}
