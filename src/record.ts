import type * as NsRecord from 'N/record';
import { runWrappedOperation } from './telemetry';
import { defineLazyExport } from './lazy-module';
import { wrapFunction } from './function-wrapper';

declare const require: <T = unknown>(moduleName: string) => T;
declare const exports: Record<string, unknown>;

const moduleExports = exports;

function getNsRecord(): typeof import('N/record') {
    return require<typeof import('N/record')>('N/record');
}

type RecordSave = NsRecord.Record['save'];
type SaveOptions = Parameters<RecordSave>[0];

type RecordInstanceWithSave = NsRecord.Record & {
    id?: unknown;
    type?: unknown;
    save: RecordSave;
    __ptrkSaveInstrumented?: boolean;
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

export const Type = undefined as unknown as typeof NsRecord.Type;
defineLazyExport(moduleExports, 'Type', () => getNsRecord().Type);

function buildLoadMetadata(options: Parameters<typeof NsRecord.load>[0]) {
    return {
        module: 'record',
        action: 'load',
        summary: `Record load ${normalizeText(getOptionValue(options, 'type'))}`,
        detail: {
            type: normalizeText(getOptionValue(options, 'type')),
            id: normalizeText(getOptionValue(options, 'id')),
        },
    } as const;
}

function buildCreateMetadata(options: Parameters<typeof NsRecord.create>[0]) {
    return {
        module: 'record',
        action: 'create',
        summary: `Record create ${normalizeText(getOptionValue(options, 'type'))}`,
        detail: {
            type: normalizeText(getOptionValue(options, 'type')),
        },
    } as const;
}

function buildCopyMetadata(options: Parameters<typeof NsRecord.copy>[0]) {
    return {
        module: 'record',
        action: 'copy',
        summary: `Record copy ${normalizeText(getOptionValue(options, 'type'))}`,
        detail: {
            type: normalizeText(getOptionValue(options, 'type')),
            id: normalizeText(getOptionValue(options, 'id')),
        },
    } as const;
}

function buildTransformMetadata(options: Parameters<typeof NsRecord.transform>[0]) {
    return {
        module: 'record',
        action: 'transform',
        summary: `Record transform ${normalizeText(getOptionValue(options, 'fromType'))} -> ${normalizeText(getOptionValue(options, 'toType'))}`,
        detail: {
            fromType: normalizeText(getOptionValue(options, 'fromType')),
            fromId: normalizeText(getOptionValue(options, 'fromId')),
            toType: normalizeText(getOptionValue(options, 'toType')),
        },
    } as const;
}

function buildSubmitFieldsMetadata(options: Parameters<typeof NsRecord.submitFields>[0]) {
    return {
        module: 'record',
        action: 'submitFields',
        summary: `Record submitFields ${normalizeText(getOptionValue(options, 'type'))}`,
        detail: {
            type: normalizeText(getOptionValue(options, 'type')),
            id: normalizeText(getOptionValue(options, 'id')),
        },
    } as const;
}

function buildDeleteMetadata(options: Parameters<typeof NsRecord.delete>[0]) {
    return {
        module: 'record',
        action: 'delete',
        summary: `Record delete ${normalizeText(getOptionValue(options, 'type'))}`,
        detail: {
            type: normalizeText(getOptionValue(options, 'type')),
            id: normalizeText(getOptionValue(options, 'id')),
        },
    } as const;
}

function buildSaveMetadata(recordInstance: RecordInstanceWithSave, options?: SaveOptions) {
    return {
        module: 'record',
        action: 'save',
        summary: `Record save ${normalizeText(recordInstance.type)}`,
        detail: {
            type: normalizeText(recordInstance.type),
            id: normalizeText(recordInstance.id),
            enableSourcing: normalizeText(options?.enableSourcing),
            ignoreMandatoryFields: normalizeText(options?.ignoreMandatoryFields),
        },
    } as const;
}

function instrumentRecordInstance<TRecord extends NsRecord.Record>(recordInstance: TRecord): TRecord {
    const instrumentedRecord = recordInstance as RecordInstanceWithSave;

    if (!instrumentedRecord || typeof instrumentedRecord !== 'object' || instrumentedRecord.__ptrkSaveInstrumented || typeof instrumentedRecord.save !== 'function') {
        return recordInstance;
    }

    const originalSave = instrumentedRecord.save;
    const wrappedSave = wrapFunction<RecordSave>(
        (options?: SaveOptions) => runWrappedOperation(() => buildSaveMetadata(instrumentedRecord, options), () => originalSave.call(recordInstance, options)),
        (options?: SaveOptions) => runWrappedOperation(
            () => buildSaveMetadata(instrumentedRecord, options),
            () => typeof originalSave.promise === 'function'
                ? originalSave.promise.call(originalSave, options)
                : Promise.resolve().then(() => originalSave.call(recordInstance, options)),
        ),
    );

    instrumentedRecord.save = wrappedSave;

    Object.defineProperty(instrumentedRecord, '__ptrkSaveInstrumented', {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
    });

    return recordInstance;
}

export const load: typeof NsRecord.load = wrapFunction<typeof NsRecord.load>(
    (options: Parameters<typeof NsRecord.load>[0]) => runWrappedOperation(() => buildLoadMetadata(options), () => instrumentRecordInstance(getNsRecord().load(options))),
    (options: Parameters<typeof NsRecord.load.promise>[0]) => runWrappedOperation(() => buildLoadMetadata(options), () => getNsRecord().load.promise(options).then((recordInstance) => instrumentRecordInstance(recordInstance))),
);

export const create: typeof NsRecord.create = wrapFunction<typeof NsRecord.create>(
    (options: Parameters<typeof NsRecord.create>[0]) => runWrappedOperation(() => buildCreateMetadata(options), () => instrumentRecordInstance(getNsRecord().create(options))),
    (options: Parameters<typeof NsRecord.create.promise>[0]) => runWrappedOperation(() => buildCreateMetadata(options), () => getNsRecord().create.promise(options).then((recordInstance) => instrumentRecordInstance(recordInstance))),
);

export const copy: typeof NsRecord.copy = wrapFunction<typeof NsRecord.copy>(
    (options: Parameters<typeof NsRecord.copy>[0]) => runWrappedOperation(() => buildCopyMetadata(options), () => instrumentRecordInstance(getNsRecord().copy(options))),
    (options: Parameters<typeof NsRecord.copy.promise>[0]) => runWrappedOperation(() => buildCopyMetadata(options), () => getNsRecord().copy.promise(options).then((recordInstance) => instrumentRecordInstance(recordInstance))),
);

export const transform: typeof NsRecord.transform = wrapFunction<typeof NsRecord.transform>(
    (options: Parameters<typeof NsRecord.transform>[0]) => runWrappedOperation(() => buildTransformMetadata(options), () => instrumentRecordInstance(getNsRecord().transform(options))),
    (options: Parameters<typeof NsRecord.transform.promise>[0]) => runWrappedOperation(() => buildTransformMetadata(options), () => getNsRecord().transform.promise(options).then((recordInstance) => instrumentRecordInstance(recordInstance))),
);

export const submitFields: typeof NsRecord.submitFields = wrapFunction<typeof NsRecord.submitFields>(
    (options: Parameters<typeof NsRecord.submitFields>[0]) => runWrappedOperation(() => buildSubmitFieldsMetadata(options), () => getNsRecord().submitFields(options)),
    (options: Parameters<typeof NsRecord.submitFields.promise>[0]) => runWrappedOperation(() => buildSubmitFieldsMetadata(options), () => getNsRecord().submitFields.promise(options)),
);

const deleteRecordBase: typeof NsRecord.delete = wrapFunction<typeof NsRecord.delete>(
    (options: Parameters<typeof NsRecord.delete>[0]) => runWrappedOperation(() => buildDeleteMetadata(options), () => getNsRecord().delete(options)),
    (options: Parameters<typeof NsRecord.delete.promise>[0]) => runWrappedOperation(() => buildDeleteMetadata(options), () => getNsRecord().delete.promise(options)),
);

export const deleteRecord: typeof NsRecord.delete = deleteRecordBase;
export { deleteRecordBase as delete };