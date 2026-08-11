import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import CareersShell from './CareersShell';

export const metadata: Metadata = {
    title: 'Careers — ERP71',
    description:
        'Browse open roles at companies running on ERP71 and track every application from one account.',
};

export default function CareersLayout({ children }: { children: ReactNode }) {
    return <CareersShell>{children}</CareersShell>;
}
