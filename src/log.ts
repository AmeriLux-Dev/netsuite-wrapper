declare const require: <T = unknown>(moduleName: string) => T;

declare const exports: Record<string, unknown>;

const LOG_CHUNK_MARKER = '[[NSW_CHUNK';
const MAX_CHUNK_DETAIL_LENGTH = 3980;

type LogMethodName = 'debug' | 'audit' | 'error' | 'emergency';

type LogCallOptions = {
    title: string;
    details?: unknown;
};

type ActiveTrackedExecutionSnapshot = {
    executionId: string;
    flowId: string;
};

type ActiveFunctionContext = {
    functionName: string;
    modulePath?: string;
    filePath?: string;
};

function getNsLog(): typeof import('N/log') {
    return require<typeof import('N/log')>('N/log');
}

function emitTraceLog(stage: string, details: unknown): void {
    try {
        getNsLog().audit({
            title: `[NSW_TRACE] ${stage}`,
            details: stringifyDetails(details),
        });
    } catch (_error) {
        // Trace logging must never block the real log path.
    }
}

function getActiveTrackedExecutionSnapshot(): ActiveTrackedExecutionSnapshot | null {
    try {
        const executionTracking = require<typeof import('./execution-tracking')>('./execution-tracking');
        return executionTracking.getActiveTrackedExecutionSnapshot();
    } catch (error) {
        emitTraceLog('getActiveTrackedExecutionSnapshot.error', {
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function getActiveFunctionContext(): ActiveFunctionContext | null {
    try {
        const functionContext = require<typeof import('./function-context')>('./function-context');
        return functionContext.getActiveFunctionContext();
    } catch (error) {
        emitTraceLog('getActiveFunctionContext.error', {
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function normalizeTitle(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value);
}

function stringifyDetails(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch (_error) {
        return String(value);
    }
}

function buildTrackerFunctionTitleTag(activeFunctionContext: ActiveFunctionContext | null): string {
    const activeFunctionName = normalizeTitle(activeFunctionContext?.functionName);
    const activeFunctionModulePath = normalizeTitle(activeFunctionContext?.modulePath || activeFunctionContext?.filePath);

    if (!activeFunctionName) {
        return '';
    }

    return activeFunctionModulePath
        ? `[fn:${activeFunctionName}::${activeFunctionModulePath}] `
        : `[fn:${activeFunctionName}] `;
}

function buildTrackerTitlePrefix(snapshot: ActiveTrackedExecutionSnapshot | null, activeFunctionContext: ActiveFunctionContext | null): string {
    const executionTitlePrefix = snapshot?.executionId ? `[${snapshot.executionId}] ` : '';
    const functionTitlePrefix = buildTrackerFunctionTitleTag(activeFunctionContext);

    return `${executionTitlePrefix}${functionTitlePrefix}`;
}

function serializeTitleForLog(title: string, trackerTitlePrefix: string): string {
    if (!trackerTitlePrefix) {
        return title;
    }

    if (title.startsWith(trackerTitlePrefix)) {
        return title;
    }

    return `${trackerTitlePrefix}${title}`;
}

function serializeDetailsForLog(details: unknown): string {
    return stringifyDetails(details);
}

function createChunkGroupId(): string {
    const timestamp = Date.now().toString(36);
    const randomComponent = Math.floor(Math.random() * 0xffffff).toString(36).padStart(4, '0');
    return `${timestamp}${randomComponent}`;
}

function buildChunkToken(groupId: string, index: number, total: number): string {
    return `${LOG_CHUNK_MARKER}|${groupId}|${index}/${total}]] `;
}

function splitDetailIntoChunks(detailText: string): string[] {
    if (detailText.length <= MAX_CHUNK_DETAIL_LENGTH) {
        return [detailText];
    }

    const groupId = createChunkGroupId();
    let estimatedTotal = Math.max(2, Math.ceil(detailText.length / (MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, 1, 2).length)));

    while (true) {
        const chunkCapacity = MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, estimatedTotal, estimatedTotal).length;

        if (chunkCapacity <= 0) {
            return [detailText.slice(0, MAX_CHUNK_DETAIL_LENGTH)];
        }

        const actualTotal = Math.ceil(detailText.length / chunkCapacity);
        if (actualTotal === estimatedTotal) {
            const chunks: string[] = [];
            for (let index = 0; index < actualTotal; index += 1) {
                const token = buildChunkToken(groupId, index + 1, actualTotal);
                const payloadStart = index * chunkCapacity;
                const payloadEnd = payloadStart + chunkCapacity;
                chunks.push(`${token}${detailText.slice(payloadStart, payloadEnd)}`);
            }
            return chunks;
        }

        estimatedTotal = actualTotal;
    }
}

function normalizeLogCall(titleOrOptions: string | LogCallOptions, details?: unknown): LogCallOptions {
    if (typeof titleOrOptions === 'string') {
        return {
            title: titleOrOptions,
            details,
        };
    }

    return {
        title: normalizeTitle(titleOrOptions.title),
        details: titleOrOptions.details,
    };
}

function emitLog(method: LogMethodName, titleOrOptions: string | LogCallOptions, details?: unknown): void {
    const nsLog = getNsLog();
    const normalizedCall = normalizeLogCall(titleOrOptions, details);
    const activeExecution = getActiveTrackedExecutionSnapshot();
    const activeFunctionContext = getActiveFunctionContext();
    const trackerTitlePrefix = buildTrackerTitlePrefix(activeExecution, activeFunctionContext);
    const titleText = serializeTitleForLog(normalizedCall.title, trackerTitlePrefix);
    const detailText = serializeDetailsForLog(normalizedCall.details);
    const detailChunks = splitDetailIntoChunks(detailText);

    emitTraceLog('emitLog', {
        method,
        inputTitle: normalizedCall.title,
        executionId: activeExecution?.executionId || '',
        flowId: activeExecution?.flowId || '',
        activeFunction: activeFunctionContext?.functionName || '',
        activeModule: activeFunctionContext?.modulePath || activeFunctionContext?.filePath || '',
        trackerTitlePrefix,
        finalTitle: titleText,
        detailLength: detailText.length,
        chunkCount: detailChunks.length,
    });

    if (detailChunks.length === 1 && detailText.length <= MAX_CHUNK_DETAIL_LENGTH) {
        nsLog[method]({
            title: titleText,
            details: detailText,
        });
        return;
    }

    for (const chunk of detailChunks) {
        nsLog[method]({
            title: titleText,
            details: chunk,
        });
    }
}

export function debug(options: LogCallOptions): void;
export function debug(title: string, details?: unknown): void;
export function debug(titleOrOptions: string | LogCallOptions, details?: unknown): void {
    emitLog('debug', titleOrOptions, details);
}

export function audit(options: LogCallOptions): void;
export function audit(title: string, details?: unknown): void;
export function audit(titleOrOptions: string | LogCallOptions, details?: unknown): void {
    emitLog('audit', titleOrOptions, details);
}

export function error(options: LogCallOptions): void;
export function error(title: string, details?: unknown): void;
export function error(titleOrOptions: string | LogCallOptions, details?: unknown): void {
    emitLog('error', titleOrOptions, details);
}

export function emergency(options: LogCallOptions): void;
export function emergency(title: string, details?: unknown): void;
export function emergency(titleOrOptions: string | LogCallOptions, details?: unknown): void {
    emitLog('emergency', titleOrOptions, details);
}
