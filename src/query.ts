import type * as NsQuery from 'N/query';
import { runWrappedOperation } from './telemetry';
import { wrapFunction } from './function-wrapper';

declare const require: <T = unknown>(moduleName: string) => T;

function getNsQuery(): typeof import('N/query') {
    return require<typeof import('N/query')>('N/query');
}

type QueryInstance = {
    id?: number | string;
    type?: unknown;
    run?: typeof NsQuery.create extends (...args: any[]) => infer T
        ? T extends { run: infer R }
            ? R
            : never
        : never;
    runPaged?: typeof NsQuery.create extends (...args: any[]) => infer T
        ? T extends { runPaged: infer R }
            ? R
            : never
        : never;
};

function normalizeQueryText(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().replace(/\s+/g, ' ').slice(0, 180);
}

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

function buildRunSuiteQlMetadata(options: Parameters<typeof NsQuery.runSuiteQL>[0]) {
    return {
        module: 'query',
        action: 'runSuiteQL',
        summary: 'Run SuiteQL query',
        detail: {
            targetType: 'suiteql',
            targetKey: normalizeQueryText((options as { query?: unknown }).query),
            query: normalizeQueryText((options as { query?: unknown }).query),
            paramCount: Array.isArray((options as { params?: unknown }).params) ? (options as { params?: unknown[] }).params?.length ?? 0 : 0,
        },
    } as const;
}

function buildCreateMetadata(options: Parameters<typeof NsQuery.create>[0]) {
    return {
        module: 'query',
        action: 'create',
        summary: `Create query ${normalizeText((options as { type?: unknown }).type)}`,
        detail: {
            targetType: 'query',
            targetKey: normalizeText((options as { type?: unknown }).type),
            type: normalizeText((options as { type?: unknown }).type),
            columnCount: Array.isArray((options as { columns?: unknown }).columns) ? ((options as { columns?: unknown[] }).columns?.length ?? 0) : 0,
        },
    } as const;
}

function buildLoadMetadata(options: Parameters<typeof NsQuery.load>[0]) {
    return {
        module: 'query',
        action: 'load',
        summary: 'Load workbook/query definition',
        detail: {
            targetType: 'query',
            targetKey: String((options as { id?: unknown }).id ?? ''),
            id: String((options as { id?: unknown }).id ?? ''),
        },
    } as const;
}

function buildQueryExecutionMetadata(action: string, queryInstance: QueryInstance, options?: { pageSize?: number }) {
    return {
        module: 'query',
        action,
        summary: `${action === 'runPaged' ? 'Run paged' : action === 'fetchPage' ? 'Fetch query page' : 'Run'} query ${normalizeText(queryInstance.type)}`,
        detail: {
            targetType: 'query',
            targetKey: normalizeText(queryInstance.id) || normalizeText(queryInstance.type),
            id: normalizeText(queryInstance.id),
            type: normalizeText(queryInstance.type),
            pageSize: normalizeText(options?.pageSize),
        },
    } as const;
}

function instrumentQueryPagedData<T extends { fetch?: (...args: any[]) => any }>(pagedData: T, queryInstance: QueryInstance): T {
    if (typeof pagedData.fetch === 'function') {
        const originalFetch = pagedData.fetch.bind(pagedData) as typeof pagedData.fetch;
        const wrappedFetch = wrapFunction<typeof originalFetch & { promise?: (options: Parameters<typeof originalFetch>[0]) => unknown }>(
            (options: Parameters<typeof originalFetch>[0]) => runWrappedOperation(() => buildQueryExecutionMetadata('fetchPage', queryInstance), () => originalFetch(options)),
            'promise' in originalFetch && typeof (originalFetch as { promise?: unknown }).promise === 'function'
                ? (options: Parameters<NonNullable<(typeof originalFetch & { promise: (...args: any[]) => any })['promise']>>[0]) => runWrappedOperation(() => buildQueryExecutionMetadata('fetchPage', queryInstance), () => (originalFetch as typeof originalFetch & { promise: (...args: any[]) => any }).promise(options))
                : undefined,
        );
        (pagedData as { fetch: typeof wrappedFetch }).fetch = wrappedFetch;
    }

    return pagedData;
}

function instrumentQueryInstance<T extends QueryInstance>(queryInstance: T): T {
    if (typeof queryInstance.run === 'function') {
        const originalRun = queryInstance.run.bind(queryInstance) as typeof queryInstance.run;
        const wrappedRun = wrapFunction<typeof originalRun & { promise?: () => unknown }>(
            () => runWrappedOperation(() => buildQueryExecutionMetadata('run', queryInstance), () => originalRun()),
            'promise' in originalRun && typeof (originalRun as { promise?: unknown }).promise === 'function'
                ? () => runWrappedOperation(() => buildQueryExecutionMetadata('run', queryInstance), () => (originalRun as typeof originalRun & { promise: () => any }).promise())
                : undefined,
        );
        (queryInstance as { run: typeof wrappedRun }).run = wrappedRun;
    }

    if (typeof queryInstance.runPaged === 'function') {
        const originalRunPaged = queryInstance.runPaged.bind(queryInstance) as typeof queryInstance.runPaged;
        const wrappedRunPaged = wrapFunction<typeof originalRunPaged & { promise?: (options: Parameters<typeof originalRunPaged>[0]) => unknown }>(
            (options: Parameters<typeof originalRunPaged>[0]) => runWrappedOperation(() => buildQueryExecutionMetadata('runPaged', queryInstance, options), () => instrumentQueryPagedData(originalRunPaged(options), queryInstance)),
            'promise' in originalRunPaged && typeof (originalRunPaged as { promise?: unknown }).promise === 'function'
                ? (options: Parameters<NonNullable<(typeof originalRunPaged & { promise: (...args: any[]) => any })['promise']>>[0]) => runWrappedOperation(() => buildQueryExecutionMetadata('runPaged', queryInstance, options), () => (originalRunPaged as typeof originalRunPaged & { promise: (...args: any[]) => Promise<any> }).promise(options).then((pagedData) => instrumentQueryPagedData(pagedData, queryInstance)))
                : undefined,
        );
        (queryInstance as { runPaged: typeof wrappedRunPaged }).runPaged = wrappedRunPaged;
    }

    return queryInstance;
}

export const create = ((options: Parameters<typeof NsQuery.create>[0]) => runWrappedOperation(() => buildCreateMetadata(options), () => instrumentQueryInstance(getNsQuery().create(options)))) as typeof NsQuery.create;

export const runSuiteQL: typeof NsQuery.runSuiteQL = wrapFunction<typeof NsQuery.runSuiteQL>(
    (options: Parameters<typeof NsQuery.runSuiteQL>[0]) => runWrappedOperation(() => buildRunSuiteQlMetadata(options), () => getNsQuery().runSuiteQL(options)),
    (options: Parameters<typeof NsQuery.runSuiteQL.promise>[0]) => runWrappedOperation(() => buildRunSuiteQlMetadata(options), () => getNsQuery().runSuiteQL.promise(options)),
);

export const load: typeof NsQuery.load = wrapFunction<typeof NsQuery.load>(
    (options: Parameters<typeof NsQuery.load>[0]) => runWrappedOperation(() => buildLoadMetadata(options), () => instrumentQueryInstance(getNsQuery().load(options))),
    (options: Parameters<typeof NsQuery.load.promise>[0]) => runWrappedOperation(() => buildLoadMetadata(options), () => getNsQuery().load.promise(options).then((queryInstance) => instrumentQueryInstance(queryInstance))),
);