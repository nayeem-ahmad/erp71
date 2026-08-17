'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import { routes } from '@/lib/routes';
import {
    careersApi,
    clearCareersSession,
    getCareersSessionProfile,
    type CareersSessionProfile,
} from '@/lib/careers-api';

/**
 * Chrome shared by every careers page.
 *
 * Not the `(app)` shell: these pages are served to people who hold no ERP
 * session and belong to no workspace, so there is no sidebar, no tenant
 * switcher and no store context to render.
 */
export default function CareersShell({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [applicant, setApplicant] = useState<CareersSessionProfile | null>(null);

    // Read after mount: `localStorage` does not exist during the server render,
    // and reading it in the initial state would produce a hydration mismatch.
    useEffect(() => {
        setApplicant(getCareersSessionProfile());
    }, [pathname]);

    const signOut = async () => {
        try {
            await careersApi.logout();
        } catch {
            // A failed logout still clears the local session — the token is
            // useless to us either way, and the server bumps its version on the
            // next successful call.
        }
        clearCareersSession();
        setApplicant(null);
        router.push(routes.careers.root);
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
            <header className="border-b border-gray-200 bg-white">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
                    <Link
                        href={routes.careers.root}
                        className="inline-flex items-center gap-2 text-sm font-bold tracking-tight text-gray-950"
                    >
                        {/* Not decorative: the alt text supplies the "ERP71" half
                            of the link's accessible name, which now reads "ERP71 Careers". */}
                        <BrandLogo height={22} />
                        Careers
                    </Link>

                    <nav className="flex items-center gap-1.5 text-xs">
                        <Link
                            href={routes.careers.root}
                            className="rounded-md px-2.5 py-1.5 font-semibold text-gray-600 hover:bg-gray-100 max-md:min-h-touch max-md:inline-flex max-md:items-center"
                        >
                            Browse jobs
                        </Link>

                        {applicant ? (
                            <>
                                <Link
                                    href={routes.careers.portal}
                                    className="rounded-md px-2.5 py-1.5 font-semibold text-blue-600 hover:bg-blue-50 max-md:min-h-touch max-md:inline-flex max-md:items-center"
                                >
                                    My applications
                                </Link>
                                <button
                                    type="button"
                                    onClick={signOut}
                                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-semibold text-gray-600 hover:bg-gray-100 max-md:min-h-touch"
                                >
                                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span className="hidden sm:inline">Sign out</span>
                                </button>
                            </>
                        ) : (
                            <>
                                <Link
                                    href={routes.careers.login}
                                    className="rounded-md px-2.5 py-1.5 font-semibold text-gray-600 hover:bg-gray-100 max-md:min-h-touch max-md:inline-flex max-md:items-center"
                                >
                                    Sign in
                                </Link>
                                <Link
                                    href={routes.careers.register}
                                    className="rounded-md bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700 max-md:min-h-touch max-md:inline-flex max-md:items-center"
                                >
                                    Create account
                                </Link>
                            </>
                        )}
                    </nav>
                </div>
            </header>

            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 md:py-6">{children}</main>

            <footer className="border-t border-gray-200 bg-white">
                <div className="mx-auto max-w-5xl px-4 py-4 text-xs text-gray-500">
                    One profile, every company hiring on ERP71.
                </div>
            </footer>
        </div>
    );
}
