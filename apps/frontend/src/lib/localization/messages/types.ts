import { enMessages } from './en';

type RecursiveStringTree<T> = {
    [K in keyof T]: T[K] extends string ? string : RecursiveStringTree<T[K]>;
};

export type MessageDictionary = RecursiveStringTree<typeof enMessages>;