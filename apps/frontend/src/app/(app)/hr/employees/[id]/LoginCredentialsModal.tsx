'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button } from '@/components/ui';

export type LoginCredentials = {
    sign_in_identifier: string | null;
    password: string;
};

type Props = {
    credentials: LoginCredentials;
    /** A reset shows the same fields under a different heading. */
    mode: 'created' | 'reset';
    employeeName: string;
    onClose: () => void;
};

/**
 * The one moment the generated password can be read.
 *
 * It is stored as a bcrypt hash and nothing returns it again — `reset` mints a
 * new one rather than recovering this one — so this dialog is deliberately
 * heavier than a toast: it states that up front, and its only dismissal is an
 * explicit button. No backdrop click, no Escape. Someone who loses this by
 * clicking beside it has to reset the password and hand over a different one.
 */
export default function LoginCredentialsModal({ credentials, mode, employeeName, onClose }: Props) {
    const { t } = useI18n();
    const copy = t.employeePortal.login;
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const write = async (field: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(field);
            window.setTimeout(() => setCopiedField(null), 2000);
        } catch {
            // A denied clipboard permission is not an error worth a banner —
            // both values are on screen and selectable.
        }
    };

    const rows: { key: string; label: string; value: string }[] = [
        ...(credentials.sign_in_identifier
            ? [{ key: 'identifier', label: copy.identifierLabel, value: credentials.sign_in_identifier }]
            : []),
        { key: 'password', label: copy.passwordLabel, value: credentials.password },
    ];

    return (
        <ModalShell size="sm">
            <ModalHeader
                title={mode === 'created' ? copy.credentialsTitle : copy.credentialsResetTitle}
                subtitle={employeeName}
            />

            <div className="space-y-3 p-4">
                <Alert tone="warning">{copy.credentialsSubtitle}</Alert>

                {rows.map((row) => (
                    <div key={row.key} className="space-y-1">
                        <p className="text-xs font-medium text-gray-600">{row.label}</p>
                        <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-sm text-gray-900">
                                {row.value}
                            </code>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => write(row.key, row.value)}
                                icon={
                                    copiedField === row.key
                                        ? <Check className="h-4 w-4" />
                                        : <Copy className="h-4 w-4" />
                                }
                            >
                                {copiedField === row.key ? copy.copied : copy.copy}
                            </Button>
                        </div>
                    </div>
                ))}

                <p className="text-xs text-gray-500">{copy.mustChangeNotice}</p>
            </div>

            <ModalFooter>
                <Button type="button" variant="primary" onClick={onClose}>
                    {copy.done}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
