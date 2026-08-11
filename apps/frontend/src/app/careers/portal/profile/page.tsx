'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Upload } from 'lucide-react';
import type { CareersProfile } from '@erp71/shared-types';
import { careersApi } from '@/lib/careers-api';
import { routes } from '@/lib/routes';
import { useRequireApplicant } from '../useRequireApplicant';

const inputClass =
    'w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch';

/** The profile every application is sent with — filled in once, reused everywhere. */
export default function CareersProfilePage() {
    const ready = useRequireApplicant();
    const fileInput = useRef<HTMLInputElement>(null);

    const [profile, setProfile] = useState<CareersProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!ready) return;
        careersApi
            .getProfile()
            .then(setProfile)
            .catch((err) => setError(err?.message || 'Could not load your profile.'))
            .finally(() => setLoading(false));
    }, [ready]);

    const set = <K extends keyof CareersProfile>(key: K, value: CareersProfile[K]) => {
        setProfile((current) => (current ? { ...current, [key]: value } : current));
        setSaved(false);
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile) return;
        setError('');
        setSaving(true);
        try {
            // `email` and the two verification flags belong to the `User`, not
            // the profile — sending them back would be rejected by the DTO
            // whitelist (`forbidNonWhitelisted`).
            const updated = await careersApi.updateProfile({
                full_name: profile.full_name,
                phone: profile.phone ?? '',
                headline: profile.headline ?? '',
                location: profile.location ?? '',
                summary: profile.summary ?? '',
                linkedin_url: profile.linkedin_url ?? '',
                portfolio_url: profile.portfolio_url ?? '',
            });
            setProfile(updated);
            setSaved(true);
        } catch (err: any) {
            setError(err?.message || 'Could not save your profile.');
        } finally {
            setSaving(false);
        }
    };

    const upload = async (file: File) => {
        setError('');
        setUploading(true);
        try {
            setProfile(await careersApi.uploadResume(file));
            setSaved(true);
        } catch (err: any) {
            setError(err?.message || 'Could not upload that file.');
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    if (!ready || loading) return <p className="p-6 text-center text-sm text-gray-500">Loading…</p>;

    if (!profile) {
        return (
            <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                {error || 'Profile unavailable.'}
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-2xl space-y-4">
            <Link
                href={routes.careers.portal}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
            >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                My applications
            </Link>

            <div>
                <h1 className="text-lg font-bold tracking-tight text-gray-950">My profile</h1>
                <p className="mt-0.5 text-xs text-gray-500">
                    Sent with every application. Signed in as {profile.email}.
                </p>
            </div>

            {error ? (
                <p className="rounded-lg border border-red-100 bg-red-50 p-2.5 text-xs text-red-700">
                    {error}
                </p>
            ) : null}
            {saved && !error ? (
                <p className="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5 text-xs text-emerald-700">
                    Profile saved.
                </p>
            ) : null}

            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-gray-950">CV</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                    PDF or Word, up to 5MB. A copy is attached to each application at the moment you
                    apply, so updating it here does not change applications already sent.
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {profile.resume_url ? (
                        <a
                            href={profile.resume_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-touch"
                        >
                            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                            {profile.resume_name || 'View current CV'}
                        </a>
                    ) : (
                        <span className="text-xs text-gray-500">No CV uploaded yet.</span>
                    )}

                    <input
                        ref={fileInput}
                        type="file"
                        accept=".pdf,.doc,.docx"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void upload(file);
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        disabled={uploading}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 max-md:min-h-touch"
                    >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        {uploading ? 'Uploading…' : profile.resume_url ? 'Replace CV' : 'Upload CV'}
                    </button>
                </div>
            </section>

            {profile.mobile_verified || profile.email_verified ? null : (
                <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    Neither your email nor your mobile number is verified yet. That only matters if a
                    company you apply to has already met you — verifying lets your application link
                    to the record they already hold instead of being refused as a duplicate.
                </p>
            )}

            <form onSubmit={save} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-gray-950">About you</h2>

                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Full name</span>
                        <input
                            value={profile.full_name}
                            onChange={(e) => set('full_name', e.target.value)}
                            required
                            minLength={2}
                            className={inputClass}
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Mobile</span>
                        <input
                            value={profile.phone ?? ''}
                            onChange={(e) => set('phone', e.target.value)}
                            placeholder="01XXXXXXXXX"
                            className={inputClass}
                        />
                        <span className="mt-1 block text-xs text-gray-400">
                            Required before applying — employers match candidates on their number.
                        </span>
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Headline</span>
                        <input
                            value={profile.headline ?? ''}
                            onChange={(e) => set('headline', e.target.value)}
                            placeholder="Senior Accountant, 6 years"
                            maxLength={160}
                            className={inputClass}
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">Location</span>
                        <input
                            value={profile.location ?? ''}
                            onChange={(e) => set('location', e.target.value)}
                            placeholder="Dhaka"
                            className={inputClass}
                        />
                    </label>
                </div>

                <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-500">Summary</span>
                    <textarea
                        value={profile.summary ?? ''}
                        onChange={(e) => set('summary', e.target.value)}
                        rows={5}
                        maxLength={4000}
                        placeholder="A short summary of your experience"
                        className={inputClass}
                    />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">
                            LinkedIn <span className="text-gray-400">(optional)</span>
                        </span>
                        <input
                            type="url"
                            value={profile.linkedin_url ?? ''}
                            onChange={(e) => set('linkedin_url', e.target.value)}
                            placeholder="https://linkedin.com/in/…"
                            className={inputClass}
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">
                            Portfolio <span className="text-gray-400">(optional)</span>
                        </span>
                        <input
                            type="url"
                            value={profile.portfolio_url ?? ''}
                            onChange={(e) => set('portfolio_url', e.target.value)}
                            placeholder="https://…"
                            className={inputClass}
                        />
                    </label>
                </div>

                <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 max-md:min-h-touch"
                >
                    {saving ? 'Saving…' : 'Save profile'}
                </button>
            </form>
        </div>
    );
}
