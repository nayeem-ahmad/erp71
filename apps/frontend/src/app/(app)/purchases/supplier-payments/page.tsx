'use client';

import { Suspense } from 'react';
import { useI18n } from '@/lib/i18n';
import { PartyPaymentsWorkspace, supplierPaymentsAdapter } from '@/components/payments/party-payments';

export default function SupplierPaymentsPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.supplierPayments.loading}</div>}>
            <PartyPaymentsWorkspace adapter={supplierPaymentsAdapter} />
        </Suspense>
    );
}
