export type PromiseCapableFunction = ((...args: any[]) => unknown) & {
    promise?: (...args: any[]) => unknown;
};

export function wrapFunction<TFunction extends PromiseCapableFunction>(
    sync: (...args: Parameters<TFunction>) => ReturnType<TFunction>,
    async?: TFunction['promise'],
): TFunction {
    return Object.assign(sync, async ? { promise: async } : {}) as TFunction;
}