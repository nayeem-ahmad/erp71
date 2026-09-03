'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Gift, Link2, MessageCircle, Printer } from 'lucide-react';
import { Button, Textarea } from '@/components/ui';
import { toast } from '@/lib/toast';
import {
    buildPitch,
    buildQrDataUrl,
    buildSignupUrl,
    buildWhatsAppUrl,
    downloadQrPng,
    printOnePager,
    type OnePagerLabels,
} from '@/lib/referrals/share-kit';

export type ShareToolkitLabels = {
    referralCode: string;
    signupLink: string;
    copyCode: string;
    copyLink: string;
    codeCopied: string;
    linkCopied: string;
    copyFailed: string;
    pitchLabel: string;
    pitchHint: string;
    pitchTemplate: string;
    shareWhatsApp: string;
    qrTitle: string;
    qrHint: string;
    downloadQr: string;
    printOnePager: string;
    popupBlocked: string;
    onePager: OnePagerLabels;
};

type Props = {
    refereeName: string;
    referralCode: string;
    signupDiscount: number;
    contactEmail: string;
    labels: ShareToolkitLabels;
};

/**
 * Everything the partner needs to actually get the link in front of a shop owner.
 *
 * The pitch is a textarea rather than fixed copy on purpose: a partner selling to
 * a neighbour writes differently from one selling to a chain, and the default is
 * a starting point, not a script.
 */
export default function ShareToolkit({
    refereeName,
    referralCode,
    signupDiscount,
    contactEmail,
    labels,
}: Props) {
    const [qrDataUrl, setQrDataUrl] = useState('');

    // window is unavailable during SSR, so the URL is resolved after mount.
    const signupUrl = useMemo(() => {
        if (!referralCode || typeof window === 'undefined') return '';
        return buildSignupUrl(window.location.origin, referralCode);
    }, [referralCode]);

    const [pitch, setPitch] = useState('');
    // Re-seeds when the link resolves or the locale changes, but never clobbers an
    // edit the partner has already made to the message.
    const [pitchEdited, setPitchEdited] = useState(false);
    useEffect(() => {
        if (!signupUrl || pitchEdited) return;
        setPitch(buildPitch(labels.pitchTemplate, signupUrl));
    }, [signupUrl, labels.pitchTemplate, pitchEdited]);

    useEffect(() => {
        if (!signupUrl) return;
        let cancelled = false;
        buildQrDataUrl(signupUrl)
            .then((url) => {
                if (!cancelled) setQrDataUrl(url);
            })
            // A missing QR costs the partner one of four ways to share, not the page.
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [signupUrl]);

    const copyText = async (value: string, message: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(message);
        } catch {
            toast.error(labels.copyFailed);
        }
    };

    const onPrint = () => {
        const opened = printOnePager(
            {
                refereeName,
                referralCode,
                signupUrl,
                qrDataUrl,
                signupDiscount,
                contactEmail,
            },
            labels.onePager,
        );
        if (!opened) toast.error(labels.popupBlocked);
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                            <Gift className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-gray-900">{labels.referralCode}</p>
                            <p className="font-mono text-lg font-bold tracking-wider text-gray-900">
                                {referralCode}
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="secondary"
                        size="md"
                        icon={<Copy className="h-4 w-4" />}
                        onClick={() => void copyText(referralCode, labels.codeCopied)}
                        className="mt-4"
                    >
                        {labels.copyCode}
                    </Button>
                </div>

                <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                            <Link2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{labels.signupLink}</p>
                            <p className="truncate text-sm text-gray-500">{signupUrl}</p>
                        </div>
                    </div>
                    <Button
                        variant="secondary"
                        size="md"
                        icon={<Copy className="h-4 w-4" />}
                        onClick={() => void copyText(signupUrl, labels.linkCopied)}
                        className="mt-4"
                    >
                        {labels.copyLink}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm lg:col-span-2">
                    <p className="text-sm font-semibold text-gray-900">{labels.pitchLabel}</p>
                    <p className="mt-1 text-xs text-gray-500">{labels.pitchHint}</p>
                    <Textarea
                        value={pitch}
                        onChange={(event) => {
                            setPitch(event.target.value);
                            setPitchEdited(true);
                        }}
                        rows={4}
                        className="mt-3"
                        aria-label={labels.pitchLabel}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                        <a
                            href={buildWhatsAppUrl(pitch)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-touch items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                        >
                            <MessageCircle className="h-4 w-4" />
                            {labels.shareWhatsApp}
                        </a>
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<Copy className="h-4 w-4" />}
                            onClick={() => void copyText(pitch, labels.linkCopied)}
                        >
                            {labels.copyLink}
                        </Button>
                    </div>
                </div>

                <div className="rounded-lg border border-gray-100 bg-white p-4 text-center shadow-sm">
                    <p className="text-sm font-semibold text-gray-900">{labels.qrTitle}</p>
                    <p className="mt-1 text-xs text-gray-500">{labels.qrHint}</p>
                    {qrDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a data: URI has nothing for next/image to optimise
                        <img
                            src={qrDataUrl}
                            alt={signupUrl}
                            className="mx-auto mt-3 h-36 w-36 rounded-md border border-gray-100"
                        />
                    ) : (
                        <div className="mx-auto mt-3 h-36 w-36 animate-pulse rounded-md bg-gray-100" />
                    )}
                    <div className="mt-3 flex flex-col gap-2">
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<Download className="h-4 w-4" />}
                            disabled={!qrDataUrl}
                            onClick={() => downloadQrPng(qrDataUrl, referralCode)}
                        >
                            {labels.downloadQr}
                        </Button>
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<Printer className="h-4 w-4" />}
                            disabled={!qrDataUrl}
                            onClick={onPrint}
                        >
                            {labels.printOnePager}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
