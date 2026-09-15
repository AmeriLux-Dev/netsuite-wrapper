// A generic JSON-over-HTTPS exporter: one POST per tracked script run carrying that run's spans and
// log entries. It is the base an adapter for a specific log system (Datadog, Seq, Loki, an in-house
// collector) builds on: point `url` at the ingestion endpoint, name the API secret holding the token,
// and reshape the payload with `format` when the destination wants its own envelope.
//
// The token never appears in code or config. It lives in a NetSuite API secret (Setup > Company >
// API Secrets) and is referenced by its script id; N/https substitutes it inside a SecureString.
// Cost: one https.post is 10 governance units, paid once per run, only while the scope is not `off`.

import type { TelemetryExportBatch, TelemetryExporter } from './telemetry-exporter';

declare const require: <T = unknown>(moduleName: string) => T;

export const HTTPS_EXPORTER_NAME = 'https';

export interface HttpsExporterOptions {
    /** The ingestion endpoint. */
    url: string;
    /** Script id of the API secret holding the token, e.g. `custsecret_app_telemetry`. */
    secretId?: string;
    /** Header carrying the token. Default `Authorization`. */
    authorizationHeader?: string;
    /** Prefix before the token. Default `Bearer`; pass an empty string to send the token alone. */
    authorizationScheme?: string;
    /** Extra literal headers (never put a token here). */
    headers?: Record<string, string>;
    /** Label written into the payload so the destination can tell wrapper traffic apart. */
    source?: string;
    /** Replaces the default payload shape. Return whatever the destination expects; it is JSON-encoded. */
    format?: (payload: HttpsExportPayload) => unknown;
}

export interface HttpsExportPayload {
    source: string;
    /** `PRODUCTION`, `SANDBOX`, … from N/runtime; empty when unavailable. */
    environment: string;
    accountId: string;
    scriptId: string;
    deploymentId: string;
    executionId: string;
    flowId: string;
    scopeKey: string;
    mode: TelemetryExportBatch['mode'];
    exportedAt: string;
    spans: TelemetryExportBatch['spans'];
    logs: TelemetryExportBatch['logs'];
}

type HttpsHeaderValue = string | ReturnType<typeof import('N/https').createSecureString>;

function getNsHttps(): typeof import('N/https') {
    return require<typeof import('N/https')>('N/https');
}

function getNsLog(): typeof import('N/log') {
    return require<typeof import('N/log')>('N/log');
}

function getNsRuntime(): typeof import('N/runtime') {
    return require<typeof import('N/runtime')>('N/runtime');
}

function normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function readRuntimeContext(): { environment: string; accountId: string; scriptId: string; deploymentId: string } {
    try {
        const nsRuntime = getNsRuntime();
        const currentScript = nsRuntime.getCurrentScript() as unknown as Record<string, unknown>;
        return {
            environment: normalizeText(nsRuntime.envType),
            accountId: normalizeText(nsRuntime.accountId),
            scriptId: normalizeText(currentScript.id),
            deploymentId: normalizeText(currentScript.deploymentId),
        };
    } catch (_error) {
        return { environment: '', accountId: '', scriptId: '', deploymentId: '' };
    }
}

function buildAuthorizationHeaderValue(options: HttpsExporterOptions): HttpsHeaderValue | null {
    const secretId = normalizeText(options.secretId);
    if (!secretId) {
        return null;
    }

    const scheme = options.authorizationScheme === undefined ? 'Bearer' : normalizeText(options.authorizationScheme);
    const secretReference = `{${secretId}}`;
    return getNsHttps().createSecureString({
        input: scheme ? `${scheme} ${secretReference}` : secretReference,
    });
}

export function buildHttpsExportPayload(batch: TelemetryExportBatch, source: string): HttpsExportPayload {
    const runtimeContext = readRuntimeContext();
    return {
        source,
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

export function createHttpsExporter(options: HttpsExporterOptions): TelemetryExporter {
    const url = normalizeText(options.url);
    if (!url) {
        throw new Error('createHttpsExporter requires a url.');
    }

    const source = normalizeText(options.source) || 'netsuite-wrapper';
    const authorizationHeaderName = normalizeText(options.authorizationHeader) || 'Authorization';

    return {
        name: HTTPS_EXPORTER_NAME,
        acceptsLogEntries: true,
        export(batch: TelemetryExportBatch): void {
            const payload = buildHttpsExportPayload(batch, source);
            const body = JSON.stringify(options.format ? options.format(payload) : payload);
            const headers: Record<string, HttpsHeaderValue> = {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            };
            const authorizationHeaderValue = buildAuthorizationHeaderValue(options);
            if (authorizationHeaderValue) {
                headers[authorizationHeaderName] = authorizationHeaderValue;
            }

            const response = getNsHttps().post({ url, body, headers: headers as unknown as Record<string, string> });
            if (response.code >= 300) {
                getNsLog().error({
                    title: 'netsuite-wrapper https export rejected',
                    details: JSON.stringify({ url, code: response.code, executionId: batch.executionId, spanCount: batch.spans.length, logCount: batch.logs.length }),
                });
            }
        },
    };
}
