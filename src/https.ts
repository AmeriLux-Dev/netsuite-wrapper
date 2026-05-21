import type * as NsHttps from 'N/https';
import { runWrappedOperation } from './telemetry';
import { defineLazyExport } from './lazy-module';
import { wrapFunction } from './function-wrapper';

declare const require: <T = unknown>(moduleName: string) => T;
declare const exports: Record<string, unknown>;

const moduleExports = exports;

function getNsHttps(): typeof import('N/https') {
    return require<typeof import('N/https')>('N/https');
}

export const Method = undefined as unknown as typeof NsHttps.Method;
export const CacheDuration = undefined as unknown as typeof NsHttps.CacheDuration;
export const Encoding = undefined as unknown as typeof NsHttps.Encoding;
export const RedirectType = undefined as unknown as typeof NsHttps.RedirectType;
export const createSecureString = undefined as unknown as typeof NsHttps.createSecureString;
defineLazyExport(moduleExports, 'Method', () => getNsHttps().Method);
defineLazyExport(moduleExports, 'CacheDuration', () => getNsHttps().CacheDuration);
defineLazyExport(moduleExports, 'Encoding', () => getNsHttps().Encoding);
defineLazyExport(moduleExports, 'RedirectType', () => getNsHttps().RedirectType);
defineLazyExport(moduleExports, 'createSecureString', () => getNsHttps().createSecureString);

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

function normalizeUrl(value: unknown): string {
    const text = normalizeText(value);
    return text.replace(/\s+/g, ' ').slice(0, 180);
}

function normalizePath(value: string): string {
    if (!value) {
        return '';
    }

    const withoutQuery = value.split('?')[0] || '';
    return withoutQuery.slice(0, 180);
}

function parseUrlParts(value: unknown): { host: string; path: string } {
    const normalizedUrl = normalizeUrl(value);
    if (!normalizedUrl) {
        return { host: '', path: '' };
    }

    const match = normalizedUrl.match(/^(?:https?:\/\/)?([^/?#]+)?(\/[^?#]*)?/i);
    return {
        host: normalizeText(match?.[1]),
        path: normalizePath(match?.[2] || normalizedUrl),
    };
}

function classifyRequestKind(action: string, options: unknown): string {
    if (action === 'requestRestlet') {
        return 'restlet';
    }

    if (action === 'requestSuitelet') {
        return 'suitelet';
    }

    if (action === 'requestSuiteTalkRest') {
        return 'suitetalk-rest';
    }

    const url = normalizeUrl(getOptionValue(options, 'url')).toLowerCase();
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

function hasBody(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return 'false';
    }

    return 'true';
}

function bodySizeBucket(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return 'none';
    }

    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length < 256) {
        return 'small';
    }

    if (text.length < 4096) {
        return 'medium';
    }

    return 'large';
}

function buildRequestMetadata(action: string, summary: string, options: unknown) {
    const url = getOptionValue(options, 'url');
    const urlParts = parseUrlParts(url);
    const requestKind = classifyRequestKind(action, options);
    const scriptId = normalizeText(getOptionValue(options, 'scriptId'));
    const deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));

    return {
        module: 'https',
        action,
        summary,
        detail: {
            requestKind,
            method: normalizeText(getOptionValue(options, 'method')),
            url: normalizeUrl(url),
            urlHost: urlParts.host,
            urlPath: urlParts.path,
            scriptId,
            deploymentId,
            targetType: requestKind,
            targetKey: scriptId ? `${requestKind}:${scriptId}${deploymentId ? `/${deploymentId}` : ''}` : `${requestKind}:${urlParts.host}${urlParts.path}`,
            hasBody: hasBody(getOptionValue(options, 'body')),
            bodySizeBucket: bodySizeBucket(getOptionValue(options, 'body')),
        },
    } as const;
}

export const get: typeof NsHttps.get = wrapFunction<typeof NsHttps.get>(
    (options: Parameters<typeof NsHttps.get>[0]) => runWrappedOperation(() => buildRequestMetadata('get', 'HTTPS GET request', options), () => getNsHttps().get(options)),
    (options: Parameters<typeof NsHttps.get.promise>[0]) => runWrappedOperation(() => buildRequestMetadata('get', 'HTTPS GET request', options), () => getNsHttps().get.promise(options)),
);

const deleteRequestBase: typeof NsHttps.delete = wrapFunction<typeof NsHttps.delete>(
    (options: Parameters<typeof NsHttps.delete>[0]) => runWrappedOperation(() => buildRequestMetadata('delete', 'HTTPS DELETE request', options), () => getNsHttps().delete(options)),
    (options: Parameters<typeof NsHttps.delete.promise>[0]) => runWrappedOperation(() => buildRequestMetadata('delete', 'HTTPS DELETE request', options), () => getNsHttps().delete.promise(options)),
);

export const post: typeof NsHttps.post = wrapFunction<typeof NsHttps.post>(
    (options: Parameters<typeof NsHttps.post>[0]) => runWrappedOperation(() => buildRequestMetadata('post', 'HTTPS POST request', options), () => getNsHttps().post(options)),
    (options: Parameters<typeof NsHttps.post.promise>[0]) => runWrappedOperation(() => buildRequestMetadata('post', 'HTTPS POST request', options), () => getNsHttps().post.promise(options)),
);

export const put: typeof NsHttps.put = wrapFunction<typeof NsHttps.put>(
    (options: Parameters<typeof NsHttps.put>[0]) => runWrappedOperation(() => buildRequestMetadata('put', 'HTTPS PUT request', options), () => getNsHttps().put(options)),
    (options: Parameters<typeof NsHttps.put.promise>[0]) => runWrappedOperation(() => buildRequestMetadata('put', 'HTTPS PUT request', options), () => getNsHttps().put.promise(options)),
);

export const request: typeof NsHttps.request = wrapFunction<typeof NsHttps.request>(
    (options: Parameters<typeof NsHttps.request>[0]) => runWrappedOperation(() => buildRequestMetadata('request', 'HTTPS request', options), () => getNsHttps().request(options)),
    (options: Parameters<typeof NsHttps.request.promise>[0]) => runWrappedOperation(() => buildRequestMetadata('request', 'HTTPS request', options), () => getNsHttps().request.promise(options)),
);

export const requestRestlet: typeof NsHttps.requestRestlet = wrapFunction<typeof NsHttps.requestRestlet>(
    (options: Parameters<typeof NsHttps.requestRestlet>[0]) => runWrappedOperation(() => buildRequestMetadata('requestRestlet', 'HTTPS RESTlet request', options), () => getNsHttps().requestRestlet(options)),
    (options: Parameters<typeof NsHttps.requestRestlet.promise>[0]) => runWrappedOperation(() => buildRequestMetadata('requestRestlet', 'HTTPS RESTlet request', options), () => getNsHttps().requestRestlet.promise(options)),
);

export const requestSuitelet: typeof NsHttps.requestSuitelet = wrapFunction<typeof NsHttps.requestSuitelet>(
    (options: Parameters<typeof NsHttps.requestSuitelet>[0]) => runWrappedOperation(() => buildRequestMetadata('requestSuitelet', 'HTTPS Suitelet request', options), () => getNsHttps().requestSuitelet(options)),
    (options: Parameters<typeof NsHttps.requestSuitelet.promise>[0]) => runWrappedOperation(() => buildRequestMetadata('requestSuitelet', 'HTTPS Suitelet request', options), () => getNsHttps().requestSuitelet.promise(options)),
);

export const requestSuiteTalkRest = ((options: Parameters<typeof NsHttps.requestSuiteTalkRest>[0]) => runWrappedOperation(() => buildRequestMetadata('requestSuiteTalkRest', 'HTTPS SuiteTalk REST request', options), () => getNsHttps().requestSuiteTalkRest(options))) as typeof NsHttps.requestSuiteTalkRest;

export { deleteRequestBase as delete };