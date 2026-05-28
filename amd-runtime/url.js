define(["require", "exports", "./telemetry", "./lazy-module"], function (require, exports, telemetry_1, lazy_module_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.resolveTaskLink = exports.resolveScript = exports.resolveRecord = exports.resolveDomain = exports.format = exports.HostType = void 0;
    var moduleExports = exports;
    function getNsUrl() {
        return require('N/url');
    }
    exports.HostType = undefined;
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'HostType', function () { return getNsUrl().HostType; });
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
    function normalizeParams(value) {
        if (!value || typeof value !== 'object') {
            return '';
        }
        return Object.keys(value).sort().join(',');
    }
    function buildTargetMetadata(action, options) {
        if (action === 'resolveRecord') {
            var recordType = normalizeText(getOptionValue(options, 'recordType'));
            var recordId = normalizeText(getOptionValue(options, 'recordId')) || 'new';
            return {
                targetType: 'record',
                targetKey: "".concat(recordType, ":").concat(recordId),
            };
        }
        if (action === 'resolveScript') {
            var scriptId = normalizeText(getOptionValue(options, 'scriptId'));
            var deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));
            return {
                targetType: 'script',
                targetKey: "".concat(scriptId).concat(deploymentId ? "/".concat(deploymentId) : ''),
            };
        }
        if (action === 'resolveDomain') {
            var hostType = normalizeText(getOptionValue(options, 'hostType'));
            var accountId = normalizeText(getOptionValue(options, 'accountId'));
            return {
                targetType: 'domain',
                targetKey: "".concat(hostType).concat(accountId ? ":".concat(accountId) : ''),
            };
        }
        if (action === 'resolveTaskLink') {
            return {
                targetType: 'tasklink',
                targetKey: normalizeText(getOptionValue(options, 'id')),
            };
        }
        return {
            targetType: 'params',
            targetKey: normalizeParams(getOptionValue(options, 'params')),
        };
    }
    function buildUrlMetadata(action, summary, options) {
        var targetMetadata = buildTargetMetadata(action, options);
        return {
            module: 'url',
            action: action,
            summary: summary,
            detail: {
                targetType: targetMetadata.targetType,
                targetKey: targetMetadata.targetKey,
                hostType: normalizeText(getOptionValue(options, 'hostType')),
                recordType: normalizeText(getOptionValue(options, 'recordType')),
                recordId: normalizeText(getOptionValue(options, 'recordId')),
                scriptId: normalizeText(getOptionValue(options, 'scriptId')),
                deploymentId: normalizeText(getOptionValue(options, 'deploymentId')),
                taskId: normalizeText(getOptionValue(options, 'id')),
                returnExternalUrl: normalizeText(getOptionValue(options, 'returnExternalUrl')),
                paramKeys: normalizeParams(getOptionValue(options, 'params')),
            },
        };
    }
    exports.format = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildUrlMetadata('format', 'Format NetSuite URL parameters', options); }, function () { return getNsUrl().format(options); }); });
    exports.resolveDomain = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildUrlMetadata('resolveDomain', 'Resolve NetSuite domain', options); }, function () { return getNsUrl().resolveDomain(options); }); });
    exports.resolveRecord = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildUrlMetadata('resolveRecord', 'Resolve NetSuite record URL', options); }, function () { return getNsUrl().resolveRecord(options); }); });
    exports.resolveScript = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildUrlMetadata('resolveScript', 'Resolve NetSuite script URL', options); }, function () { return getNsUrl().resolveScript(options); }); });
    exports.resolveTaskLink = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildUrlMetadata('resolveTaskLink', 'Resolve NetSuite task link URL', options); }, function () { return getNsUrl().resolveTaskLink(options); }); });
});
