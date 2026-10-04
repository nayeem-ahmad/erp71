'use client';

import { useRef, useState } from 'react';
import { Check, ImageUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { directUpload, withServerFallback, type CloudinaryUpload } from '@/lib/uploads/direct-upload';
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

/**
 * What wears the background. A board and a sprint store it the same way — the
 * same three columns behind the same rules — and differ only in the endpoints.
 */
export interface BackgroundTarget {
    kind: 'board' | 'sprint';
    id: string;
}

/** The file itself (the fallback route), or where the browser already put it. */
type ImageUpload = { imageBase64: string; mimeType?: string; fileName?: string } | CloudinaryUpload;

function backgroundApi({ kind, id }: BackgroundTarget) {
    return kind === 'sprint'
        ? {
              setColor: (color: BoardBackgroundColor) => api.updateSprint(id, { backgroundColor: color }),
              setImage: (data: ImageUpload) => api.setSprintBackgroundImage(id, data),
              clear: () => api.clearSprintBackground(id),
          }
        : {
              setColor: (color: BoardBackgroundColor) => api.updateBoard(id, { backgroundColor: color }),
              setImage: (data: ImageUpload) => api.setBoardBackgroundImage(id, data),
              clear: () => api.clearBoardBackground(id),
          };
}

interface BoardBackgroundPickerProps {
    target: BackgroundTarget;
    /** The board or sprint as it looks now — the picker marks what is already chosen. */
    background: BoardBackground;
    /** Called with the row the API returned, so the page repaints without a reload. */
    onChanged: (board: BoardBackground) => void;
}

/**
 * Pick a colour for a board or a sprint, or upload a picture for it.
 *
 * Unlike the appearance controls it sits beside, this is the board's own and
 * everyone in the workspace sees it — which is why the two are separate
 * sections of the settings panel rather than one list of knobs.
 *
 * Each choice saves on click. There is no Save button for the same reason the
 * appearance section has none: a background is judged by looking at it, and a
 * two-step commit would mean choosing blind.
 */
export default function BoardBackgroundPicker({
    target,
    background,
    onChanged,
}: Readonly<BoardBackgroundPickerProps>) {
    const { t } = useI18n();
    const m = t.projects.boards.background;
    const ofSprint = target.kind === 'sprint';
    const hint = ofSprint ? t.projects.sprint.backgroundHint : m.hint;
    const currentImage = ofSprint ? t.projects.sprint.currentBackground : m.currentImage;
    const endpoints = backgroundApi(target);

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
        run(() => endpoints.setColor(color));

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
        // Straight to Cloudinary, then only the result to the API, which checks
        // it is in this tenant's folder. If any of that fails, the old route:
        // the whole picture as base64, uploaded by the API.
        await run(() =>
            withServerFallback(
                async () =>
                    endpoints.setImage(
                        await directUpload(file, ofSprint ? 'sprint-background' : 'board-background'),
                    ),
                async () => {
                    let dataUrl: string;
                    try {
                        dataUrl = await readAsDataUrl(file);
                    } catch {
                        throw new Error(m.uploadFailed);
                    }
                    return endpoints.setImage({
                        imageBase64: dataUrl,
                        mimeType: file.type,
                        fileName: file.name,
                    });
                },
            ),
        );
    };

    return (
        <div className="space-y-3">
            <p className="text-xs text-gray-500">{hint}</p>

            <fieldset disabled={busy}>
                <legend className="mb-2 text-xs font-medium text-gray-600">{m.colors}</legend>
                <div className="grid grid-cols-6 gap-2">
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
                                className={`flex h-10 min-h-touch items-center justify-center rounded-md ring-offset-2 transition-shadow disabled:opacity-60 ${backgroundSwatchClass(
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
                        alt={currentImage}
                        className="mb-2 h-20 w-full rounded-md object-cover"
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
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="secondary"
                        className="min-h-touch"
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

                    {/* Offered only when there is something to remove — a
                        control that does nothing still has to be read before it
                        can be ignored, the same reason Reset hides above. */}
                    {kind !== 'default' && (
                        <Button
                            variant="ghost"
                            className="min-h-touch"
                            disabled={busy}
                            onClick={() => run(() => endpoints.clear())}
                        >
                            <Trash2 className="h-4 w-4" />
                            {m.remove}
                        </Button>
                    )}
                </div>
                <p className="mt-1.5 text-xs text-gray-400">{m.fileHint}</p>
            </div>
        </div>
    );
}
