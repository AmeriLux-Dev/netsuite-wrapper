import { hasActiveTrackedExecution, recordFunctionError, recordFunctionInvocation } from './execution-tracking';
import { snapshotFunctionArguments } from './value-snapshot';

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
    /** Parameter names in order, written by the build; pairs with the argument values passed at call time. */
    parameterNames?: string[];
}

const functionContextStack: FunctionCallerContext[] = [];

// Argument values live beside the stack, never on the context object: contexts are cloned into
// snapshots and span details, and raw arguments (records, large arrays) must not travel with them.
// They are only read, and only then serialized, when a log call or an error asks for them.
const argumentValuesByContext = new WeakMap<FunctionCallerContext, readonly unknown[]>();

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

function snapshotContextArguments(context: FunctionCallerContext): Record<string, unknown> | undefined {
    const argumentValues = argumentValuesByContext.get(context);
    if (!argumentValues) {
        return undefined;
    }

    try {
        return snapshotFunctionArguments(context.parameterNames || [], argumentValues);
    } catch (_error) {
        return undefined;
    }
}

/**
 * The arguments of the innermost instrumented application function, snapshotted now. Wrapper-internal
 * and infrastructure frames are skipped, the same way the log tag picks its function. Undefined when
 * nothing is on the stack or that function opted out of argument capture.
 */
export function snapshotActiveFunctionArguments(): Record<string, unknown> | undefined {
    for (let index = functionContextStack.length - 1; index >= 0; index -= 1) {
        const context = functionContextStack[index];
        if (!isWrapperAdapterContext(context) && !isInfrastructureContext(context)) {
            return snapshotContextArguments(context);
        }
    }

    return undefined;
}

/** The instrumented functions currently on the stack, outermost first, as `name -> name -> name`. */
export function getFunctionCallChainLabel(): string {
    return functionContextStack
        .filter((context) => !isWrapperAdapterContext(context) && !isInfrastructureContext(context))
        .map((context) => context.functionName)
        .filter(Boolean)
        .join(' -> ');
}

export function withFunctionContext<T>(context: FunctionCallerContext, work: () => T, argumentValues?: readonly unknown[]): T {
    const trackedContext = cloneFunctionContext(context);
    const parentContext = getPreferredActiveFunctionContext();
    const startedAt = Date.now();
    const startUsage = readRemainingUsage();
    let didFinish = false;

    if (argumentValues) {
        argumentValuesByContext.set(trackedContext, argumentValues);
    }

    const finish = (): void => {
        if (didFinish) {
            return;
        }

        didFinish = true;
        recordFunctionInvocation(trackedContext, startedAt, Date.now(), startUsage, readRemainingUsage(), {
            parentFunctionName: parentContext?.functionName,
            parentModulePath: parentContext?.modulePath || parentContext?.filePath,
        });
        removeFunctionContext(trackedContext);
    };

    const fail = (error: unknown): void => {
        // Arguments are serialised only when a tracked run will keep the record; an untracked
        // script pays nothing extra on its error path.
        if (hasActiveTrackedExecution()) {
            try {
                recordFunctionError(trackedContext, error, snapshotContextArguments(trackedContext));
            } catch (_recordError) {
                // Recording the failure must never replace the failure.
            }
        }

        finish();
    };

    functionContextStack.push(trackedContext);

    try {
        const result = work();

        if (isPromiseLike(result)) {
            return result.then((value) => {
                finish();
                return value;
            }, (error) => {
                fail(error);
                throw error;
            }) as T;
        }

        finish();
        return result;
    } catch (error) {
        fail(error);
        throw error;
    }
}
