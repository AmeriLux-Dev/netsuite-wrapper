export function defineLazyExport(target: Record<string, unknown>, exportName: string, getter: () => unknown): void {
    Object.defineProperty(target, exportName, {
        enumerable: true,
        configurable: true,
        get: getter,
    });
}

/** Every member name an object answers: its own and inherited ones, enumerable or not. */
function listMemberNames(source: object): string[] {
    const names = new Set<string>();
    for (let current: object | null = source; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
        for (const name of Object.getOwnPropertyNames(current)) {
            if (name !== 'constructor') {
                names.add(name);
            }
        }
    }

    return Array.from(names);
}

/** True for an export the wrapper declared for its types but left for the N module to fill. */
function isPlaceholderExport(target: Record<string, unknown>, name: string): boolean {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    return Boolean(descriptor) && !descriptor!.get && descriptor!.value === undefined;
}

/**
 * Makes a wrapper module a drop-in replacement for its N module: every member the wrapper does not
 * instrument resolves to the N module's own, read on each access. Build tools swap the N module for
 * the wrapper in every file of a bundle, including code the application did not write, so a
 * member missing here would be missing for all of it.
 *
 * Forwarded: every member the N module answers (own, inherited or non-enumerable), and every
 * placeholder export the wrapper declared for its types (`export const Type = undefined as ...`),
 * even when the N module does not list it. Instrumented exports are left alone. If the N module
 * cannot be loaded yet, the placeholders are still forwarded.
 */
export function forwardModuleExports(target: Record<string, unknown>, getModule: () => unknown): void {
    const names = new Set<string>(Object.getOwnPropertyNames(target).filter((name) => isPlaceholderExport(target, name)));
    try {
        const source = getModule();
        if (source && typeof source === 'object') {
            for (const name of listMemberNames(source as object)) {
                names.add(name);
            }
        }
    } catch (_error) {
        // Outside NetSuite (a test without an N/* stub) the module is not there; members read later still resolve.
    }

    for (const name of Array.from(names)) {
        if (name === '__esModule' || (Object.prototype.hasOwnProperty.call(target, name) && !isPlaceholderExport(target, name))) {
            continue;
        }

        try {
            defineLazyExport(target, name, () => (getModule() as Record<string, unknown>)[name]);
        } catch (_error) {
            // A member that cannot be redefined keeps whatever it had; loading the wrapper must not fail over one.
        }
    }
}