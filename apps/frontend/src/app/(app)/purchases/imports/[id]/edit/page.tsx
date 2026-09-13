'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageShell } from '@/components/ui';
import ShipmentForm from '../../_components/ShipmentForm';

export default function EditImportShipmentPage() {
    const { t } = useI18n();
    const { id } = useParams();
    const [shipment, setShipment] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getImportShipment(id as string)
            .then(setShipment)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <PageShell><p className="text-sm text-gray-500">{t.common.loading}</p></PageShell>;
    if (!shipment) return <PageShell><p className="text-sm text-gray-500">{t.common.noData}</p></PageShell>;

    return <ShipmentForm shipment={shipment} />;
}
