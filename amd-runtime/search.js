var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
define(["require", "exports", "./telemetry", "./lazy-module", "./function-wrapper"], function (require, exports, telemetry_1, lazy_module_1, function_wrapper_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.lookupFields = exports.load = exports.create = exports.Summary = exports.Sort = exports.Operator = exports.Type = void 0;
    var moduleExports = exports;
    function getNsSearch() {
        return require('N/search');
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
    exports.Operator = undefined;
    exports.Sort = undefined;
    exports.Summary = undefined;
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Type', function () { return getNsSearch().Type; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Operator', function () { return getNsSearch().Operator; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Sort', function () { return getNsSearch().Sort; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Summary', function () { return getNsSearch().Summary; });
    function normalizeColumns(value) {
        if (!Array.isArray(value)) {
            return '';
        }
        return value.length.toString();
    }
    function buildCreateMetadata(options) {
        return {
            module: 'search',
            action: 'create',
            summary: "Create search ".concat(normalizeText(getOptionValue(options, 'type'))),
            detail: {
                targetType: 'search',
                targetKey: normalizeText(getOptionValue(options, 'id')) || normalizeText(getOptionValue(options, 'type')),
                type: normalizeText(getOptionValue(options, 'type')),
                title: normalizeText(getOptionValue(options, 'title')),
                columnCount: normalizeColumns(getOptionValue(options, 'columns')),
            },
        };
    }
    function buildLoadMetadata(options) {
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
        };
    }
    function buildLookupFieldsMetadata(options) {
        return {
            module: 'search',
            action: 'lookupFields',
            summary: "Lookup fields ".concat(normalizeText(getOptionValue(options, 'type'))),
            detail: {
                targetType: 'record',
                targetKey: "".concat(normalizeText(getOptionValue(options, 'type')), ":").concat(normalizeText(getOptionValue(options, 'id'))),
                type: normalizeText(getOptionValue(options, 'type')),
                id: normalizeText(getOptionValue(options, 'id')),
                columnCount: Array.isArray(getOptionValue(options, 'columns')) ? getOptionValue(options, 'columns').length : normalizeText(getOptionValue(options, 'columns')) ? '1' : '0',
            },
        };
    }
    function buildSearchExecutionMetadata(action, searchInstance, extraDetail) {
        return {
            module: 'search',
            action: action,
            summary: "".concat(action === 'getRange' ? 'Fetch search range' : action === 'runPaged' ? 'Run paged search' : action === 'fetchPage' ? 'Fetch search page' : 'Run', " search ").concat(normalizeText(searchInstance.searchType)),
            detail: __assign({ targetType: 'search', targetKey: normalizeText(searchInstance.id) || normalizeText(searchInstance.searchType), id: normalizeText(searchInstance.id), type: normalizeText(searchInstance.searchType) }, extraDetail),
        };
    }
    function instrumentSearchResultSet(resultSet, searchInstance) {
        if (typeof resultSet.getRange === 'function') {
            var originalGetRange_1 = resultSet.getRange.bind(resultSet);
            var wrappedGetRange = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(buildSearchExecutionMetadata('getRange', searchInstance, {
                start: normalizeText(options === null || options === void 0 ? void 0 : options.start),
                end: normalizeText(options === null || options === void 0 ? void 0 : options.end),
            }), function () { return originalGetRange_1(options); }); }, 'promise' in originalGetRange_1 && typeof originalGetRange_1.promise === 'function'
                ? function (options) { return (0, telemetry_1.runWrappedOperation)(buildSearchExecutionMetadata('getRange', searchInstance, {
                    start: normalizeText(options === null || options === void 0 ? void 0 : options.start),
                    end: normalizeText(options === null || options === void 0 ? void 0 : options.end),
                }), function () { return originalGetRange_1.promise(options); }); }
                : undefined);
            resultSet.getRange = wrappedGetRange;
        }
        return resultSet;
    }
    function instrumentSearchPagedData(pagedData, searchInstance) {
        if (typeof pagedData.fetch === 'function') {
            var originalFetch_1 = pagedData.fetch.bind(pagedData);
            var wrappedFetch = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(buildSearchExecutionMetadata('fetchPage', searchInstance, {
                index: normalizeText(options === null || options === void 0 ? void 0 : options.index),
            }), function () { return originalFetch_1(options); }); }, 'promise' in originalFetch_1 && typeof originalFetch_1.promise === 'function'
                ? function (options) { return (0, telemetry_1.runWrappedOperation)(buildSearchExecutionMetadata('fetchPage', searchInstance, {
                    index: normalizeText(options === null || options === void 0 ? void 0 : options.index),
                }), function () { return originalFetch_1.promise(options); }); }
                : undefined);
            pagedData.fetch = wrappedFetch;
        }
        return pagedData;
    }
    function instrumentSearchInstance(searchInstance) {
        if (typeof searchInstance.run === 'function') {
            var originalRun_1 = searchInstance.run.bind(searchInstance);
            searchInstance.run = (function () { return (0, telemetry_1.runWrappedOperation)(buildSearchExecutionMetadata('run', searchInstance), function () { return instrumentSearchResultSet(originalRun_1(), searchInstance); }); });
        }
        if (typeof searchInstance.runPaged === 'function') {
            var originalRunPaged_1 = searchInstance.runPaged.bind(searchInstance);
            var wrappedRunPaged = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(buildSearchExecutionMetadata('runPaged', searchInstance, {
                pageSize: normalizeText(options === null || options === void 0 ? void 0 : options.pageSize),
            }), function () { return instrumentSearchPagedData(originalRunPaged_1(options), searchInstance); }); }, 'promise' in originalRunPaged_1 && typeof originalRunPaged_1.promise === 'function'
                ? function (options) { return (0, telemetry_1.runWrappedOperation)(buildSearchExecutionMetadata('runPaged', searchInstance, {
                    pageSize: normalizeText(options === null || options === void 0 ? void 0 : options.pageSize),
                }), function () { return originalRunPaged_1.promise(options).then(function (pagedData) { return instrumentSearchPagedData(pagedData, searchInstance); }); }); }
                : undefined);
            searchInstance.runPaged = wrappedRunPaged;
        }
        return searchInstance;
    }
    exports.create = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(buildCreateMetadata(options), function () { return instrumentSearchInstance(getNsSearch().create(options)); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(buildCreateMetadata(options), function () { return getNsSearch().create.promise(options).then(function (searchInstance) { return instrumentSearchInstance(searchInstance); }); }); });
    exports.load = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(buildLoadMetadata(options), function () { return instrumentSearchInstance(getNsSearch().load(options)); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(buildLoadMetadata(options), function () { return getNsSearch().load.promise(options).then(function (searchInstance) { return instrumentSearchInstance(searchInstance); }); }); });
    exports.lookupFields = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(buildLookupFieldsMetadata(options), function () { return getNsSearch().lookupFields(options); }); }, (function (options) { return (0, telemetry_1.runWrappedOperation)(buildLookupFieldsMetadata(options), function () { return getNsSearch().lookupFields.promise(options); }); }));
});
