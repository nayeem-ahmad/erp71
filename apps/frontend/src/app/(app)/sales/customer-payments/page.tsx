'use client';

import { Suspense } from 'react';
import { useI18n } from '@/lib/i18n';
import { PartyPaymentsWorkspace, customerPaymentsAdapter } from '@/components/payments/party-payments';

export default function CustomerPaymentsPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.customerPayments.loading}</div>}>
            <PartyPaymentsWorkspace adapter={customerPaymentsAdapter} />
        </Suspense>
    );
}
