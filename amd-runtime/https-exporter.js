// A generic JSON-over-HTTPS exporter: one POST per tracked script run carrying that run's spans and
// log entries. It is the base an adapter for a specific log system (Datadog, Seq, Loki, an in-house
// collector) builds on: point `url` at the ingestion endpoint, name the API secret holding the token,
// and reshape the payload with `format` when the destination wants its own envelope.
//
// The token never appears in code or config. It lives in a NetSuite API secret (Setup > Company >
// API Secrets) and is referenced by its script id; N/https substitutes it inside a SecureString.
// Cost: one https.post is 10 governance units, paid once per run, only while the scope is not `off`.
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
define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.HTTPS_EXPORTER_NAME = void 0;
    exports.buildHttpsExportPayload = buildHttpsExportPayload;
    exports.createHttpsExporter = createHttpsExporter;
    exports.HTTPS_EXPORTER_NAME = 'https';
    function getNsHttps() {
        return require('N/https');
    }
    function getNsLog() {
        return require('N/log');
    }
    function getNsRuntime() {
        return require('N/runtime');
    }
    function normalizeText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }
    function readRuntimeContext() {
        try {
            var nsRuntime = getNsRuntime();
            var currentScript = nsRuntime.getCurrentScript();
            return {
                environment: normalizeText(nsRuntime.envType),
                accountId: normalizeText(nsRuntime.accountId),
                scriptId: normalizeText(currentScript.id),
                deploymentId: normalizeText(currentScript.deploymentId),
            };
        }
        catch (_error) {
            return { environment: '', accountId: '', scriptId: '', deploymentId: '' };
        }
    }
    function buildAuthorizationHeaderValue(options) {
        var secretId = normalizeText(options.secretId);
        if (!secretId) {
            return null;
        }
        var scheme = options.authorizationScheme === undefined ? 'Bearer' : normalizeText(options.authorizationScheme);
        var secretReference = "{".concat(secretId, "}");
        return getNsHttps().createSecureString({
            input: scheme ? "".concat(scheme, " ").concat(secretReference) : secretReference,
        });
    }
    function buildHttpsExportPayload(batch, source) {
        var runtimeContext = readRuntimeContext();
        return {
            source: source,
            environment: runtimeContext.environment,
            accountId: runtimeContext.accountId,
            scriptId: runtimeContext.scriptId,
            deploymentId: runtimeContext.deploymentId,
            executionId: batch.executionId,
            flowId: batch.flowId,
            scopeKey: batch.scopeKey,
            mode: batch.mode,
            exportedAt: new Date().toISOString(),
            spans: batch.spans,
            logs: batch.logs,
        };
    }
    function createHttpsExporter(options) {
        var url = normalizeText(options.url);
        if (!url) {
            throw new Error('createHttpsExporter requires a url.');
        }
        var source = normalizeText(options.source) || 'netsuite-wrapper';
        var authorizationHeaderName = normalizeText(options.authorizationHeader) || 'Authorization';
        return {
            name: exports.HTTPS_EXPORTER_NAME,
            acceptsLogEntries: true,
            export: function (batch) {
                var payload = buildHttpsExportPayload(batch, source);
                var body = JSON.stringify(options.format ? options.format(payload) : payload);
                var headers = __assign({ 'Content-Type': 'application/json' }, (options.headers || {}));
                var authorizationHeaderValue = buildAuthorizationHeaderValue(options);
                if (authorizationHeaderValue) {
                    headers[authorizationHeaderName] = authorizationHeaderValue;
                }
                var response = getNsHttps().post({ url: url, body: body, headers: headers });
                if (response.code >= 300) {
                    getNsLog().error({
                        title: 'netsuite-wrapper https export rejected',
                        details: JSON.stringify({ url: url, code: response.code, executionId: batch.executionId, spanCount: batch.spans.length, logCount: batch.logs.length }),
                    });
                }
            },
        };
    }
});
