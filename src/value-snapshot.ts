// Turns an arbitrary runtime value (function arguments, thrown values) into a small, JSON-safe
// picture of itself. Serialization is the expensive and risky part of capturing arguments: NetSuite
// records and search results are large and circular, strings can be huge, and a field caps out at
// ~4000 characters. Every limit below exists so a snapshot stays cheap and bounded.

export interface ValueSnapshotOptions {
    /** How many levels of nested objects and arrays to descend. */
    maxDepth?: number;
    /** Longest string kept before it is cut. */
    maxStringLength?: number;
    /** How many array items are kept. */
    maxArrayLength?: number;
    /** How many object keys are kept. */
    maxObjectKeys?: number;
    /** Upper bound on the JSON size of the whole snapshot. */
    maxTotalLength?: number;
}

const DEFAULT_SNAPSHOT_OPTIONS: Required<ValueSnapshotOptions> = {
    maxDepth: 2,
    maxStringLength: 200,
    maxArrayLength: 5,
    maxObjectKeys: 20,
    maxTotalLength: 2000,
};

function resolveOptions(options?: ValueSnapshotOptions): Required<ValueSnapshotOptions> {
    return { ...DEFAULT_SNAPSHOT_OPTIONS, ...(options || {}) };
}

function truncateString(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength)}… (+${value.length - maxLength} chars)`;
}

function isNetSuiteRecordLike(value: object): value is { type?: unknown; recordType?: unknown; id?: unknown } {
    return typeof (value as { getValue?: unknown }).getValue === 'function';
}

function snapshotNetSuiteRecordLike(value: { type?: unknown; recordType?: unknown; id?: unknown }): Record<string, unknown> {
    const recordType = value.type !== undefined ? value.type : value.recordType;
    return {
        recordType: recordType === undefined || recordType === null ? '' : String(recordType),
        id: value.id === undefined || value.id === null ? null : value.id,
    };
}

function snapshotValueAtDepth(value: unknown, depth: number, options: Required<ValueSnapshotOptions>, seen: Set<object>): unknown {
    if (value === null || value === undefined) {
        return null;
    }

    switch (typeof value) {
        case 'string':
            return truncateString(value, options.maxStringLength);
        case 'number':
            return Number.isFinite(value) ? value : String(value);
        case 'boolean':
            return value;
        case 'bigint':
            return `${value.toString()}n`;
        case 'symbol':
            return value.toString();
        case 'function':
            return `[function ${(value as { name?: string }).name || 'anonymous'}]`;
        default:
            break;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '[invalid date]' : value.toISOString();
    }

    if (value instanceof Error) {
        return {
            errorName: value.name,
            message: truncateString(value.message, options.maxStringLength),
        };
    }

    const objectValue = value as object;
    if (isNetSuiteRecordLike(objectValue)) {
        return snapshotNetSuiteRecordLike(objectValue);
    }

    if (seen.has(objectValue)) {
        return '[circular]';
    }

    if (Array.isArray(objectValue)) {
        if (depth >= options.maxDepth) {
            return `[array ${objectValue.length}]`;
        }

        seen.add(objectValue);
        const items = objectValue.slice(0, options.maxArrayLength).map((item) => snapshotValueAtDepth(item, depth + 1, options, seen));
        seen.delete(objectValue);
        if (objectValue.length > options.maxArrayLength) {
            items.push(`… ${objectValue.length - options.maxArrayLength} more`);
        }

        return items;
    }

    if (depth >= options.maxDepth) {
        return '[object]';
    }

    seen.add(objectValue);
    const snapshot: Record<string, unknown> = {};
    const keys = Object.keys(objectValue);
    keys.slice(0, options.maxObjectKeys).forEach((key) => {
        snapshot[key] = snapshotValueAtDepth((objectValue as Record<string, unknown>)[key], depth + 1, options, seen);
    });
    seen.delete(objectValue);
    if (keys.length > options.maxObjectKeys) {
        snapshot['…'] = `${keys.length - options.maxObjectKeys} more keys`;
    }

    return snapshot;
}

function measureJson(value: unknown): number {
    try {
        const json = JSON.stringify(value);
        return typeof json === 'string' ? json.length : 0;
    } catch (_error) {
        return Number.POSITIVE_INFINITY;
    }
}

function tightenOptions(options: Required<ValueSnapshotOptions>): Required<ValueSnapshotOptions> {
    return {
        ...options,
        maxDepth: Math.max(1, options.maxDepth - 1),
        maxStringLength: Math.max(40, Math.floor(options.maxStringLength / 2)),
        maxArrayLength: Math.max(2, Math.floor(options.maxArrayLength / 2)),
        maxObjectKeys: Math.max(5, Math.floor(options.maxObjectKeys / 2)),
    };
}

/**
 * A bounded, JSON-safe picture of `value`. Strings are cut, arrays and objects are trimmed to a few
 * entries and a couple of levels, NetSuite records collapse to `{ recordType, id }`, circular
 * references become a marker. When the result is still larger than `maxTotalLength` the limits are
 * halved and the value re-snapshotted, so the output size is predictable whatever goes in.
 */
export function snapshotValue(value: unknown, options?: ValueSnapshotOptions): unknown {
    let currentOptions = resolveOptions(options);
    let snapshot = snapshotValueAtDepth(value, 0, currentOptions, new Set<object>());

    for (let attempt = 0; attempt < 3 && measureJson(snapshot) > currentOptions.maxTotalLength; attempt += 1) {
        currentOptions = tightenOptions(currentOptions);
        snapshot = snapshotValueAtDepth(value, 0, currentOptions, new Set<object>());
    }

    if (measureJson(snapshot) > currentOptions.maxTotalLength) {
        return `[value too large: ${measureJson(snapshot)} chars]`;
    }

    return snapshot;
}

/**
 * Snapshots a function's arguments by parameter name: `{ id: 12, options: { … } }`. A parameter
 * the build could not name (a destructured pattern) is reported as `arg<index>`.
 */
export function snapshotFunctionArguments(parameterNames: readonly string[], argumentValues: readonly unknown[], options?: ValueSnapshotOptions): Record<string, unknown> {
    const named: Record<string, unknown> = {};
    const count = Math.max(parameterNames.length, argumentValues.length);
    for (let index = 0; index < count; index += 1) {
        const parameterName = parameterNames[index] || `arg${index}`;
        named[parameterName] = argumentValues[index];
    }

    const snapshot = snapshotValue(named, options);
    return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? snapshot as Record<string, unknown>
        : { '…': snapshot };
}
