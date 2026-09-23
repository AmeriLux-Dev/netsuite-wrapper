import type * as NsRuntime from 'N/runtime';
import { runWrappedOperation } from './telemetry';
import { forwardModuleExports } from './lazy-module';

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
export const country = undefined as unknown as typeof NsRuntime.country;
export const processorCount = undefined as unknown as typeof NsRuntime.processorCount;
export const queueCount = undefined as unknown as typeof NsRuntime.queueCount;

export const getCurrentScript = (() => runWrappedOperation(() => buildRuntimeMetadata('getCurrentScript', 'Get current script runtime context'), () => getNsRuntime().getCurrentScript())) as typeof NsRuntime.getCurrentScript;

export const getCurrentSession = (() => runWrappedOperation(() => buildRuntimeMetadata('getCurrentSession', 'Get current runtime session'), () => getNsRuntime().getCurrentSession())) as typeof NsRuntime.getCurrentSession;

export const getCurrentUser = (() => runWrappedOperation(() => buildRuntimeMetadata('getCurrentUser', 'Get current runtime user'), () => getNsRuntime().getCurrentUser())) as typeof NsRuntime.getCurrentUser;

export const isFeatureInEffect = ((options: Parameters<typeof NsRuntime.isFeatureInEffect>[0]) => runWrappedOperation(() => buildRuntimeMetadata('isFeatureInEffect', 'Check NetSuite feature flag', {
    feature: normalizeText((options as { feature?: unknown }).feature),
}), () => getNsRuntime().isFeatureInEffect(options))) as typeof NsRuntime.isFeatureInEffect;

// Last, so every export above is in place: the N module fills the placeholders and anything not instrumented.
forwardModuleExports(moduleExports, getNsRuntime);
