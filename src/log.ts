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

let traceLogEnabled = false;

export function isTraceLogEnabled(): boolean {
    return traceLogEnabled;
}

export function setTraceLogEnabled(enabled: boolean): void {
    traceLogEnabled = enabled === true;
}

export type ChunkLogMode = 'group' | 'silent' | 'off';

let chunkLogMode: ChunkLogMode = 'group';

export function getChunkLogMode(): ChunkLogMode {
    return chunkLogMode;
}

export function setChunkLogMode(mode: ChunkLogMode): void {
    chunkLogMode = mode === 'silent' || mode === 'off' ? mode : 'group';
}

function emitTraceLog(stage: string, details: unknown): void {
    if (!traceLogEnabled) {
        return;
    }

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

function buildTrackerDetailPrefix(snapshot: ActiveTrackedExecutionSnapshot | null, activeFunctionContext: ActiveFunctionContext | null): string {
    const executionTag = snapshot?.executionId ? `[${snapshot.executionId}] ` : '';
    const functionTag = buildTrackerFunctionTitleTag(activeFunctionContext);

    return `${executionTag}${functionTag}`;
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

function splitBodyIntoSlices(detailBody: string, capacity: number): string[] {
    if (capacity <= 0) {
        return [detailBody];
    }

    const slices: string[] = [];
    for (let start = 0; start < detailBody.length; start += capacity) {
        slices.push(detailBody.slice(start, start + capacity));
    }

    return slices.length === 0 ? [''] : slices;
}

function buildSilentChunks(detailPrefix: string, detailBody: string): string[] {
    const capacity = MAX_CHUNK_DETAIL_LENGTH - detailPrefix.length;
    return splitBodyIntoSlices(detailBody, capacity).map((slice) => `${detailPrefix}${slice}`);
}

function buildGroupedChunks(detailPrefix: string, detailBody: string): string[] {
    const groupId = createChunkGroupId();
    let estimatedTotal = Math.max(
        2,
        Math.ceil(detailBody.length / Math.max(1, MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, 1, 2).length - detailPrefix.length)),
    );

    while (true) {
        const chunkCapacity = MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, estimatedTotal, estimatedTotal).length - detailPrefix.length;

        if (chunkCapacity <= 0) {
            const token = buildChunkToken(groupId, 1, 1);
            const capacity = Math.max(0, MAX_CHUNK_DETAIL_LENGTH - token.length - detailPrefix.length);
            return [`${token}${detailPrefix}${detailBody.slice(0, capacity)}`];
        }

        const actualTotal = Math.ceil(detailBody.length / chunkCapacity);
        if (actualTotal === estimatedTotal) {
            const chunks: string[] = [];
            for (let index = 0; index < actualTotal; index += 1) {
                const token = buildChunkToken(groupId, index + 1, actualTotal);
                const payloadStart = index * chunkCapacity;
                const payloadEnd = payloadStart + chunkCapacity;
                chunks.push(`${token}${detailPrefix}${detailBody.slice(payloadStart, payloadEnd)}`);
            }
            return chunks;
        }

        estimatedTotal = actualTotal;
    }
}

function buildDetailLines(detailPrefix: string, detailBody: string): string[] {
    const combined = `${detailPrefix}${detailBody}`;

    if (chunkLogMode === 'off' || combined.length <= MAX_CHUNK_DETAIL_LENGTH) {
        return [combined];
    }

    if (chunkLogMode === 'silent') {
        return buildSilentChunks(detailPrefix, detailBody);
    }

    return buildGroupedChunks(detailPrefix, detailBody);
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
    const detailPrefix = buildTrackerDetailPrefix(activeExecution, activeFunctionContext);
    const titleText = normalizedCall.title;
    const detailBody = serializeDetailsForLog(normalizedCall.details);
    const detailLines = buildDetailLines(detailPrefix, detailBody);

    emitTraceLog('emitLog', {
        method,
        inputTitle: normalizedCall.title,
        executionId: activeExecution?.executionId || '',
        flowId: activeExecution?.flowId || '',
        activeFunction: activeFunctionContext?.functionName || '',
        activeModule: activeFunctionContext?.modulePath || activeFunctionContext?.filePath || '',
        detailPrefix,
        title: titleText,
        detailLength: detailBody.length,
        chunkMode: chunkLogMode,
        chunkCount: detailLines.length,
    });

    for (const line of detailLines) {
        nsLog[method]({
            title: titleText,
            details: line,
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
