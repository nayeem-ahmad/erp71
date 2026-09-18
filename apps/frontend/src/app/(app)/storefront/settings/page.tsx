'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Globe, Save } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import {
    Alert,
    Button,
    Checkbox,
    CompactSection,
    Field,
    Input,
    PageHeader,
    PageShell,
    Switch,
    Textarea,
} from '@/components/ui';
import StorefrontImageField, {
    type StorefrontImageFieldLabels,
} from '@/components/storefront/StorefrontImageField';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

const isBrowser = Boolean(globalThis.window);

interface StorefrontSettings {
    id: string;
    name: string;
    storefront_slug: string | null;
    storefront_enabled: boolean;
    storefront_banner: string | null;
    storefront_hero_image: string | null;
    storefront_hero_headline: string | null;
    storefront_logo: string | null;
    storefront_logo_show_name: boolean;
}

export default function StorefrontSettingsPage() {
    const { t } = useI18n();
    const m = t.storefront.dashboard.settings;
    const [loading, setLoading] = useState(true);

    const [slug, setSlug] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [banner, setBanner] = useState('');
    const [heroImage, setHeroImage] = useState('');
    const [heroHeadline, setHeroHeadline] = useState('');
    const [logo, setLogo] = useState('');
    const [logoShowName, setLogoShowName] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        fetchWithAuth('/tenants/storefront-settings')
            .then((data: StorefrontSettings) => {
                setSlug(data.storefront_slug || '');
                setEnabled(data.storefront_enabled ?? false);
                setBanner(data.storefront_banner || '');
                setHeroImage(data.storefront_hero_image || '');
                setHeroHeadline(data.storefront_hero_headline || '');
                setLogo(data.storefront_logo || '');
                setLogoShowName(data.storefront_logo_show_name ?? true);
            })
            .catch((err) => console.error('Failed to load settings', err))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        try {
            const updated: StorefrontSettings = await fetchWithAuth('/tenants/storefront-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storefront_slug: slug.trim() || null,
                    storefront_enabled: enabled,
                    storefront_banner: banner.trim() || null,
                    storefront_hero_image: heroImage.trim() || null,
                    storefront_hero_headline: heroHeadline.trim() || null,
                    storefront_logo: logo.trim() || null,
                    storefront_logo_show_name: logoShowName,
                }),
            });
            setSlug(updated.storefront_slug || '');
            setEnabled(updated.storefront_enabled ?? false);
            setBanner(updated.storefront_banner || '');
            setHeroImage(updated.storefront_hero_image || '');
            setHeroHeadline(updated.storefront_hero_headline || '');
            setLogo(updated.storefront_logo || '');
            setLogoShowName(updated.storefront_logo_show_name ?? true);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            setSaveError(err.message || m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const publicStoreUrl =
        isBrowser && slug ? `${globalThis.window.location.origin}/store/${slug}` : null;

    /**
     * The upload control's own copy is the same for both images; only the
     * heading, hints and crop title differ, and those live with the field they
     * describe.
     */
    const imageLabels = (field: {
        label: string;
        placeholder: string;
        hint: string;
        optional: string;
        cropTitle: string;
    }): StorefrontImageFieldLabels => ({
        ...m.imageField,
        label: field.label,
        hint: field.hint,
        optional: field.optional,
        cropTitle: field.cropTitle,
        urlPlaceholder: field.placeholder,
    });

    return (
        <PageShell maxWidth="wide">
            {/* The form wraps the header so Save can live in `PageHeader`
                actions and still submit it. It used to sit at the very bottom
                of a single ~1600px column, which meant scrolling the whole
                page to commit a one-field change. */}
            <form onSubmit={handleSave} className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.storefront,
                        'storefront',
                        [{ label: t.storefront.dashboard.orders.title, href: routes.storefront.root }],
                        m.title,
                    )}
                    actions={
                        loading ? null : (
                            <>
                                {saveSuccess && (
                                    <span role="status" className="text-xs font-medium text-success-text">
                                        {m.savedExclaim}
                                    </span>
                                )}
                                <Button
                                    type="submit"
                                    size="sm"
                                    loading={saving}
                                    icon={<Save className="w-4 h-4" />}
                                >
                                    {saving ? m.savingAlt : m.save}
                                </Button>
                            </>
                        )
                    }
                />

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="animate-spin w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full" />
                    </div>
                ) : (
                    <>
                        {saveError && <Alert tone="danger">{saveError}</Alert>}

                        {/* Two columns from `lg` up: the three text sections
                            stack on the left while the images — by far the
                            tallest thing here — take the right, so the whole
                            form fits one 1366×768 screen. */}
                        <div className="grid items-start gap-3 lg:grid-cols-2">
                            <div className="space-y-3">
                                <CompactSection title={m.sections.address}>
                                    {/* A `div`, not a `<label htmlFor>`: `Switch`
                                        renders a `<button>`, which is not
                                        labelable, so a `for` pointing at it
                                        would promise a click target the browser
                                        never wires up. The switch carries its
                                        own `aria-label` instead. */}
                                    <div className="flex min-h-touch items-center justify-between gap-4 pb-2">
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{m.enable.title}</p>
                                            <p className="text-xs text-gray-500">{m.enable.description}</p>
                                        </div>
                                        <Switch
                                            id="storefront-enabled"
                                            checked={enabled}
                                            onCheckedChange={setEnabled}
                                            aria-label={m.enable.toggleAria}
                                        />
                                    </div>

                                    <Field
                                        label={m.slug.label}
                                        htmlFor="store-slug"
                                        hint={m.slug.hint}
                                        className="border-t border-gray-100 pt-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="whitespace-nowrap text-xs text-gray-400">
                                                {m.slug.prefix}
                                            </span>
                                            <Input
                                                id="store-slug"
                                                type="text"
                                                value={slug}
                                                onChange={(e) =>
                                                    setSlug(
                                                        e.target.value
                                                            .toLowerCase()
                                                            .replace(/[^a-z0-9-]/g, '')
                                                            .slice(0, 50),
                                                    )
                                                }
                                                placeholder={m.slug.placeholder}
                                                maxLength={50}
                                                className="flex-1"
                                            />
                                        </div>
                                    </Field>

                                    {/* One line where a 56px callout box used
                                        to be — the address is worth showing,
                                        not worth a panel. */}
                                    {publicStoreUrl && (
                                        <a
                                            href={publicStoreUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={m.publicUrl.open}
                                            className="mt-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                                        >
                                            <Globe className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                                            <span className="truncate">{publicStoreUrl}</span>
                                            <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                                        </a>
                                    )}
                                </CompactSection>

                                <CompactSection title={m.sections.homepage} className="space-y-3">
                                    <Field
                                        label={m.heroHeadline.label}
                                        htmlFor="store-hero-headline"
                                        hint={`${m.heroHeadline.hint} ${m.heroHeadline.optional}`}
                                    >
                                        <Input
                                            id="store-hero-headline"
                                            type="text"
                                            value={heroHeadline}
                                            onChange={(e) => setHeroHeadline(e.target.value)}
                                            placeholder={m.heroHeadline.placeholder}
                                            className="w-full"
                                        />
                                    </Field>

                                    <Field
                                        label={m.banner.label}
                                        htmlFor="store-banner"
                                        hint={`${m.banner.hint} ${m.banner.optional}`}
                                    >
                                        <Textarea
                                            id="store-banner"
                                            value={banner}
                                            onChange={(e) => setBanner(e.target.value)}
                                            placeholder={m.banner.placeholder}
                                            rows={2}
                                            className="w-full resize-none"
                                        />
                                    </Field>
                                </CompactSection>
                            </div>

                            <CompactSection title={m.sections.images} className="space-y-3">
                                <StorefrontImageField
                                    kind="hero"
                                    value={heroImage}
                                    onChange={setHeroImage}
                                    inputId="store-hero-image"
                                    labels={imageLabels(m.heroImage)}
                                />

                                <div className="space-y-2 border-t border-gray-100 pt-3">
                                    <StorefrontImageField
                                        kind="logo"
                                        value={logo}
                                        onChange={setLogo}
                                        inputId="store-logo"
                                        labels={imageLabels(m.logo)}
                                    />

                                    {/* Only offered once there is a logo: with nothing
                                        but a name to show, hiding it would leave the
                                        storefront header empty. */}
                                    {logo.trim() && (
                                        <div>
                                            <label
                                                htmlFor="store-logo-show-name"
                                                className="flex items-center gap-2 text-sm text-gray-700"
                                            >
                                                <Checkbox
                                                    id="store-logo-show-name"
                                                    checked={logoShowName}
                                                    onChange={(e) => setLogoShowName(e.target.checked)}
                                                />
                                                {m.logo.showName}
                                            </label>
                                            <p className="text-xs text-gray-400 mt-1 ms-6">
                                                {m.logo.showNameHint}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </CompactSection>
                        </div>
                    </>
                )}
            </form>
        </PageShell>
    );
}
