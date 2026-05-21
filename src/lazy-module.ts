export function defineLazyExport(target: Record<string, unknown>, exportName: string, getter: () => unknown): void {
    Object.defineProperty(target, exportName, {
        enumerable: true,
        configurable: true,
        get: getter,
    });
}