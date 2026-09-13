'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import type { PasswordPolicy } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { clearAuthSession } from '@/lib/auth-session';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Alert, Button, Field, Input, PasswordRequirements } from '@/components/ui';

/**
 * Shown instead of the app when the signed-in person is still on a password
 * somebody else chose for them.
 *
 * `EmployeeLoginService` generates a password and shows it to HR, so from the
 * moment it exists two people know it. `JwtAuthGuard` already refuses every
 * endpoint but the four this screen needs, so the app behind it would be a wall
 * of failed requests — this replaces it rather than overlaying it, which is why
 * the layout returns this in place of the shell and not alongside it.
 *
 * The backend is the rule and this is the way through it. Someone who skips the
 * screen gets 403s, not access.
 */
export default function SetPasswordGate() {
    const { t } = useI18n();
    const router = useRouter();
    const copy = t.employeePortal.mustChangePassword;

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [touched, setTouched] = useState(false);
    const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // One of the four endpoints the guard still allows, so the checklist shows
    // the workspace's real rules rather than the platform default.
    useEffect(() => {
        api.getTenantPasswordPolicy().then(setPolicy).catch(() => null);
    }, []);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError(copy.mismatch);
            return;
        }

        setSaving(true);
        try {
            await api.changePassword({ currentPassword, newPassword });
            // Changing a password bumps `token_version`, so this session is
            // already dead by the time the call returns. Sending them to the
            // login form is honest about that; leaving them here would mean
            // every subsequent request 401ing with no explanation.
            clearAuthSession();
            toast.success(copy.success);
            router.push('/login');
        } catch (err: any) {
            setError(err?.message || copy.failed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-8">
            <div className="w-full max-w-md space-y-4">
                <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-light text-blue-600">
                        <KeyRound className="h-5 w-5" />
                    </span>
                    <div>
                        <h1 className="text-base font-semibold text-gray-900">{copy.title}</h1>
                        <p className="text-xs text-gray-500">{copy.description}</p>
                    </div>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="space-y-4 rounded-lg border border-gray-100 bg-white p-4 shadow-sm"
                >
                    {error && <Alert tone="danger">{error}</Alert>}

                    <Field label={copy.currentPassword} htmlFor="current-password" required>
                        <Input
                            id="current-password"
                            type="password"
                            autoComplete="current-password"
                            className="w-full"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                    </Field>

                    <div className="space-y-2">
                        <Field label={copy.newPassword} htmlFor="new-password" required>
                            <Input
                                id="new-password"
                                type="password"
                                autoComplete="new-password"
                                className="w-full"
                                value={newPassword}
                                onChange={(e) => {
                                    setNewPassword(e.target.value);
                                    setTouched(true);
                                }}
                                required
                            />
                        </Field>
                        <PasswordRequirements
                            password={newPassword}
                            policy={policy}
                            touched={touched}
                        />
                    </div>

                    <Field label={copy.confirmPassword} htmlFor="confirm-password" required>
                        <Input
                            id="confirm-password"
                            type="password"
                            autoComplete="new-password"
                            className="w-full"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                        />
                    </Field>

                    <Button
                        type="submit"
                        variant="primary"
                        className="w-full justify-center min-h-touch"
                        loading={saving}
                        disabled={!currentPassword || !newPassword || !confirmPassword}
                    >
                        {copy.submit}
                    </Button>
                </form>
            </div>
        </div>
    );
}
