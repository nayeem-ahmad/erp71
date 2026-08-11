'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { Alert, Button, Field, FormFooter, FormGrid, Input, Select, Textarea } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import type { Applicant, JobPost } from './types';

/**
 * Adding somebody to a pipeline.
 *
 * Two modes on one form because the person entering a stack of CVs is usually
 * meeting the candidate for the first time; making them create the applicant on
 * another screen first would be two screens per CV. Picking an existing
 * applicant is the other half — that is how a repeat candidate stays one record.
 */
export default function ApplicationModal({
    jobPost,
    onClose,
    onSaved,
}: {
    /** Fixed when opened from a job post; chosen in the form otherwise. */
    jobPost?: JobPost;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useI18n();
    const copy = t.recruitment.applications;
    const toast = useToastStore((state) => state.show);

    const [mode, setMode] = useState<'existing' | 'new'>('existing');
    const [posts, setPosts] = useState<JobPost[]>([]);
    const [applicants, setApplicants] = useState<Applicant[]>([]);
    const [form, setForm] = useState({
        job_post_id: jobPost?.id ?? '',
        applicant_id: '',
        applied_at: new Date().toISOString().slice(0, 10),
        expected_salary: '',
        source: '',
        notes: '',
    });
    const [newApplicant, setNewApplicant] = useState({
        name: '', phone: '', email: '', current_company: '', experience_years: '', resume_url: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            jobPost ? Promise.resolve([]) : api.getJobPosts(),
            api.getApplicants(),
        ])
            .then(([postList, applicantList]) => {
                if (cancelled) return;
                // A closed post cannot take applications, so it is not offered.
                setPosts((postList ?? []).filter((post: JobPost) => post.status !== 'CLOSED'));
                setApplicants(applicantList ?? []);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [jobPost]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setSaving(true);
        try {
            await api.createJobApplication({
                job_post_id: form.job_post_id,
                ...(mode === 'existing'
                    ? { applicant_id: form.applicant_id }
                    : {
                        applicant: {
                            name: newApplicant.name,
                            phone: newApplicant.phone,
                            email: newApplicant.email || undefined,
                            current_company: newApplicant.current_company || undefined,
                            experience_years: newApplicant.experience_years
                                ? Number(newApplicant.experience_years)
                                : undefined,
                            resume_url: newApplicant.resume_url || undefined,
                        },
                    }),
                applied_at: form.applied_at || undefined,
                expected_salary: form.expected_salary ? Number(form.expected_salary) : undefined,
                source: form.source || undefined,
                notes: form.notes || undefined,
            });
            toast('success', copy.created);
            onSaved();
            onClose();
        } catch (err: any) {
            setError(err?.message || copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={copy.addTitle} subtitle={jobPost?.title} onClose={onClose} />
            <form onSubmit={submit} className="space-y-3 p-4">
                {error && <Alert tone="danger">{error}</Alert>}

                {!jobPost && (
                    <Field label={copy.form.jobPost} htmlFor="application-post" required>
                        <Select
                            id="application-post"
                            value={form.job_post_id}
                            onChange={(event) => setForm((prev) => ({ ...prev, job_post_id: event.target.value }))}
                            required
                        >
                            <option value="">{copy.allPosts}</option>
                            {posts.map((post) => (
                                <option key={post.id} value={post.id}>{post.code} — {post.title}</option>
                            ))}
                        </Select>
                    </Field>
                )}

                <div className="flex gap-1 border-b border-gray-200">
                    {([
                        ['existing', copy.form.existingApplicant],
                        ['new', copy.form.newApplicant],
                    ] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setMode(key)}
                            className={`min-h-touch border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                mode === key
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {mode === 'existing' ? (
                    <Field label={copy.form.applicant} htmlFor="application-applicant" required>
                        <Select
                            id="application-applicant"
                            value={form.applicant_id}
                            onChange={(event) => setForm((prev) => ({ ...prev, applicant_id: event.target.value }))}
                            required
                        >
                            <option value="">{copy.form.selectApplicant}</option>
                            {applicants.map((applicant) => (
                                <option key={applicant.id} value={applicant.id}>
                                    {applicant.name} — {applicant.phone}
                                </option>
                            ))}
                        </Select>
                    </Field>
                ) : (
                    <FormGrid>
                        <Field label={t.recruitment.applicants.form.name} htmlFor="new-applicant-name" required>
                            <Input
                                id="new-applicant-name"
                                value={newApplicant.name}
                                onChange={(event) => setNewApplicant((prev) => ({ ...prev, name: event.target.value }))}
                                required
                            />
                        </Field>
                        <Field label={t.recruitment.applicants.form.phone} htmlFor="new-applicant-phone" required>
                            <Input
                                id="new-applicant-phone"
                                value={newApplicant.phone}
                                onChange={(event) => setNewApplicant((prev) => ({ ...prev, phone: event.target.value }))}
                                placeholder={t.recruitment.applicants.form.phonePlaceholder}
                                required
                            />
                        </Field>
                        <Field label={t.recruitment.applicants.form.email} htmlFor="new-applicant-email">
                            <Input
                                id="new-applicant-email"
                                type="email"
                                value={newApplicant.email}
                                onChange={(event) => setNewApplicant((prev) => ({ ...prev, email: event.target.value }))}
                            />
                        </Field>
                        <Field label={t.recruitment.applicants.form.currentCompany} htmlFor="new-applicant-company">
                            <Input
                                id="new-applicant-company"
                                value={newApplicant.current_company}
                                onChange={(event) => setNewApplicant((prev) => ({ ...prev, current_company: event.target.value }))}
                            />
                        </Field>
                        <Field label={t.recruitment.applicants.form.experienceYears} htmlFor="new-applicant-experience">
                            <Input
                                id="new-applicant-experience"
                                type="number"
                                min={0}
                                step="0.5"
                                value={newApplicant.experience_years}
                                onChange={(event) => setNewApplicant((prev) => ({ ...prev, experience_years: event.target.value }))}
                            />
                        </Field>
                        <Field label={t.recruitment.applicants.form.resumeUrl} htmlFor="new-applicant-resume">
                            <Input
                                id="new-applicant-resume"
                                value={newApplicant.resume_url}
                                onChange={(event) => setNewApplicant((prev) => ({ ...prev, resume_url: event.target.value }))}
                                placeholder={t.recruitment.applicants.form.resumeUrlPlaceholder}
                            />
                        </Field>
                    </FormGrid>
                )}

                <FormGrid>
                    <Field label={copy.form.appliedAt} htmlFor="application-applied-at">
                        <Input
                            id="application-applied-at"
                            type="date"
                            value={form.applied_at}
                            onChange={(event) => setForm((prev) => ({ ...prev, applied_at: event.target.value }))}
                        />
                    </Field>
                    <Field label={copy.form.expectedSalary} htmlFor="application-expected">
                        <Input
                            id="application-expected"
                            type="number"
                            min={0}
                            step="0.01"
                            value={form.expected_salary}
                            onChange={(event) => setForm((prev) => ({ ...prev, expected_salary: event.target.value }))}
                        />
                    </Field>
                    <Field label={copy.form.source} htmlFor="application-source">
                        <Input
                            id="application-source"
                            value={form.source}
                            onChange={(event) => setForm((prev) => ({ ...prev, source: event.target.value }))}
                            placeholder={t.recruitment.applicants.form.sourcePlaceholder}
                        />
                    </Field>
                    <FormGrid.Full>
                        <Field label={copy.form.notes} htmlFor="application-notes">
                            <Textarea
                                id="application-notes"
                                rows={2}
                                value={form.notes}
                                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                            />
                        </Field>
                    </FormGrid.Full>
                </FormGrid>

                <FormFooter>
                    <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
                    <Button type="submit" loading={saving} disabled={saving}>{t.common.save}</Button>
                </FormFooter>
            </form>
        </ModalShell>
    );
}
