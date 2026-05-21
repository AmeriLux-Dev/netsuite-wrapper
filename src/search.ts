import type * as NsSearch from 'N/search';
import { runWrappedOperation } from './telemetry';
import { defineLazyExport } from './lazy-module';
import { wrapFunction } from './function-wrapper';

declare const require: <T = unknown>(moduleName: string) => T;
declare const exports: Record<string, unknown>;

const moduleExports = exports;

function getNsSearch(): typeof import('N/search') {
    return require<typeof import('N/search')>('N/search');
}

type SearchInstance = {
    searchType?: unknown;
    id?: string;
    run?: () => NsSearch.ResultSet;
    runPaged?: typeof NsSearch.load extends (...args: any[]) => infer T
        ? T extends { runPaged: infer R }
            ? R
            : never
        : never;
};

function normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function getOptionValue(options: unknown, key: string): unknown {
    if (!options || typeof options !== 'object') {
        return undefined;
    }

    return (options as Record<string, unknown>)[key];
}

export const Type = undefined as unknown as typeof NsSearch.Type;
export const Operator = undefined as unknown as typeof NsSearch.Operator;
export const Sort = undefined as unknown as typeof NsSearch.Sort;
export const Summary = undefined as unknown as typeof NsSearch.Summary;
defineLazyExport(moduleExports, 'Type', () => getNsSearch().Type);
defineLazyExport(moduleExports, 'Operator', () => getNsSearch().Operator);
defineLazyExport(moduleExports, 'Sort', () => getNsSearch().Sort);
defineLazyExport(moduleExports, 'Summary', () => getNsSearch().Summary);

function normalizeColumns(value: unknown): string {
    if (!Array.isArray(value)) {
        return '';
    }

    return value.length.toString();
}

function buildCreateMetadata(options: Parameters<typeof NsSearch.create>[0]) {
    return {
        module: 'search',
        action: 'create',
        summary: `Create search ${normalizeText(getOptionValue(options, 'type'))}`,
        detail: {
            targetType: 'search',
            targetKey: normalizeText(getOptionValue(options, 'id')) || normalizeText(getOptionValue(options, 'type')),
            type: normalizeText(getOptionValue(options, 'type')),
            title: normalizeText(getOptionValue(options, 'title')),
            columnCount: normalizeColumns(getOptionValue(options, 'columns')),
        },
    } as const;
}

function buildLoadMetadata(options: Parameters<typeof NsSearch.load>[0]) {
    return {
        module: 'search',
        action: 'load',
        summary: 'Load saved search',
        detail: {
            targetType: 'search',
            targetKey: normalizeText(getOptionValue(options, 'id')),
            id: normalizeText(getOptionValue(options, 'id')),
            type: normalizeText(getOptionValue(options, 'type')),
        },
    } as const;
}

function buildLookupFieldsMetadata(options: Parameters<typeof NsSearch.lookupFields>[0]) {
    return {
        module: 'search',
        action: 'lookupFields',
        summary: `Lookup fields ${normalizeText(getOptionValue(options, 'type'))}`,
        detail: {
            targetType: 'record',
            targetKey: `${normalizeText(getOptionValue(options, 'type'))}:${normalizeText(getOptionValue(options, 'id'))}`,
            type: normalizeText(getOptionValue(options, 'type')),
            id: normalizeText(getOptionValue(options, 'id')),
            columnCount: Array.isArray(getOptionValue(options, 'columns')) ? (getOptionValue(options, 'columns') as unknown[]).length : normalizeText(getOptionValue(options, 'columns')) ? '1' : '0',
        },
    } as const;
}

function buildSearchExecutionMetadata(action: string, searchInstance: SearchInstance, extraDetail?: Record<string, unknown>) {
    return {
        module: 'search',
        action,
        summary: `${action === 'getRange' ? 'Fetch search range' : action === 'runPaged' ? 'Run paged search' : action === 'fetchPage' ? 'Fetch search page' : 'Run'} search ${normalizeText(searchInstance.searchType)}`,
        detail: {
            targetType: 'search',
            targetKey: normalizeText(searchInstance.id) || normalizeText(searchInstance.searchType),
            id: normalizeText(searchInstance.id),
            type: normalizeText(searchInstance.searchType),
            ...extraDetail,
        },
    } as const;
}

function instrumentSearchResultSet<T extends { getRange?: (...args: any[]) => any; each?: (...args: any[]) => any; columns?: unknown[] }>(resultSet: T, searchInstance: SearchInstance): T {
    if (typeof resultSet.getRange === 'function') {
        const originalGetRange = resultSet.getRange.bind(resultSet) as typeof resultSet.getRange;
        const wrappedGetRange = wrapFunction<typeof originalGetRange & { promise?: (options: Parameters<typeof originalGetRange>[0]) => unknown }>(
            (options: Parameters<typeof originalGetRange>[0]) => runWrappedOperation(() => buildSearchExecutionMetadata('getRange', searchInstance, {
                start: normalizeText((options as { start?: unknown })?.start),
                end: normalizeText((options as { end?: unknown })?.end),
            }), () => originalGetRange(options)),
            'promise' in originalGetRange && typeof (originalGetRange as { promise?: unknown }).promise === 'function'
                ? (options: Parameters<NonNullable<(typeof originalGetRange & { promise: (...args: any[]) => any })['promise']>>[0]) => runWrappedOperation(() => buildSearchExecutionMetadata('getRange', searchInstance, {
                        start: normalizeText((options as { start?: unknown })?.start),
                        end: normalizeText((options as { end?: unknown })?.end),
                    }), () => (originalGetRange as typeof originalGetRange & { promise: (...args: any[]) => any }).promise(options))
                : undefined,
        );
        (resultSet as { getRange: typeof wrappedGetRange }).getRange = wrappedGetRange;
    }

    return resultSet;
}

function instrumentSearchPagedData<T extends { fetch?: (...args: any[]) => any }>(pagedData: T, searchInstance: SearchInstance): T {
    if (typeof pagedData.fetch === 'function') {
        const originalFetch = pagedData.fetch.bind(pagedData) as typeof pagedData.fetch;
        const wrappedFetch = wrapFunction<typeof originalFetch & { promise?: (options: Parameters<typeof originalFetch>[0]) => unknown }>(
            (options: Parameters<typeof originalFetch>[0]) => runWrappedOperation(() => buildSearchExecutionMetadata('fetchPage', searchInstance, {
                index: normalizeText((options as { index?: unknown })?.index),
            }), () => originalFetch(options)),
            'promise' in originalFetch && typeof (originalFetch as { promise?: unknown }).promise === 'function'
                ? (options: Parameters<NonNullable<(typeof originalFetch & { promise: (...args: any[]) => any })['promise']>>[0]) => runWrappedOperation(() => buildSearchExecutionMetadata('fetchPage', searchInstance, {
                        index: normalizeText((options as { index?: unknown })?.index),
                    }), () => (originalFetch as typeof originalFetch & { promise: (...args: any[]) => Promise<any> }).promise(options))
                : undefined,
        );
        (pagedData as { fetch: typeof wrappedFetch }).fetch = wrappedFetch;
    }

    return pagedData;
}

function instrumentSearchInstance<T extends SearchInstance>(searchInstance: T): T {
    if (typeof searchInstance.run === 'function') {
        const originalRun = searchInstance.run.bind(searchInstance) as typeof searchInstance.run;
        (searchInstance as { run: typeof originalRun }).run = (() => runWrappedOperation(() => buildSearchExecutionMetadata('run', searchInstance), () => instrumentSearchResultSet(originalRun(), searchInstance))) as typeof originalRun;
    }

    if (typeof searchInstance.runPaged === 'function') {
        const originalRunPaged = searchInstance.runPaged.bind(searchInstance) as typeof searchInstance.runPaged;
        const wrappedRunPaged = wrapFunction<typeof originalRunPaged & { promise?: (options?: Parameters<typeof originalRunPaged>[0]) => unknown }>(
            (options?: Parameters<typeof originalRunPaged>[0]) => runWrappedOperation(() => buildSearchExecutionMetadata('runPaged', searchInstance, {
                pageSize: normalizeText((options as { pageSize?: unknown } | undefined)?.pageSize),
            }), () => instrumentSearchPagedData(originalRunPaged(options), searchInstance)),
            'promise' in originalRunPaged && typeof (originalRunPaged as { promise?: unknown }).promise === 'function'
                ? (options?: Parameters<NonNullable<(typeof originalRunPaged & { promise: (...args: any[]) => any })['promise']>>[0]) => runWrappedOperation(() => buildSearchExecutionMetadata('runPaged', searchInstance, {
                        pageSize: normalizeText((options as { pageSize?: unknown } | undefined)?.pageSize),
                    }), () => (originalRunPaged as typeof originalRunPaged & { promise: (...args: any[]) => Promise<any> }).promise(options).then((pagedData) => instrumentSearchPagedData(pagedData, searchInstance)))
                : undefined,
        );
        (searchInstance as { runPaged: typeof wrappedRunPaged }).runPaged = wrappedRunPaged;
    }

    return searchInstance;
}

export const create: typeof NsSearch.create = wrapFunction<typeof NsSearch.create>(
    (options: Parameters<typeof NsSearch.create>[0]) => runWrappedOperation(() => buildCreateMetadata(options), () => instrumentSearchInstance(getNsSearch().create(options))),
    (options: Parameters<typeof NsSearch.create.promise>[0]) => runWrappedOperation(() => buildCreateMetadata(options), () => getNsSearch().create.promise(options).then((searchInstance) => instrumentSearchInstance(searchInstance))),
);

export const load: typeof NsSearch.load = wrapFunction<typeof NsSearch.load>(
    (options: Parameters<typeof NsSearch.load>[0]) => runWrappedOperation(() => buildLoadMetadata(options), () => instrumentSearchInstance(getNsSearch().load(options))),
    (options: Parameters<typeof NsSearch.load.promise>[0]) => runWrappedOperation(() => buildLoadMetadata(options), () => getNsSearch().load.promise(options).then((searchInstance) => instrumentSearchInstance(searchInstance))),
);

export const lookupFields: typeof NsSearch.lookupFields = wrapFunction<typeof NsSearch.lookupFields>(
    (options: Parameters<typeof NsSearch.lookupFields>[0]) => runWrappedOperation(() => buildLookupFieldsMetadata(options), () => getNsSearch().lookupFields(options)),
    ((options: Parameters<typeof NsSearch.lookupFields.promise>[0]) => runWrappedOperation(() => buildLookupFieldsMetadata(options), () => getNsSearch().lookupFields.promise(options))) as typeof NsSearch.lookupFields.promise,
);