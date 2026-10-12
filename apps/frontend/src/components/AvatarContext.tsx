'use client';

import { createContext, useContext, useCallback, useState } from 'react';
import { uploadProfileAvatar } from '@/lib/uploads/profile-avatar';

interface AvatarContextValue {
    isUploading: boolean;
    cropComplete: boolean;
    uploadAvatar: (croppedFile: File) => Promise<string | null>;
    reset: () => void;
}

const AvatarContext = createContext<AvatarContextValue>({
    isUploading: false,
    cropComplete: false,
    uploadAvatar: async () => null,
    reset: () => {},
});

export function AvatarProvider({ children }: { children: React.ReactNode }) {
    const [isUploading, setIsUploading] = useState(false);
    const [cropComplete, setCropComplete] = useState(false);

    const uploadAvatar = useCallback(async (croppedFile: File) => {
        setIsUploading(true);
        setCropComplete(true);

        try {
            return await uploadProfileAvatar(croppedFile);
        } catch {
            return null;
        } finally {
            setIsUploading(false);
        }
    }, []);

    const reset = useCallback(() => {
        setCropComplete(false);
    }, []);

    return (
        <AvatarContext.Provider value={{ isUploading, cropComplete, uploadAvatar, reset }}>
            {children}
        </AvatarContext.Provider>
    );
}

export function useAvatar() {
    return useContext(AvatarContext);
}
