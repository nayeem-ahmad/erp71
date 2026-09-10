'use client';

import ImageCropModal from './ImageCropModal';

type AvatarCropModalProps = {
    imageSrc: string;
    open: boolean;
    title: string;
    confirmLabel: string;
    cancelLabel: string;
    onClose: () => void;
    onConfirm: (file: File) => Promise<void>;
};

/**
 * A person's photo, cropped square and shown round.
 *
 * Thin on purpose: the cropper, its zoom control and the modal chrome all live
 * in `ImageCropModal`, which the storefront hero and logo fields use with
 * different framing. This fixes the two choices an avatar never varies —
 * square, round — so no caller has to remember them.
 */
export default function AvatarCropModal({
    imageSrc,
    open,
    title,
    confirmLabel,
    cancelLabel,
    onClose,
    onConfirm,
}: Readonly<AvatarCropModalProps>) {
    if (!open) return null;

    return (
        <ImageCropModal
            imageSrc={imageSrc}
            title={title}
            aspect={1}
            cropShape="round"
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            zoomLabel="Zoom"
            fileName="avatar.jpg"
            onClose={onClose}
            onConfirm={onConfirm}
        />
    );
}
