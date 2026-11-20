'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import {
    Alert,
    Button,
    CompactSection,
    ConfirmDialog,
    Field,
    FormFooter,
    FormGrid,
    Input,
    PageHeader,
    PageShell,
    Select,
    StatusBadge,
    Switch,
} from '@/components/ui';

type Security = 'starttls' | 'ssl';

type ServerSettings = {
    enabled: boolean;
    host: string;
    port: number;
    security: Security;
    username: string;
    /** The mask when a password is stored, '' when none is. */
    password: string;
    from_email: string;
    from_name: string;
    reply_to: string;
    verified_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
    updated_at: string | null;
};

type FormState = {
    host: string;
    port: number;
    security: Security;
    username: string;
    /** Only what the user typed; blank keeps the stored password. */
    password: string;
    from_email: string;
    from_name: string;
    reply_to: string;
};

const PORTS = [587, 465, 25, 2525];

/** The usual settings for providers shops in Bangladesh mostly use. */
const PRESETS: Array<{ key: 'gmail' | 'outlook' | 'zoho'; host: string; port: number; security: Security }> = [
    { key: 'gmail', host: 'smtp.gmail.com', port: 587, security: 'starttls' },
    { key: 'outlook', host: 'smtp.office365.com', port: 587, security: 'starttls' },
    { key: 'zoho', host: 'smtp.zoho.com', port: 465, security: 'ssl' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toForm(s: ServerSettings): FormState {
    return {
        host: s.host,
        port: s.port,
        security: s.security,
        username: s.username,
        password: '',
        from_email: s.from_email,
        from_name: s.from_name,
        reply_to: s.reply_to,
    };
}

export default function EmailServerSettingsPage() {
    const { t, locale } = useI18n();
    const m = t.settingsExtras.emailServer;

    const [saved, setSaved] = useState<ServerSettings | null>(null);
    const [form, setForm] = useState<FormState | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
    const [toggling, setToggling] = useState(false);
    const [testTo, setTestTo] = useState('');
    const [testing, setTesting] = useState(false);
    const [testError, setTestError] = useState('');
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [removing, setRemoving] = useState(false);

    function apply(next: ServerSettings) {
        setSaved(next);
        setForm(toForm(next));
    }

    useEffect(() => {
        fetchWithAuth('/tenants/email-server')
            .then((d: ServerSettings) => apply(d))
            .catch(() => setLoadError(m.loadFailed))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const dirty = useMemo(() => {
        if (!saved || !form) return false;
        const base = toForm(saved);
        return (Object.keys(base) as Array<keyof FormState>).some((k) => base[k] !== form[k]);
    }, [saved, form]);

    const hasStoredPassword = saved?.password !== '';
    const configured = Boolean(saved?.host && saved?.username && hasStoredPassword && saved?.from_email);

    function update<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
        setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }

    function changePort(value: number) {
        // The two common ports each imply one security mode; follow along so the
        // pair a shop picks is a pair that can work.
        setForm((prev) =>
            prev
                ? {
                      ...prev,
                      port: value,
                      security: value === 465 ? 'ssl' : value === 587 ? 'starttls' : prev.security,
                  }
                : prev,
        );
    }

    function applyPreset(preset: (typeof PRESETS)[number]) {
        setForm((prev) => (prev ? { ...prev, host: preset.host, port: preset.port, security: preset.security } : prev));
        setFieldErrors((prev) => ({ ...prev, host: undefined }));
    }

    function validate(f: FormState): boolean {
        const errors: Partial<Record<keyof FormState, string>> = {};
        if (!f.host.trim()) errors.host = m.errors.hostRequired;
        else if (!/^[A-Za-z0-9.\-:[\]]+$/.test(f.host.trim())) errors.host = m.errors.hostInvalid;
        if (!f.username.trim()) errors.username = m.errors.usernameRequired;
        if (!f.password && !hasStoredPassword) errors.password = m.errors.passwordRequired;
        if (!f.from_email.trim()) errors.from_email = m.errors.fromRequired;
        else if (!EMAIL_RE.test(f.from_email.trim())) errors.from_email = m.errors.emailInvalid;
        if (f.reply_to.trim() && !EMAIL_RE.test(f.reply_to.trim())) errors.reply_to = m.errors.emailInvalid;
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    }

    async function handleSave() {
        if (!form || !validate(form)) return;
        setSaving(true);
        setSaveError('');
        try {
            const body: Record<string, unknown> = {
                host: form.host.trim(),
                port: form.port,
                security: form.security,
                username: form.username.trim(),
                from_email: form.from_email.trim(),
                from_name: form.from_name.trim(),
                reply_to: form.reply_to.trim(),
            };
            if (form.password) body.password = form.password;
            const next: ServerSettings = await fetchWithAuth('/tenants/email-server', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            apply(next);
            toast.success(next.verified_at ? m.saved : m.savedNeedsTest);
        } catch (e: any) {
            setSaveError(e?.message ?? m.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(enabled: boolean) {
        setToggling(true);
        setSaveError('');
        try {
            const next: ServerSettings = await fetchWithAuth('/tenants/email-server', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            setSaved(next);
            toast.success(enabled ? m.turnedOn : m.turnedOff);
        } catch (e: any) {
            setSaveError(e?.message ?? m.saveFailed);
        } finally {
            setToggling(false);
        }
    }

    async function handleTest() {
        const to = testTo.trim();
        if (to && !EMAIL_RE.test(to)) {
            setTestError(m.errors.emailInvalid);
            return;
        }
        setTesting(true);
        setTestError('');
        try {
            const next: ServerSettings = await fetchWithAuth('/tenants/email-server/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(to ? { to } : {}),
            });
            setSaved(next);
            toast.success(m.test.sent);
        } catch (e: any) {
            setTestError(e?.message ?? m.test.failed);
            // The failure is stored server-side too; reload so the status matches.
            fetchWithAuth('/tenants/email-server').then((d: ServerSettings) => setSaved(d)).catch(() => undefined);
        } finally {
            setTesting(false);
        }
    }

    async function handleRemove() {
        setRemoving(true);
        try {
            const next: ServerSettings = await fetchWithAuth('/tenants/email-server', { method: 'DELETE' });
            apply(next);
            setConfirmRemove(false);
            setTestError('');
            toast.success(m.removed);
        } catch (e: any) {
            setSaveError(e?.message ?? m.saveFailed);
            setConfirmRemove(false);
        } finally {
            setRemoving(false);
        }
    }

    const status = !saved
        ? null
        : saved.enabled
          ? { tone: 'success' as const, label: m.status.on }
          : saved.verified_at
            ? { tone: 'info' as const, label: m.status.testedOff }
            : configured
              ? { tone: 'warning' as const, label: m.status.notTested }
              : { tone: 'neutral' as const, label: m.status.notSetUp };

    return (
        <PageShell maxWidth="full" className="space-y-4">
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    m.title,
                    'settings',
                )}
            />

            <Alert tone="info">{m.info}</Alert>

            {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {m.loading}
                </div>
            ) : loadError || !saved || !form ? (
                <Alert tone="danger">{loadError || m.loadFailed}</Alert>
            ) : (
                <>
                    <CompactSection title={m.status.title} titleStyle="heading">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-gray-800">{m.status.useServer}</span>
                                    {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
                                </div>
                                <p className="text-xs text-gray-500">
                                    {saved.enabled
                                        ? m.status.onHint
                                        : saved.verified_at
                                          ? m.status.offHint
                                          : m.status.needsTestHint}
                                </p>
                                {saved.verified_at && (
                                    <p className="text-xs text-gray-400">
                                        {m.status.lastTested} {formatDateTime(saved.verified_at, locale)}
                                    </p>
                                )}
                            </div>
                            <Switch
                                checked={saved.enabled}
                                onCheckedChange={handleToggle}
                                disabled={toggling || (!saved.enabled && (!saved.verified_at || dirty))}
                                aria-label={m.status.useServer}
                                className="max-md:min-h-touch"
                            />
                        </div>
                        {saved.last_error && (
                            <Alert tone="danger" title={m.status.lastError} className="mt-3">
                                <span className="block">{saved.last_error}</span>
                                {saved.last_error_at && (
                                    <span className="mt-1 block text-xs opacity-80">
                                        {formatDateTime(saved.last_error_at, locale)}
                                        {saved.enabled ? ` — ${m.status.lastErrorEnabledHint}` : ''}
                                    </span>
                                )}
                            </Alert>
                        )}
                    </CompactSection>

                    <CompactSection title={m.form.title} titleStyle="heading">
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{m.form.presets}</span>
                            {PRESETS.map((p) => (
                                <Button key={p.key} variant="secondary" size="sm" onClick={() => applyPreset(p)}>
                                    {m.form.presetNames[p.key]}
                                </Button>
                            ))}
                        </div>

                        <FormGrid>
                            <FormGrid.Full>
                                <Field label={m.form.host} required htmlFor="smtp-host" error={fieldErrors.host} hint={m.form.hostHint}>
                                    <Input
                                        id="smtp-host"
                                        value={form.host}
                                        onChange={(e) => update('host', e.target.value)}
                                        placeholder="smtp.example.com"
                                        autoComplete="off"
                                        spellCheck={false}
                                        error={Boolean(fieldErrors.host)}
                                    />
                                </Field>
                            </FormGrid.Full>
                            <Field label={m.form.port} htmlFor="smtp-port">
                                <Select id="smtp-port" value={form.port} onChange={(e) => changePort(Number(e.target.value))}>
                                    {PORTS.map((p) => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={m.form.security} htmlFor="smtp-security">
                                <Select
                                    id="smtp-security"
                                    value={form.security}
                                    onChange={(e) => update('security', e.target.value as Security)}
                                >
                                    <option value="starttls">{m.form.securityStarttls}</option>
                                    <option value="ssl">{m.form.securitySsl}</option>
                                </Select>
                            </Field>
                            <Field label={m.form.username} required htmlFor="smtp-username" error={fieldErrors.username}>
                                <Input
                                    id="smtp-username"
                                    value={form.username}
                                    onChange={(e) => update('username', e.target.value)}
                                    autoComplete="off"
                                    spellCheck={false}
                                    error={Boolean(fieldErrors.username)}
                                />
                            </Field>
                            <Field
                                label={m.form.password}
                                required={!hasStoredPassword}
                                htmlFor="smtp-password"
                                error={fieldErrors.password}
                                hint={hasStoredPassword ? m.form.passwordKeepHint : m.form.passwordHint}
                            >
                                <Input
                                    id="smtp-password"
                                    type="password"
                                    value={form.password}
                                    onChange={(e) => update('password', e.target.value)}
                                    placeholder={hasStoredPassword ? '••••••••' : ''}
                                    autoComplete="new-password"
                                    error={Boolean(fieldErrors.password)}
                                />
                            </Field>
                            <Field
                                label={m.form.fromEmail}
                                required
                                htmlFor="smtp-from-email"
                                error={fieldErrors.from_email}
                                hint={m.form.fromEmailHint}
                            >
                                <Input
                                    id="smtp-from-email"
                                    type="email"
                                    value={form.from_email}
                                    onChange={(e) => update('from_email', e.target.value)}
                                    placeholder="hello@yourshop.com"
                                    error={Boolean(fieldErrors.from_email)}
                                />
                            </Field>
                            <Field label={m.form.fromName} htmlFor="smtp-from-name" hint={m.form.fromNameHint}>
                                <Input
                                    id="smtp-from-name"
                                    value={form.from_name}
                                    onChange={(e) => update('from_name', e.target.value)}
                                    maxLength={120}
                                />
                            </Field>
                            <FormGrid.Full>
                                <Field
                                    label={m.form.replyTo}
                                    htmlFor="smtp-reply-to"
                                    error={fieldErrors.reply_to}
                                    hint={m.form.replyToHint}
                                >
                                    <Input
                                        id="smtp-reply-to"
                                        type="email"
                                        value={form.reply_to}
                                        onChange={(e) => update('reply_to', e.target.value)}
                                        error={Boolean(fieldErrors.reply_to)}
                                    />
                                </Field>
                            </FormGrid.Full>
                        </FormGrid>

                        {saveError && <Alert tone="danger" className="mt-3">{saveError}</Alert>}

                        <FormFooter className="mt-3">
                            {saved.updated_at && (
                                <Button variant="ghost" onClick={() => setConfirmRemove(true)} className="me-auto text-danger">
                                    {m.form.remove}
                                </Button>
                            )}
                            <Button onClick={handleSave} disabled={saving || !dirty} loading={saving}>
                                {saving ? m.form.saving : m.form.save}
                            </Button>
                        </FormFooter>
                    </CompactSection>

                    <CompactSection title={m.test.title} titleStyle="heading">
                        <p className="mb-3 text-xs text-gray-500">{m.test.hint}</p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                            <Field label={m.test.to} htmlFor="smtp-test-to" className="sm:flex-1" hint={m.test.toHint}>
                                <Input
                                    id="smtp-test-to"
                                    type="email"
                                    value={testTo}
                                    onChange={(e) => {
                                        setTestTo(e.target.value);
                                        setTestError('');
                                    }}
                                    className="w-full"
                                />
                            </Field>
                            <Button
                                variant="secondary"
                                onClick={handleTest}
                                disabled={testing || dirty || !configured}
                                loading={testing}
                                className="sm:mt-5"
                            >
                                <Send className="h-3.5 w-3.5" />
                                {testing ? m.test.sending : m.test.send}
                            </Button>
                        </div>
                        {dirty && <p className="mt-2 text-xs text-amber-700">{m.test.saveFirst}</p>}
                        {!dirty && !configured && <p className="mt-2 text-xs text-gray-500">{m.test.configureFirst}</p>}
                        {testError && <Alert tone="danger" className="mt-3">{testError}</Alert>}
                    </CompactSection>
                </>
            )}

            <ConfirmDialog
                open={confirmRemove}
                title={m.removeDialog.title}
                prompt={m.removeDialog.prompt}
                confirmLabel={m.removeDialog.confirm}
                cancelLabel={m.removeDialog.cancel}
                loading={removing}
                danger
                onConfirm={handleRemove}
                onCancel={() => setConfirmRemove(false)}
            />
        </PageShell>
    );
}
