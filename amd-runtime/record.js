define(["require", "exports", "./telemetry", "./lazy-module", "./function-wrapper"], function (require, exports, telemetry_1, lazy_module_1, function_wrapper_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.delete = exports.deleteRecord = exports.submitFields = exports.transform = exports.copy = exports.create = exports.load = exports.Type = void 0;
    var moduleExports = exports;
    function getNsRecord() {
        return require('N/record');
    }
    function normalizeText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }
    function getOptionValue(options, key) {
        if (!options || typeof options !== 'object') {
            return undefined;
        }
        return options[key];
    }
    exports.Type = undefined;
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Type', function () { return getNsRecord().Type; });
    function buildLoadMetadata(options) {
        return {
            module: 'record',
            action: 'load',
            summary: "Record load ".concat(normalizeText(getOptionValue(options, 'type'))),
            detail: {
                type: normalizeText(getOptionValue(options, 'type')),
                id: normalizeText(getOptionValue(options, 'id')),
            },
        };
    }
    function buildCreateMetadata(options) {
        return {
            module: 'record',
            action: 'create',
            summary: "Record create ".concat(normalizeText(getOptionValue(options, 'type'))),
            detail: {
                type: normalizeText(getOptionValue(options, 'type')),
            },
        };
    }
    function buildCopyMetadata(options) {
        return {
            module: 'record',
            action: 'copy',
            summary: "Record copy ".concat(normalizeText(getOptionValue(options, 'type'))),
            detail: {
                type: normalizeText(getOptionValue(options, 'type')),
                id: normalizeText(getOptionValue(options, 'id')),
            },
        };
    }
    function buildTransformMetadata(options) {
        return {
            module: 'record',
            action: 'transform',
            summary: "Record transform ".concat(normalizeText(getOptionValue(options, 'fromType')), " -> ").concat(normalizeText(getOptionValue(options, 'toType'))),
            detail: {
                fromType: normalizeText(getOptionValue(options, 'fromType')),
                fromId: normalizeText(getOptionValue(options, 'fromId')),
                toType: normalizeText(getOptionValue(options, 'toType')),
            },
        };
    }
    function buildSubmitFieldsMetadata(options) {
        return {
            module: 'record',
            action: 'submitFields',
            summary: "Record submitFields ".concat(normalizeText(getOptionValue(options, 'type'))),
            detail: {
                type: normalizeText(getOptionValue(options, 'type')),
                id: normalizeText(getOptionValue(options, 'id')),
            },
        };
    }
    function buildDeleteMetadata(options) {
        return {
            module: 'record',
            action: 'delete',
            summary: "Record delete ".concat(normalizeText(getOptionValue(options, 'type'))),
            detail: {
                type: normalizeText(getOptionValue(options, 'type')),
                id: normalizeText(getOptionValue(options, 'id')),
            },
        };
    }
    function buildSaveMetadata(recordInstance, options) {
        return {
            module: 'record',
            action: 'save',
            summary: "Record save ".concat(normalizeText(recordInstance.type)),
            detail: {
                type: normalizeText(recordInstance.type),
                id: normalizeText(recordInstance.id),
                enableSourcing: normalizeText(options === null || options === void 0 ? void 0 : options.enableSourcing),
                ignoreMandatoryFields: normalizeText(options === null || options === void 0 ? void 0 : options.ignoreMandatoryFields),
            },
        };
    }
    function instrumentRecordInstance(recordInstance) {
        var instrumentedRecord = recordInstance;
        if (!instrumentedRecord || typeof instrumentedRecord !== 'object' || instrumentedRecord.__ptrkSaveInstrumented || typeof instrumentedRecord.save !== 'function') {
            return recordInstance;
        }
        var originalSave = instrumentedRecord.save;
        var wrappedSave = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildSaveMetadata(instrumentedRecord, options); }, function () { return originalSave.call(recordInstance, options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildSaveMetadata(instrumentedRecord, options); }, function () { return typeof originalSave.promise === 'function'
            ? originalSave.promise.call(originalSave, options)
            : Promise.resolve().then(function () { return originalSave.call(recordInstance, options); }); }); });
        instrumentedRecord.save = wrappedSave;
        Object.defineProperty(instrumentedRecord, '__ptrkSaveInstrumented', {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false,
        });
        return recordInstance;
    }
    exports.load = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildLoadMetadata(options); }, function () { return instrumentRecordInstance(getNsRecord().load(options)); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildLoadMetadata(options); }, function () { return getNsRecord().load.promise(options).then(function (recordInstance) { return instrumentRecordInstance(recordInstance); }); }); });
    exports.create = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildCreateMetadata(options); }, function () { return instrumentRecordInstance(getNsRecord().create(options)); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildCreateMetadata(options); }, function () { return getNsRecord().create.promise(options).then(function (recordInstance) { return instrumentRecordInstance(recordInstance); }); }); });
    exports.copy = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildCopyMetadata(options); }, function () { return instrumentRecordInstance(getNsRecord().copy(options)); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildCopyMetadata(options); }, function () { return getNsRecord().copy.promise(options).then(function (recordInstance) { return instrumentRecordInstance(recordInstance); }); }); });
    exports.transform = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildTransformMetadata(options); }, function () { return instrumentRecordInstance(getNsRecord().transform(options)); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildTransformMetadata(options); }, function () { return getNsRecord().transform.promise(options).then(function (recordInstance) { return instrumentRecordInstance(recordInstance); }); }); });
    exports.submitFields = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildSubmitFieldsMetadata(options); }, function () { return getNsRecord().submitFields(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildSubmitFieldsMetadata(options); }, function () { return getNsRecord().submitFields.promise(options); }); });
    var deleteRecordBase = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildDeleteMetadata(options); }, function () { return getNsRecord().delete(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildDeleteMetadata(options); }, function () { return getNsRecord().delete.promise(options); }); });
    exports.delete = deleteRecordBase;
    exports.deleteRecord = deleteRecordBase;
});
