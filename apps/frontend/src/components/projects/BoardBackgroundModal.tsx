'use client';

import { useRef, useState } from 'react';
import { Check, ImageUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import {
    backgroundSwatchClass,
    boardBackgroundKind,
    BOARD_BACKGROUND_COLORS,
    type BoardBackground,
    type BoardBackgroundColor,
} from './board-background';

/**
 * The JSON body limit is 5 MB and base64 inflates a file by a third, so a file
 * this size is the largest that can actually arrive. Checked here as well as on
 * the server so a picture that cannot land is refused before it is read, rather
 * than after a slow upload ends in a 413.
 */
export const MAX_BACKGROUND_BYTES = 3.5 * 1024 * 1024;

/** What the server stores, and therefore what the picker may offer. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });

interface BoardBackgroundModalProps {
    boardId: string;
    /** The board as it looks now — the picker marks what is already chosen. */
    background: BoardBackground;
    onClose: () => void;
    /** Called with the board the API returned, so the page repaints without a reload. */
    onChanged: (board: BoardBackground) => void;
}

/**
 * Pick a colour for the board, or upload a picture for it.
 *
 * A modal rather than the appearance popover next to it, because these are two
 * different kinds of setting and mixing them would be a lie: everything in
 * `BoardViewMenu` is this browser's preference and applies to every board,
 * while this is the board's own and everyone in the workspace sees it. The
 * board is not visible behind a modal, which is a real cost — but it is the
 * honest cost of a change that is about to alter what a colleague sees too.
 *
 * Each choice saves on click. There is no Save button for the same reason the
 * appearance panel has none: a background is judged by looking at it, and a
 * two-step commit would mean choosing blind.
 */
export default function BoardBackgroundModal({
    boardId,
    background,
    onClose,
    onChanged,
}: Readonly<BoardBackgroundModalProps>) {
    const { t } = useI18n();
    const m = t.projects.boards.background;

    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const kind = boardBackgroundKind(background);
    const selectedColor = kind === 'color' ? background.background_color : null;

    /** One guard for all three actions: two in flight would race to be the background. */
    const run = async (action: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true);
        try {
            const board = (await action()) as BoardBackground;
            onChanged(board);
            toast.success(m.saved);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setBusy(false);
        }
    };

    const pickColor = (color: BoardBackgroundColor) =>
        run(() => api.updateBoard(boardId, { backgroundColor: color }));

    const upload = async (file: File | undefined) => {
        if (!file) return;
        if (!ACCEPTED_TYPES.includes(file.type)) {
            toast.error(m.notAnImage);
            return;
        }
        if (file.size > MAX_BACKGROUND_BYTES) {
            toast.error(m.tooLarge);
            return;
        }
        let dataUrl: string;
        try {
            dataUrl = await readAsDataUrl(file);
        } catch {
            toast.error(m.uploadFailed);
            return;
        }
        await run(() =>
            api.setBoardBackgroundImage(boardId, {
                imageBase64: dataUrl,
                mimeType: file.type,
                fileName: file.name,
            }),
        );
    };

    return (
        <ModalShell size="sm" onBackdropClick={busy ? undefined : onClose}>
            <ModalHeader
                title={m.title}
                subtitle={m.hint}
                onClose={busy ? undefined : onClose}
                closeLabel={t.common.close}
            />

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <fieldset disabled={busy}>
                    <legend className="mb-2 text-xs font-medium text-gray-600">{m.colors}</legend>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {BOARD_BACKGROUND_COLORS.map((color) => {
                            const selected = color === selectedColor;
                            return (
                                <button
                                    key={color}
                                    type="button"
                                    aria-pressed={selected}
                                    aria-label={m.colorNames[color]}
                                    title={m.colorNames[color]}
                                    onClick={() => pickColor(color)}
                                    className={`flex h-12 min-h-touch items-center justify-center rounded-md ring-offset-2 transition-shadow disabled:opacity-60 ${backgroundSwatchClass(
                                        color,
                                    )} ${selected ? 'ring-2 ring-blue-600' : 'hover:ring-2 hover:ring-gray-300'}`}
                                >
                                    {/* The tick, not the ring, is what a screen
                                        reader's user cannot see and a
                                        colour-blind reader may not either. */}
                                    {selected && <Check className="h-4 w-4 text-white" aria-hidden />}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>

                <div className="border-t border-gray-100 pt-3">
                    <p className="mb-2 text-xs font-medium text-gray-600">{m.image}</p>

                    {kind === 'image' && background.background_image_url && (
                        // eslint-disable-next-line @next/next/no-img-element -- a Cloudinary URL from tenant data, not a build-time asset next/image could optimise
                        <img
                            src={background.background_image_url}
                            alt={m.currentImage}
                            className="mb-2 h-24 w-full rounded-md object-cover"
                        />
                    )}

                    <input
                        ref={fileRef}
                        type="file"
                        accept={ACCEPTED_TYPES.join(',')}
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            // Reset first, so picking the same file twice still fires.
                            event.target.value = '';
                            void upload(file);
                        }}
                    />
                    <Button
                        variant="secondary"
                        className="min-h-touch w-full"
                        disabled={busy}
                        onClick={() => fileRef.current?.click()}
                    >
                        {busy ? (
                            <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                        ) : (
                            <ImageUp className="h-4 w-4" />
                        )}
                        {kind === 'image' ? m.replaceImage : m.uploadImage}
                    </Button>
                    <p className="mt-1.5 text-xs text-gray-400">{m.fileHint}</p>
                </div>
            </div>

            <ModalFooter>
                {/* Offered only when there is something to remove — a control
                    that does nothing still has to be read before it can be
                    ignored, the same reason Reset hides in the view panel. */}
                {kind !== 'default' && (
                    <Button
                        variant="ghost"
                        className="min-h-touch"
                        disabled={busy}
                        onClick={() => run(() => api.clearBoardBackground(boardId))}
                    >
                        <Trash2 className="h-4 w-4" />
                        {m.remove}
                    </Button>
                )}
                <Button variant="secondary" className="min-h-touch" disabled={busy} onClick={onClose}>
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
