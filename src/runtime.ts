import type * as NsRuntime from 'N/runtime';
import { runWrappedOperation } from './telemetry';
import { defineLazyExport } from './lazy-module';

declare const require: <T = unknown>(moduleName: string) => T;
declare const exports: Record<string, unknown>;

const moduleExports = exports;

function getNsRuntime(): typeof import('N/runtime') {
    return require<typeof import('N/runtime')>('N/runtime');
}

function normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function buildRuntimeMetadata(action: string, summary: string, detail?: Record<string, unknown>) {
    return {
        module: 'runtime',
        action,
        summary,
        detail,
    } as const;
}

export const accountId = undefined as unknown as typeof NsRuntime.accountId;
export const version = undefined as unknown as typeof NsRuntime.version;
export const executionContext = undefined as unknown as typeof NsRuntime.executionContext;
export const envType = undefined as unknown as typeof NsRuntime.envType;
export const ContextType = undefined as unknown as typeof NsRuntime.ContextType;
export const EnvType = undefined as unknown as typeof NsRuntime.EnvType;
export const Permission = undefined as unknown as typeof NsRuntime.Permission;
defineLazyExport(moduleExports, 'accountId', () => getNsRuntime().accountId);
defineLazyExport(moduleExports, 'version', () => getNsRuntime().version);
defineLazyExport(moduleExports, 'executionContext', () => getNsRuntime().executionContext);
defineLazyExport(moduleExports, 'envType', () => getNsRuntime().envType);
defineLazyExport(moduleExports, 'ContextType', () => getNsRuntime().ContextType);
defineLazyExport(moduleExports, 'EnvType', () => getNsRuntime().EnvType);
defineLazyExport(moduleExports, 'Permission', () => getNsRuntime().Permission);

export const getCurrentScript = (() => runWrappedOperation(() => buildRuntimeMetadata('getCurrentScript', 'Get current script runtime context'), () => getNsRuntime().getCurrentScript())) as typeof NsRuntime.getCurrentScript;

export const getCurrentSession = (() => runWrappedOperation(() => buildRuntimeMetadata('getCurrentSession', 'Get current runtime session'), () => getNsRuntime().getCurrentSession())) as typeof NsRuntime.getCurrentSession;

export const getCurrentUser = (() => runWrappedOperation(() => buildRuntimeMetadata('getCurrentUser', 'Get current runtime user'), () => getNsRuntime().getCurrentUser())) as typeof NsRuntime.getCurrentUser;

export const isFeatureInEffect = ((options: Parameters<typeof NsRuntime.isFeatureInEffect>[0]) => runWrappedOperation(() => buildRuntimeMetadata('isFeatureInEffect', 'Check NetSuite feature flag', {
    feature: normalizeText((options as { feature?: unknown }).feature),
}), () => getNsRuntime().isFeatureInEffect(options))) as typeof NsRuntime.isFeatureInEffect;