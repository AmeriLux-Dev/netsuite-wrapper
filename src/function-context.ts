import { recordFunctionInvocation } from './execution-tracking';

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

function cloneFunctionContext(context: FunctionCallerContext): FunctionCallerContext {
    return {
        ...context,
    };
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
    let didCleanup = false;

    const cleanup = (): void => {
        if (didCleanup) {
            return;
        }

        didCleanup = true;
        removeFunctionContext(trackedContext);
    };

    functionContextStack.push(trackedContext);
    recordFunctionInvocation(trackedContext);

    try {
        const result = work();

        if (result && typeof (result as { then?: unknown }).then === 'function') {
            const asyncResult = result as unknown as PromiseLike<unknown>;
            return asyncResult.then((value) => {
                cleanup();
                return value;
            }, (error) => {
                cleanup();
                throw error;
            }) as T;
        }

        cleanup();
        return result;
    } catch (error) {
        cleanup();
        throw error;
    }
}