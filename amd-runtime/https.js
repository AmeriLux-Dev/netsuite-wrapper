define(["require", "exports", "./telemetry", "./lazy-module", "./function-wrapper"], function (require, exports, telemetry_1, lazy_module_1, function_wrapper_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.delete = exports.requestSuiteTalkRest = exports.requestSuitelet = exports.requestRestlet = exports.request = exports.put = exports.post = exports.get = exports.createSecureString = exports.RedirectType = exports.Encoding = exports.CacheDuration = exports.Method = void 0;
    var moduleExports = exports;
    function getNsHttps() {
        return require('N/https');
    }
    exports.Method = undefined;
    exports.CacheDuration = undefined;
    exports.Encoding = undefined;
    exports.RedirectType = undefined;
    exports.createSecureString = undefined;
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Method', function () { return getNsHttps().Method; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'CacheDuration', function () { return getNsHttps().CacheDuration; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'Encoding', function () { return getNsHttps().Encoding; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'RedirectType', function () { return getNsHttps().RedirectType; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'createSecureString', function () { return getNsHttps().createSecureString; });
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
    function normalizeUrl(value) {
        var text = normalizeText(value);
        return text.replace(/\s+/g, ' ').slice(0, 180);
    }
    function normalizePath(value) {
        if (!value) {
            return '';
        }
        var withoutQuery = value.split('?')[0] || '';
        return withoutQuery.slice(0, 180);
    }
    function parseUrlParts(value) {
        var normalizedUrl = normalizeUrl(value);
        if (!normalizedUrl) {
            return { host: '', path: '' };
        }
        var match = normalizedUrl.match(/^(?:https?:\/\/)?([^/?#]+)?(\/[^?#]*)?/i);
        return {
            host: normalizeText(match === null || match === void 0 ? void 0 : match[1]),
            path: normalizePath((match === null || match === void 0 ? void 0 : match[2]) || normalizedUrl),
        };
    }
    function classifyRequestKind(action, options) {
        if (action === 'requestRestlet') {
            return 'restlet';
        }
        if (action === 'requestSuitelet') {
            return 'suitelet';
        }
        if (action === 'requestSuiteTalkRest') {
            return 'suitetalk-rest';
        }
        var url = normalizeUrl(getOptionValue(options, 'url')).toLowerCase();
        if (url.includes('/services/rest/')) {
            return 'suitetalk-rest';
        }
        if (url.includes('/app/site/hosting/restlet.nl')) {
            return 'restlet';
        }
        if (url.includes('/app/site/hosting/scriptlet.nl')) {
            return 'suitelet';
        }
        return 'external';
    }
    function hasBody(value) {
        if (value === null || value === undefined || value === '') {
            return 'false';
        }
        return 'true';
    }
    function bodySizeBucket(value) {
        if (value === null || value === undefined || value === '') {
            return 'none';
        }
        var text = typeof value === 'string' ? value : JSON.stringify(value);
        if (text.length < 256) {
            return 'small';
        }
        if (text.length < 4096) {
            return 'medium';
        }
        return 'large';
    }
    function buildRequestMetadata(action, summary, options) {
        var url = getOptionValue(options, 'url');
        var urlParts = parseUrlParts(url);
        var requestKind = classifyRequestKind(action, options);
        var scriptId = normalizeText(getOptionValue(options, 'scriptId'));
        var deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));
        return {
            module: 'https',
            action: action,
            summary: summary,
            detail: {
                requestKind: requestKind,
                method: normalizeText(getOptionValue(options, 'method')),
                url: normalizeUrl(url),
                urlHost: urlParts.host,
                urlPath: urlParts.path,
                scriptId: scriptId,
                deploymentId: deploymentId,
                targetType: requestKind,
                targetKey: scriptId ? "".concat(requestKind, ":").concat(scriptId).concat(deploymentId ? "/".concat(deploymentId) : '') : "".concat(requestKind, ":").concat(urlParts.host).concat(urlParts.path),
                hasBody: hasBody(getOptionValue(options, 'body')),
                bodySizeBucket: bodySizeBucket(getOptionValue(options, 'body')),
            },
        };
    }
    exports.get = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('get', 'HTTPS GET request', options); }, function () { return getNsHttps().get(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('get', 'HTTPS GET request', options); }, function () { return getNsHttps().get.promise(options); }); });
    var deleteRequestBase = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('delete', 'HTTPS DELETE request', options); }, function () { return getNsHttps().delete(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('delete', 'HTTPS DELETE request', options); }, function () { return getNsHttps().delete.promise(options); }); });
    exports.delete = deleteRequestBase;
    exports.post = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('post', 'HTTPS POST request', options); }, function () { return getNsHttps().post(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('post', 'HTTPS POST request', options); }, function () { return getNsHttps().post.promise(options); }); });
    exports.put = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('put', 'HTTPS PUT request', options); }, function () { return getNsHttps().put(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('put', 'HTTPS PUT request', options); }, function () { return getNsHttps().put.promise(options); }); });
    exports.request = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('request', 'HTTPS request', options); }, function () { return getNsHttps().request(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('request', 'HTTPS request', options); }, function () { return getNsHttps().request.promise(options); }); });
    exports.requestRestlet = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('requestRestlet', 'HTTPS RESTlet request', options); }, function () { return getNsHttps().requestRestlet(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('requestRestlet', 'HTTPS RESTlet request', options); }, function () { return getNsHttps().requestRestlet.promise(options); }); });
    exports.requestSuitelet = (0, function_wrapper_1.wrapFunction)(function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('requestSuitelet', 'HTTPS Suitelet request', options); }, function () { return getNsHttps().requestSuitelet(options); }); }, function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('requestSuitelet', 'HTTPS Suitelet request', options); }, function () { return getNsHttps().requestSuitelet.promise(options); }); });
    exports.requestSuiteTalkRest = (function (options) { return (0, telemetry_1.runWrappedOperation)(function () { return buildRequestMetadata('requestSuiteTalkRest', 'HTTPS SuiteTalk REST request', options); }, function () { return getNsHttps().requestSuiteTalkRest(options); }); });
});
