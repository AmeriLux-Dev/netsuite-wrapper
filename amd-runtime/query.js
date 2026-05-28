define(["require", "exports", "./telemetry", "./function-wrapper"], function (require, exports, telemetry_1, function_wrapper_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.load = exports.runSuiteQL = exports.create = void 0;
    function getNsQuery() {
        return require('N/query');
    }
    function normalizeQueryText(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.trim().replace(/\s+/g, ' ').slice(0, 180);
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
    function buildRunSuiteQlMetadata(options) {
        var _a, _b;
        return {
            module: 'query',
            action: 'runSuiteQL',
            summary: 'Run SuiteQL query',
            detail: {
                targetType: 'suiteql',
                targetKey: normalizeQueryText(options.query),
                query: normalizeQueryText(options.query),
                paramCount: Array.isArray(options.params) ? (_b = (_a = options.params) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0 : 0,
            },
        };
    }
    function buildCreateMetadata(options) {
        var _a, _b;
        return {
            module: 'query',
            action: 'create',
            summary: "Create query ".concat(normalizeText(options.type)),
            detail: {
                targetType: 'query',
                targetKey: normalizeText(options.type),
                type: normalizeText(options.type),
                columnCount: Array.isArray(options.columns) ? ((_b = (_a = options.columns) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) : 0,
            },
        };
    }
    function buildLoadMetadata(options) {
        var _a, _b;
        return {
            module: 'query',
            action: 'load',
            summary: 'Load workbook/query definition',
            detail: {
                targetType: 'query',
                targetKey: String((_a = options.id) !== null && _a !== void 0 ? _a : ''),
                id: String((_b = options.id) !== null && _b !== void 0 ? _b : ''),
            },
        };
    }
    function buildQueryExecutionMetadata(action, queryInstance, options) {
        return {
            module: 'query',
            action: action,
            summary: "".concat(action === 'runPaged' ? 'Run paged' : action === 'fetchPage' ? 'Fetch query page' : 'Run', " query ").concat(normalizeText(queryInstance.type)),
            detail: {
                targetType: 'query',
                targetKey: normalizeText(queryInstance.id) || normalizeText(queryInstance.type),
                id: normalizeText(queryInstance.id),
                type: normalizeText(queryInstance.type),
                pageSize: normalizeText(options === null || options === void 0 ? void 0 : options.pageSize),
            },
        };
    }
    function instrumentQueryPagedData(pagedData, queryInstance) {
        if (typeof pagedData.fetch === 'function') {
            var originalFetch_1 = pagedData.fetch.bind(pagedData);
            var wrappedFetch = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildQueryExecutionMetadata('fetchPage', queryInstance); }, function () { return originalFetch_1(options); }); }, 'promise' in originalFetch_1 && typeof originalFetch_1.promise === 'function'
                ? function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildQueryExecutionMetadata('fetchPage', queryInstance); }, function () { return originalFetch_1.promise(options); }); }
                : undefined);
            pagedData.fetch = wrappedFetch;
        }
        return pagedData;
    }
    function instrumentQueryInstance(queryInstance) {
        if (typeof queryInstance.run === 'function') {
            var originalRun_1 = queryInstance.run.bind(queryInstance);
            var wrappedRun = (0, function_wrapper_1.wrapFunction)(function () { return (0, telemetry_1.runWrappedOperation)(function () { return buildQueryExecutionMetadata('run', queryInstance); }, function () { return originalRun_1(); }); }, 'promise' in originalRun_1 && typeof originalRun_1.promise === 'function'
                ? function () { return (0, telemetry_1.runWrappedOperation)(function () { return buildQueryExecutionMetadata('run', queryInstance); }, function () { return originalRun_1.promise(); }); }
                : undefined);
            queryInstance.run = wrappedRun;
        }
        if (typeof queryInstance.runPaged === 'function') {
            var originalRunPaged_1 = queryInstance.runPaged.bind(queryInstance);
            var wrappedRunPaged = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildQueryExecutionMetadata('runPaged', queryInstance, options); }, function () { return instrumentQueryPagedData(originalRunPaged_1(options), queryInstance); }); }, 'promise' in originalRunPaged_1 && typeof originalRunPaged_1.promise === 'function'
                ? function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildQueryExecutionMetadata('runPaged', queryInstance, options); }, function () { return originalRunPaged_1.promise(options).then(function (pagedData) { return instrumentQueryPagedData(pagedData, queryInstance); }); }); }
                : undefined);
            queryInstance.runPaged = wrappedRunPaged;
        }
        return queryInstance;
    }
    exports.create = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildCreateMetadata(options); }, function () { return instrumentQueryInstance(getNsQuery().create(options)); }); });
    exports.runSuiteQL = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRunSuiteQlMetadata(options); }, function () { return getNsQuery().runSuiteQL(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRunSuiteQlMetadata(options); }, function () { return getNsQuery().runSuiteQL.promise(options); }); });
    exports.load = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildLoadMetadata(options); }, function () { return instrumentQueryInstance(getNsQuery().load(options)); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildLoadMetadata(options); }, function () { return getNsQuery().load.promise(options).then(function (queryInstance) { return instrumentQueryInstance(queryInstance); }); }); });
});
