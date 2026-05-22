'use client';

import Link from 'next/link';
import { useState, FormEvent } from 'react';
import { Mail, MapPin, Clock } from 'lucide-react';

export default function ContactPage() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [subject, setSubject] = useState('General Inquiry');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError('');

        // Frontend validation
        if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
            setError('All fields are required.');
            return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setError('Please enter a valid email address.');
            return;
        }
        if (message.trim().length < 10) {
            setError('Message must be at least 10 characters.');
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
                const msg = data?.message ?? data?.error ?? 'Something went wrong. Please try again.';
                setError(Array.isArray(msg) ? msg.join(' ') : String(msg));
            } else {
                setSuccess(true);
            }
        } catch {
            setError('Unable to send your message. Please check your connection and try again.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">

            {/* Nav */}
            <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="text-xl font-black tracking-tight text-blue-600">RetailSaaS</Link>
                    <div className="flex items-center gap-3">
                        <Link href="/login" className="text-sm font-semibold text-gray-700 hover:text-gray-900 px-4 py-2">
                            Sign in
                        </Link>
                        <Link
                            href="/signup"
                            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors"
                        >
                            Start free trial
                        </Link>
                    </div>
                </div>
            </header>

            <main className="pt-28 pb-24 px-6">
                <div className="max-w-6xl mx-auto">

                    {/* Hero */}
                    <div className="text-center mb-16">
                        <h1 className="text-5xl font-black tracking-tight text-gray-900 mb-4">Get in touch</h1>
                        <p className="text-lg text-gray-500">We&apos;d love to hear from you</p>
                    </div>

                    {/* Two-column layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

                        {/* Left: contact info */}
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-gray-900">Contact Information</h2>
                            <p className="text-gray-500">
                                Reach out through the form or contact us directly using the details below.
                            </p>

                            <div className="space-y-4 mt-8">
                                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-2xl">
                                    <div className="bg-blue-100 p-3 rounded-xl shrink-0">
                                        <Mail className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 mb-1">Email</p>
                                        <a
                                            href="mailto:support@retailsaas.app"
                                            className="text-blue-600 hover:underline text-sm"
                                        >
                                            support@retailsaas.app
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-2xl">
                                    <div className="bg-blue-100 p-3 rounded-xl shrink-0">
                                        <MapPin className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 mb-1">Location</p>
                                        <p className="text-gray-500 text-sm">Dhaka, Bangladesh</p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-4 p-5 bg-gray-50 rounded-2xl">
                                    <div className="bg-blue-100 p-3 rounded-xl shrink-0">
                                        <Clock className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 mb-1">Response time</p>
                                        <p className="text-gray-500 text-sm">Within 24 hours</p>
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
                                        <p className="text-green-800 font-semibold text-lg">
                                            Message sent! We&apos;ll get back to you within 24 hours.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                                    <h2 className="text-2xl font-bold text-gray-900 mb-6">Send us a message</h2>

                                    {error && (
                                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                                            {error}
                                        </div>
                                    )}

                                    {/* Name */}
                                    <div>
                                        <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            Name <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            id="name"
                                            type="text"
                                            required
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="Your full name"
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        />
                                    </div>

                                    {/* Email */}
                                    <div>
                                        <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            Email <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            id="email"
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="you@example.com"
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        />
                                    </div>

                                    {/* Subject dropdown */}
                                    <div>
                                        <label htmlFor="subject" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            Subject <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            id="subject"
                                            required
                                            value={subject}
                                            onChange={(e) => setSubject(e.target.value)}
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        >
                                            <option value="General Inquiry">General Inquiry</option>
                                            <option value="Sales">Sales</option>
                                            <option value="Technical Support">Technical Support</option>
                                            <option value="Billing">Billing</option>
                                        </select>
                                    </div>

                                    {/* Message */}
                                    <div>
                                        <label htmlFor="message" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            Message <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            id="message"
                                            required
                                            minLength={10}
                                            rows={5}
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            placeholder="Tell us how we can help you (min. 10 characters)"
                                            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl transition-colors"
                                    >
                                        {submitting ? 'Sending…' : 'Send message'}
                                    </button>
                                </form>
                            )}
                        </div>

                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="py-10 px-6 border-t border-gray-100 bg-white">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
                    <span className="font-black text-lg text-blue-600">RetailSaaS</span>
                    <div className="flex items-center gap-6">
                        <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
                        <Link href="/contact" className="hover:text-gray-700 transition-colors">Contact</Link>
                        <Link href="/status" className="hover:text-gray-700 transition-colors">Status</Link>
                        <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
                        <Link href="/signup" className="hover:text-gray-700 transition-colors">Sign up</Link>
                    </div>
                    <span>&copy; {new Date().getFullYear()} RetailSaaS. All rights reserved.</span>
                </div>
            </footer>
        </div>
    );
}
