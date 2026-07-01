'use client';

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string, defaultValue = false) {
    const [matches, setMatches] = useState(defaultValue);

    useEffect(() => {
        const mediaQuery = window.matchMedia(query);
        const update = () => setMatches(mediaQuery.matches);

        update();
        mediaQuery.addEventListener('change', update);
        return () => mediaQuery.removeEventListener('change', update);
    }, [query]);

    return matches;
}

export function useIsMdUp() {
    return useMediaQuery('(min-width: 768px)', true);
}