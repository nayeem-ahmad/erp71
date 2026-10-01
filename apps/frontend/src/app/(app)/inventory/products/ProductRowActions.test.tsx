'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import ProductRowActions from './ProductRowActions';

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: { children: React.ReactNode; href: string; title?: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

const product = { id: 'prod-1', name: 'Widget A' };

describe('ProductRowActions', () => {
    it('hides Merge into… when canMerge is false', () => {
        render(
            <ProductRowActions
                product={product}
                canMerge={false}
                onEdit={() => {}}
                onMerge={() => {}}
                onDelete={() => {}}
            />,
        );
        expect(screen.queryByTitle('Merge into…')).not.toBeInTheDocument();
        expect(screen.getByTitle('Edit product')).toBeInTheDocument();
        expect(screen.getByTitle('Delete')).toBeInTheDocument();
    });

    it('shows Merge into… between transfer history and delete when canMerge', () => {
        render(
            <ProductRowActions
                product={product}
                canMerge
                onEdit={() => {}}
                onMerge={() => {}}
                onDelete={() => {}}
            />,
        );
        const merge = screen.getByTitle('Merge into…');
        const transfer = screen.getByTitle('View transfer history');
        const del = screen.getByTitle('Delete');
        expect(merge.compareDocumentPosition(transfer) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
        expect(merge.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('calls onMerge when Merge into… is clicked', () => {
        const onMerge = jest.fn();
        render(
            <ProductRowActions
                product={product}
                canMerge
                onEdit={() => {}}
                onMerge={onMerge}
                onDelete={() => {}}
            />,
        );
        fireEvent.click(screen.getByTitle('Merge into…'));
        expect(onMerge).toHaveBeenCalledTimes(1);
    });
});
