'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { Alert, Button, Field, FormFooter, Select, Textarea } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { APPLICATION_STAGES, type ApplicationStage, type JobApplication } from './types';

/**
 * Moving one candidate along the pipeline.
 *
 * HIRED is absent from the list on purpose — hiring creates an employee record,
 * which the hire modal collects the joining details for. The server refuses it
 * here too; leaving it out is so nobody has to discover that from a 400.
 */
export default function StageModal({
    application,
    onClose,
    onSaved,
}: {
    application: JobApplication;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useI18n();
    const copy = t.recruitment.applications;
    const toast = useToastStore((state) => state.show);

    const movableStages = APPLICATION_STAGES.filter(
        (stage) => stage !== 'HIRED' && stage !== application.stage,
    );

    const [stage, setStage] = useState<ApplicationStage>(movableStages[0] ?? 'SCREENING');
    const [note, setNote] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setSaving(true);
        try {
            await api.changeJobApplicationStage(application.id, {
                stage,
                note: note || undefined,
                rejection_reason: stage === 'REJECTED' ? rejectionReason || undefined : undefined,
            });
            toast('success', copy.stageChanged);
            onSaved();
            onClose();
        } catch (err: any) {
            setError(err?.message || copy.stageFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader
                title={copy.stageForm.title}
                subtitle={application.applicant?.name}
                onClose={onClose}
            />
            <form onSubmit={submit} className="space-y-3 p-4">
                {error && <Alert tone="danger">{error}</Alert>}

                <Field label={copy.stageForm.stage} htmlFor="application-stage" required>
                    <Select
                        id="application-stage"
                        value={stage}
                        onChange={(event) => setStage(event.target.value as ApplicationStage)}
                    >
                        {movableStages.map((option) => (
                            <option key={option} value={option}>{t.recruitment.stages[option]}</option>
                        ))}
                    </Select>
                </Field>

                {stage === 'REJECTED' && (
                    <Field label={copy.stageForm.rejectionReason} htmlFor="application-rejection">
                        <Textarea
                            id="application-rejection"
                            rows={2}
                            value={rejectionReason}
                            onChange={(event) => setRejectionReason(event.target.value)}
                            placeholder={copy.stageForm.rejectionPlaceholder}
                        />
                    </Field>
                )}

                <Field label={copy.stageForm.note} htmlFor="application-note">
                    <Textarea
                        id="application-note"
                        rows={3}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={copy.stageForm.notePlaceholder}
                    />
                </Field>

                <p className="text-xs text-gray-500">{copy.stageForm.hiredHint}</p>

                <FormFooter>
                    <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
                    <Button type="submit" loading={saving} disabled={saving}>{t.common.save}</Button>
                </FormFooter>
            </form>
        </ModalShell>
    );
}
