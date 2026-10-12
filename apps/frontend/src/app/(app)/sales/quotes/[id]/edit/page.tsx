'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import QuotationEntryForm from '../../QuotationEntryForm';

export default function EditQuotationPage() {
    const { id } = useParams();
    return (
        <Suspense fallback={null}>
            <QuotationEntryForm quoteId={id as string} />
        </Suspense>
    );
}
