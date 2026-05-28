define(["require", "exports", "./telemetry", "./lazy-module"], function (require, exports, telemetry_1, lazy_module_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isFeatureInEffect = exports.getCurrentUser = exports.getCurrentSession = exports.getCurrentScript = exports.Permission = exports.EnvType = exports.ContextType = exports.envType = exports.executionContext = exports.version = exports.accountId = void 0;
    var moduleExports = exports;
    function getNsRuntime() {
        return require('N/runtime');
    }
    function normalizeText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }
    function buildRuntimeMetadata(action, summary, detail) {
        return {
            module: 'runtime',
            action: action,
            summary: summary,
            detail: detail,
        };
    }
    exports.accountId = undefined;
    exports.version = undefined;
    exports.executionContext = undefined;
    exports.envType = undefined;
    exports.ContextType = undefined;
    exports.EnvType = undefined;
    exports.Permission = undefined;
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'accountId', function () { return getNsRuntime().accountId; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'version', function () { return getNsRuntime().version; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'executionContext', function () { return getNsRuntime().executionContext; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'envType', function () { return getNsRuntime().envType; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'ContextType', function () { return getNsRuntime().ContextType; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'EnvType', function () { return getNsRuntime().EnvType; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Permission', function () { return getNsRuntime().Permission; });
    exports.getCurrentScript = (function () { return (0, telemetry_1.runWrappedOperation)(function () { return buildRuntimeMetadata('getCurrentScript', 'Get current script runtime context'); }, function () { return getNsRuntime().getCurrentScript(); }); });
    exports.getCurrentSession = (function () { return (0, telemetry_1.runWrappedOperation)(function () { return buildRuntimeMetadata('getCurrentSession', 'Get current runtime session'); }, function () { return getNsRuntime().getCurrentSession(); }); });
    exports.getCurrentUser = (function () { return (0, telemetry_1.runWrappedOperation)(function () { return buildRuntimeMetadata('getCurrentUser', 'Get current runtime user'); }, function () { return getNsRuntime().getCurrentUser(); }); });
    exports.isFeatureInEffect = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRuntimeMetadata('isFeatureInEffect', 'Check NetSuite feature flag', {
        feature: normalizeText(options.feature),
    }); }, function () { return getNsRuntime().isFeatureInEffect(options); }); });
});
