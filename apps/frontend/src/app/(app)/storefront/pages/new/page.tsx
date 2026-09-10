'use client';

import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import StorefrontPageEditor from '@/components/storefront/StorefrontPageEditor';
import { useI18n } from '@/lib/i18n';

export default function NewStorefrontPagePage() {
    const { t } = useI18n();

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader title={t.storefront.pages.newTitle} />
                <StorefrontPageEditor />
            </div>
        </PageShell>
    );
}
