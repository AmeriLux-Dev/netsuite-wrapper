export function defineLazyExport(target: Record<string, unknown>, exportName: string, getter: () => unknown): void {
    Object.defineProperty(target, exportName, {
        enumerable: true,
        configurable: true,
        get: getter,
    });
}

/**
 * Forwards every member of the underlying NetSuite module that the wrapper does not already
 * instrument, so the wrapper behaves like a drop-in replacement. Members the wrapper defines
 * itself (the instrumented exports) are left untouched; everything else resolves lazily to the
 * real module on each access.
 */
export function forwardModuleExports(target: Record<string, unknown>, getModule: () => unknown): void {
    const source = getModule();
    if (!source || typeof source !== 'object') {
        return;
    }

    for (const key of Object.keys(source as Record<string, unknown>)) {
        if (Object.prototype.hasOwnProperty.call(target, key)) {
            continue;
        }

        defineLazyExport(target, key, () => (getModule() as Record<string, unknown>)[key]);
    }
}