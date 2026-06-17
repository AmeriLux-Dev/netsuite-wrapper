import { recordFunctionInvocation } from './execution-tracking';

declare const require: <T = unknown>(moduleName: string) => T;

export interface FunctionCallerContext {
    functionName: string;
    functionContext: string;
    filePath: string;
    modulePath: string;
    className?: string;
    methodName?: string;
    instrumentationSource: string;
    excludeFromObservedFunctions?: boolean;
}

const functionContextStack: FunctionCallerContext[] = [];

let cachedRuntime: typeof import('N/runtime') | null = null;

function cloneFunctionContext(context: FunctionCallerContext): FunctionCallerContext {
    return {
        ...context,
    };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return Boolean(value) && typeof (value as { then?: unknown }).then === 'function';
}

function loadRuntimeModule(): typeof import('N/runtime') {
    const loaded = require<typeof import('N/runtime')>('N/runtime');
    cachedRuntime = loaded;
    return loaded;
}

// Reads remaining governance units for the current script. Returns 0 when N/runtime is unavailable
// (e.g. outside SuiteScript / in tests) so callers can treat 0 as "not captured".
function readRemainingUsage(): number {
    try {
        const runtimeModule = cachedRuntime ?? loadRuntimeModule();
        const remaining = runtimeModule.getCurrentScript().getRemainingUsage();
        return typeof remaining === 'number' && remaining > 0 ? remaining : 0;
    } catch (_error) {
        return 0;
    }
}

function removeFunctionContext(context: FunctionCallerContext): void {
    const contextIndex = functionContextStack.lastIndexOf(context);
    if (contextIndex !== -1) {
        functionContextStack.splice(contextIndex, 1);
    }
}

export function getActiveFunctionContext(): FunctionCallerContext | null {
    const activeContext = functionContextStack[functionContextStack.length - 1];
    return activeContext ? cloneFunctionContext(activeContext) : null;
}

function isWrapperAdapterContext(context: FunctionCallerContext): boolean {
    const modulePath = context.modulePath || context.filePath || '';
    return modulePath.startsWith('netsuite-wrapper/')
        || modulePath.includes('/netsuite-wrapper/');
}

function isInfrastructureContext(context: FunctionCallerContext): boolean {
    return Boolean(context.excludeFromObservedFunctions);
}

export function getPreferredActiveFunctionContext(): FunctionCallerContext | null {
    for (let index = functionContextStack.length - 1; index >= 0; index -= 1) {
        const context = functionContextStack[index];
        if (!isWrapperAdapterContext(context) && !isInfrastructureContext(context)) {
            return cloneFunctionContext(context);
        }
    }

    for (let index = functionContextStack.length - 1; index >= 0; index -= 1) {
        const context = functionContextStack[index];
        if (!isInfrastructureContext(context)) {
            return cloneFunctionContext(context);
        }
    }

    const activeContext = functionContextStack[functionContextStack.length - 1];
    return activeContext ? cloneFunctionContext(activeContext) : null;
}

export function getFunctionContextStack(): FunctionCallerContext[] {
    return functionContextStack.map(cloneFunctionContext);
}

export function withFunctionContext<T>(context: FunctionCallerContext, work: () => T): T {
    const trackedContext = cloneFunctionContext(context);
    const startedAt = Date.now();
    const startUsage = readRemainingUsage();
    let didFinish = false;

    const finish = (): void => {
        if (didFinish) {
            return;
        }

        didFinish = true;
        recordFunctionInvocation(trackedContext, startedAt, Date.now(), startUsage, readRemainingUsage());
        removeFunctionContext(trackedContext);
    };

    functionContextStack.push(trackedContext);

    try {
        const result = work();

        if (isPromiseLike(result)) {
            return result.then((value) => {
                finish();
                return value;
            }, (error) => {
                finish();
                throw error;
            }) as T;
        }

        finish();
        return result;
    } catch (error) {
        finish();
        throw error;
    }
}
