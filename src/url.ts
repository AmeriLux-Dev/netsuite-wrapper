import type * as NsUrl from 'N/url';
import { runWrappedOperation } from './telemetry';
import { defineLazyExport } from './lazy-module';

declare const require: <T = unknown>(moduleName: string) => T;
declare const exports: Record<string, unknown>;

const moduleExports = exports;

function getNsUrl(): typeof import('N/url') {
    return require<typeof import('N/url')>('N/url');
}

export const HostType = undefined as unknown as typeof NsUrl.HostType;
defineLazyExport(moduleExports, 'HostType', () => getNsUrl().HostType);

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

function normalizeParams(value: unknown): string {
    if (!value || typeof value !== 'object') {
        return '';
    }

    return Object.keys(value as Record<string, unknown>).sort().join(',');
}

function buildTargetMetadata(action: string, options: unknown): { targetType: string; targetKey: string } {
    if (action === 'resolveRecord') {
        const recordType = normalizeText(getOptionValue(options, 'recordType'));
        const recordId = normalizeText(getOptionValue(options, 'recordId')) || 'new';
        return {
            targetType: 'record',
            targetKey: `${recordType}:${recordId}`,
        };
    }

    if (action === 'resolveScript') {
        const scriptId = normalizeText(getOptionValue(options, 'scriptId'));
        const deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));
        return {
            targetType: 'script',
            targetKey: `${scriptId}${deploymentId ? `/${deploymentId}` : ''}`,
        };
    }

    if (action === 'resolveDomain') {
        const hostType = normalizeText(getOptionValue(options, 'hostType'));
        const accountId = normalizeText(getOptionValue(options, 'accountId'));
        return {
            targetType: 'domain',
            targetKey: `${hostType}${accountId ? `:${accountId}` : ''}`,
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

function buildUrlMetadata(action: string, summary: string, options: unknown) {
    const targetMetadata = buildTargetMetadata(action, options);

    return {
        module: 'url',
        action,
        summary,
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
    } as const;
}

export const format = ((options: Parameters<typeof NsUrl.format>[0]) => runWrappedOperation(() => buildUrlMetadata('format', 'Format NetSuite URL parameters', options), () => getNsUrl().format(options))) as typeof NsUrl.format;

export const resolveDomain = ((options: Parameters<typeof NsUrl.resolveDomain>[0]) => runWrappedOperation(() => buildUrlMetadata('resolveDomain', 'Resolve NetSuite domain', options), () => getNsUrl().resolveDomain(options))) as typeof NsUrl.resolveDomain;

export const resolveRecord = ((options: Parameters<typeof NsUrl.resolveRecord>[0]) => runWrappedOperation(() => buildUrlMetadata('resolveRecord', 'Resolve NetSuite record URL', options), () => getNsUrl().resolveRecord(options))) as typeof NsUrl.resolveRecord;

export const resolveScript = ((options: Parameters<typeof NsUrl.resolveScript>[0]) => runWrappedOperation(() => buildUrlMetadata('resolveScript', 'Resolve NetSuite script URL', options), () => getNsUrl().resolveScript(options))) as typeof NsUrl.resolveScript;

export const resolveTaskLink = ((options: Parameters<typeof NsUrl.resolveTaskLink>[0]) => runWrappedOperation(() => buildUrlMetadata('resolveTaskLink', 'Resolve NetSuite task link URL', options), () => getNsUrl().resolveTaskLink(options))) as typeof NsUrl.resolveTaskLink;