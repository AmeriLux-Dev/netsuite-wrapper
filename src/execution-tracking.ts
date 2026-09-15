import type { FunctionCallerContext } from './function-context';

export interface TrackedScriptEntryMetadata {
    scopeKey: string;
    entryKind: string;
    entryKey: string;
    filePath: string;
    modulePath: string;
    scriptType: string;
}

export interface ObservedFunctionSummary {
    functionName: string;
    modulePath: string;
    filePath: string;
    count: number;
    startedAt: number;
    endedAt: number;
    totalDurationMs: number;
    totalUsage: number;
    parentFunctionName: string;
    parentModulePath: string;
}

export interface ObservedFunctionParent {
    parentFunctionName?: string;
    parentModulePath?: string;
}

/** An error thrown out of an instrumented function, recorded once at the innermost function it left. */
export interface ObservedFunctionError {
    functionName: string;
    modulePath: string;
    filePath: string;
    errorName: string;
    message: string;
    stack: string;
    /** The failing function's arguments, snapshotted; absent when the function opted out of capture. */
    functionArguments?: Record<string, unknown>;
}

export interface ActiveTrackedExecutionSnapshot extends TrackedScriptEntryMetadata {
    executionId: string;
    flowId: string;
    observedFunctions: ObservedFunctionSummary[];
    observedErrors: ObservedFunctionError[];
}

type ActiveTrackedExecutionState = TrackedScriptEntryMetadata & {
    executionId: string;
    flowId: string;
    observedFunctions: Map<string, ObservedFunctionSummary>;
    observedErrors: ObservedFunctionError[];
    /** Error objects already recorded, so the same error is not recorded again at every function it propagates through. */
    seenErrors: WeakSet<object>;
};

const MAX_OBSERVED_ERRORS = 10;
const MAX_ERROR_STACK_LENGTH = 2000;

const trackedExecutionStack: ActiveTrackedExecutionState[] = [];

function normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function normalizePositive(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function makeId(prefix: string, startedAt: Date): string {
    const randomComponent = Math.floor(Math.random() * 0xffffff).toString(36);
    return `${prefix}_${startedAt.getTime().toString(36)}_${randomComponent}`;
}

function createFlowId(executionId: string): string {
    return `flow_${executionId}`;
}

function cloneObservedFunctionSummary(summary: ObservedFunctionSummary): ObservedFunctionSummary {
    return {
        ...summary,
    };
}

function toSnapshot(state: ActiveTrackedExecutionState): ActiveTrackedExecutionSnapshot {
    return {
        executionId: state.executionId,
        flowId: state.flowId,
        scopeKey: state.scopeKey,
        entryKind: state.entryKind,
        entryKey: state.entryKey,
        filePath: state.filePath,
        modulePath: state.modulePath,
        scriptType: state.scriptType,
        observedFunctions: Array.from(state.observedFunctions.values())
            .map(cloneObservedFunctionSummary)
            .sort((left, right) => {
                if (right.count !== left.count) {
                    return right.count - left.count;
                }

                if (left.modulePath !== right.modulePath) {
                    return left.modulePath.localeCompare(right.modulePath);
                }

                return left.functionName.localeCompare(right.functionName);
            }),
        observedErrors: state.observedErrors.map((observedError) => ({ ...observedError })),
    };
}

export function getActiveTrackedExecutionSnapshot(): ActiveTrackedExecutionSnapshot | null {
    const activeExecution = trackedExecutionStack[trackedExecutionStack.length - 1];
    return activeExecution ? toSnapshot(activeExecution) : null;
}

export function startTrackedScriptExecution(metadata: TrackedScriptEntryMetadata, startedAt = new Date()): ActiveTrackedExecutionSnapshot {
    const executionId = makeId('exec', startedAt);
    const activeExecution: ActiveTrackedExecutionState = {
        executionId,
        flowId: createFlowId(executionId),
        scopeKey: normalizeText(metadata.scopeKey),
        entryKind: normalizeText(metadata.entryKind),
        entryKey: normalizeText(metadata.entryKey),
        filePath: normalizeText(metadata.filePath),
        modulePath: normalizeText(metadata.modulePath),
        scriptType: normalizeText(metadata.scriptType),
        observedFunctions: new Map<string, ObservedFunctionSummary>(),
        observedErrors: [],
        seenErrors: new WeakSet<object>(),
    };

    trackedExecutionStack.push(activeExecution);
    return toSnapshot(activeExecution);
}

export function finishTrackedScriptExecution(executionId?: string): ActiveTrackedExecutionSnapshot | null {
    if (trackedExecutionStack.length === 0) {
        return null;
    }

    if (!executionId) {
        const activeExecution = trackedExecutionStack.pop();
        return activeExecution ? toSnapshot(activeExecution) : null;
    }

    for (let index = trackedExecutionStack.length - 1; index >= 0; index -= 1) {
        if (trackedExecutionStack[index].executionId === executionId) {
            const [activeExecution] = trackedExecutionStack.splice(index, 1);
            return activeExecution ? toSnapshot(activeExecution) : null;
        }
    }

    return null;
}

export function recordFunctionInvocation(context: FunctionCallerContext, startedAt = 0, endedAt = 0, startUsage = 0, endUsage = 0, parent: ObservedFunctionParent = {}): void {
    const activeExecution = trackedExecutionStack[trackedExecutionStack.length - 1];
    if (!activeExecution) {
        return;
    }

    if (context.excludeFromObservedFunctions) {
        return;
    }

    const functionName = normalizeText(context.functionName);
    const modulePath = normalizeText(context.modulePath) || normalizeText(context.filePath);
    if (!functionName || !modulePath) {
        return;
    }

    const startMs = normalizePositive(startedAt);
    const endMs = normalizePositive(endedAt);
    const startUnits = normalizePositive(startUsage);
    const endUnits = normalizePositive(endUsage);
    const durationMs = endMs > startMs ? endMs - startMs : 0;
    const usage = startUnits > 0 && endUnits > 0 && startUnits >= endUnits ? startUnits - endUnits : 0;
    const parentFunctionName = normalizeText(parent.parentFunctionName);
    const parentModulePath = normalizeText(parent.parentModulePath);

    const observationKey = `${parentModulePath}::${parentFunctionName}>>${modulePath}::${functionName}`;
    const existingSummary = activeExecution.observedFunctions.get(observationKey);
    if (existingSummary) {
        existingSummary.count += 1;
        existingSummary.totalDurationMs += durationMs;
        existingSummary.totalUsage += usage;
        existingSummary.startedAt = lowestPositive(existingSummary.startedAt, startMs);
        existingSummary.endedAt = Math.max(existingSummary.endedAt, endMs);
        return;
    }

    activeExecution.observedFunctions.set(observationKey, {
        functionName,
        modulePath,
        filePath: normalizeText(context.filePath),
        count: 1,
        startedAt: startMs,
        endedAt: endMs,
        totalDurationMs: durationMs,
        totalUsage: usage,
        parentFunctionName,
        parentModulePath,
    });
}

/**
 * Records an error leaving an instrumented function on the active run. The same error object is
 * recorded once, at the innermost function it left, however many callers rethrow it. Returns true
 * when the error was recorded now.
 */
export function recordFunctionError(context: FunctionCallerContext, error: unknown, functionArguments?: Record<string, unknown>): boolean {
    const activeExecution = trackedExecutionStack[trackedExecutionStack.length - 1];
    if (!activeExecution) {
        return false;
    }

    if (error !== null && typeof error === 'object') {
        if (activeExecution.seenErrors.has(error)) {
            return false;
        }

        activeExecution.seenErrors.add(error);
    }

    if (activeExecution.observedErrors.length >= MAX_OBSERVED_ERRORS) {
        return false;
    }

    const errorObject = (error !== null && typeof error === 'object' ? error : {}) as { name?: unknown; message?: unknown; stack?: unknown };
    activeExecution.observedErrors.push({
        functionName: normalizeText(context.functionName),
        modulePath: normalizeText(context.modulePath) || normalizeText(context.filePath),
        filePath: normalizeText(context.filePath),
        errorName: normalizeText(errorObject.name),
        message: normalizeText(errorObject.message) || (typeof error === 'object' ? '' : normalizeText(error)),
        stack: normalizeText(errorObject.stack).slice(0, MAX_ERROR_STACK_LENGTH),
        ...(functionArguments ? { functionArguments } : {}),
    });
    return true;
}

function lowestPositive(existing: number, candidate: number): number {
    if (candidate <= 0) {
        return existing;
    }

    if (existing <= 0) {
        return candidate;
    }

    return Math.min(existing, candidate);
}
