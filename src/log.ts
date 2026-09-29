import { reportWrapperFailure } from './fail-open';
import { forwardModuleExports } from './lazy-module';

declare const require: <T = unknown>(moduleName: string) => T;

declare const exports: Record<string, unknown>;

const LOG_CHUNK_MARKER = '[[NSW_CHUNK';
const MAX_CHUNK_DETAIL_LENGTH = 3980;
const LOG_ATTRIBUTE_TAIL_MARKER = '[[NSW_ATTR|1]]';
const MAX_LOG_ATTRIBUTE_JSON_LENGTH = 1024;

type LogMethodName = 'debug' | 'audit' | 'error' | 'emergency';

type LogCallOptions = {
    title: string;
    details?: unknown;
    /** Forwarded to telemetry as-is; also appended to the N/log detail as a versioned tail. */
    attributes?: Record<string, unknown>;
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

function getNsRuntime(): typeof import('N/runtime') {
    return require<typeof import('N/runtime')>('N/runtime');
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

let logAttributeTailEnabled = true;

export function isLogAttributeTailEnabled(): boolean {
    return logAttributeTailEnabled;
}

export function setLogAttributeTailEnabled(enabled: boolean): void {
    logAttributeTailEnabled = enabled !== false;
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

// Builds the structured entry exporters receive and queues it on the active run. Only runs when a
// tracked execution is active (otherwise there is no run to batch with) and only when some exporter
// wants log entries (otherwise the argument snapshot would be paid for nothing). The N/log write
// happens regardless; this is the second destination, never a replacement.
function forwardLogEntry(method: LogMethodName, normalizedCall: LogCallOptions, activeExecution: ActiveTrackedExecutionSnapshot | null, activeFunctionContext: ActiveFunctionContext | null): void {
    if (!activeExecution?.executionId) {
        return;
    }

    try {
        const telemetryExporter = require<typeof import('./telemetry-exporter')>('./telemetry-exporter');
        if (!telemetryExporter.hasLogAcceptingTelemetryExporter()) {
            return;
        }

        const functionContext = require<typeof import('./function-context')>('./function-context');
        let scriptId = '';
        let deploymentId = '';
        try {
            const currentScript = getNsRuntime().getCurrentScript() as unknown as Record<string, unknown>;
            scriptId = normalizeTitle(currentScript.id);
            deploymentId = normalizeTitle(currentScript.deploymentId);
        } catch (_runtimeError) {
            // Outside SuiteScript there is no current script.
        }

        // The entry names the innermost application function (wrapper-internal and infrastructure
        // frames skipped), the same frame whose arguments are snapshotted; the N/log tag keeps
        // using the raw top of the stack as before.
        const preferredFunctionContext = functionContext.getPreferredActiveFunctionContext() || activeFunctionContext;
        const functionArguments = functionContext.snapshotActiveFunctionArguments();
        const attributesSnapshot = hasLogAttributes(normalizedCall.attributes) ? snapshotLogAttributes(normalizedCall.attributes) : null;
        telemetryExporter.enqueueTelemetryLogEntry(activeExecution.executionId, {
            level: method,
            title: normalizedCall.title,
            details: normalizedCall.details === undefined ? null : normalizedCall.details,
            timestamp: new Date().toISOString(),
            executionId: activeExecution.executionId,
            flowId: activeExecution.flowId || '',
            scriptId,
            deploymentId,
            functionName: normalizeTitle(preferredFunctionContext?.functionName),
            functionModulePath: normalizeTitle(preferredFunctionContext?.modulePath || preferredFunctionContext?.filePath),
            callChain: functionContext.getFunctionCallChainLabel(),
            ...(functionArguments ? { functionArguments } : {}),
            ...(attributesSnapshot ? { attributes: attributesSnapshot } : {}),
        });
    } catch (error) {
        emitTraceLog('forwardLogEntry.error', {
            message: error instanceof Error ? error.message : String(error),
        });
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

function hasLogAttributes(attributes: Record<string, unknown> | undefined): attributes is Record<string, unknown> {
    if (!attributes || typeof attributes !== 'object') {
        return false;
    }

    try {
        return Object.keys(attributes).length > 0;
    } catch (_keysError) {
        // A Proxy with a throwing ownKeys still counts as "has attributes", so the drop is reported
        // through serializeLogAttributes rather than swallowed here.
        return true;
    }
}

// Sanitizes each key on its own so one bad value (a BigInt, a function, a throwing getter, a circular
// sub-structure) falls back to String(value) instead of dropping the whole payload.
function sanitizeLogAttributesForSerialization(attributes: Record<string, unknown>): Record<string, unknown> | null {
    let keys: string[];
    try {
        keys = Object.keys(attributes);
    } catch (_keysError) {
        return null;
    }

    const sanitized: Record<string, unknown> = {};
    for (const key of keys) {
        try {
            const value = attributes[key];
            if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
                sanitized[key] = String(value);
                continue;
            }

            JSON.stringify(value);
            sanitized[key] = value;
        } catch (_valueError) {
            try {
                sanitized[key] = String(attributes[key]);
            } catch (_stringError) {
                sanitized[key] = '[unserializable]';
            }
        }
    }

    return sanitized;
}

function serializeLogAttributes(attributes: Record<string, unknown>): string | null {
    const sanitized = sanitizeLogAttributesForSerialization(attributes);
    if (sanitized === null) {
        return null;
    }

    try {
        return JSON.stringify(sanitized);
    } catch (_error) {
        return null;
    }
}

// Entries are exported when the run ends, so the attributes are copied at the time of the call: a
// caller that reuses and mutates its attributes object afterwards does not change what was logged.
function snapshotLogAttributes(attributes: Record<string, unknown>): Record<string, unknown> | null {
    const json = serializeLogAttributes(attributes);
    if (json === null) {
        return null;
    }

    try {
        return JSON.parse(json) as Record<string, unknown>;
    } catch (_error) {
        return null;
    }
}

function buildLogAttributeTailText(json: string): string {
    return ` ${LOG_ATTRIBUTE_TAIL_MARKER}${json}`;
}

function buildDroppedLogAttributeTail(size: number): string {
    return buildLogAttributeTailText(JSON.stringify({ _dropped: true, _size: size }));
}

type ResolvedLogAttributeTail = {
    tail: string;
    detailBody: string;
};

// Resolves the `[[NSW_ATTR|1]]` tail (or a `_dropped` placeholder) and, for chunkMode 'off' only, the
// detail body cut to make room for it when the two together would not otherwise fit.
function resolveLogAttributeTail(
    chunkMode: ChunkLogMode,
    detailPrefix: string,
    detailBody: string,
    attributes: Record<string, unknown> | undefined,
): ResolvedLogAttributeTail {
    if (!logAttributeTailEnabled || !hasLogAttributes(attributes)) {
        return { tail: '', detailBody };
    }

    const json = serializeLogAttributes(attributes);
    if (json === null) {
        return { tail: buildDroppedLogAttributeTail(-1), detailBody };
    }

    if (json.length > MAX_LOG_ATTRIBUTE_JSON_LENGTH) {
        return { tail: buildDroppedLogAttributeTail(json.length), detailBody };
    }

    const tail = buildLogAttributeTailText(json);

    if (chunkMode !== 'off') {
        if (detailPrefix.length + tail.length > MAX_CHUNK_DETAIL_LENGTH) {
            return { tail: buildDroppedLogAttributeTail(json.length), detailBody };
        }

        return { tail, detailBody };
    }

    // Cutting the message adds "_truncated":true to the JSON, so the fit check reserves space for
    // that growth up front. The spread can throw the same way serializeLogAttributes guards against.
    let truncatedJson: string | null;
    try {
        truncatedJson = serializeLogAttributes({ ...attributes, _truncated: true });
    } catch (_spreadError) {
        truncatedJson = null;
    }
    const reservedTail = truncatedJson === null ? tail : buildLogAttributeTailText(truncatedJson);

    if (detailPrefix.length + reservedTail.length > MAX_CHUNK_DETAIL_LENGTH) {
        return { tail: buildDroppedLogAttributeTail(json.length), detailBody };
    }

    if (detailPrefix.length + detailBody.length + tail.length <= MAX_CHUNK_DETAIL_LENGTH) {
        return { tail, detailBody };
    }

    const capacity = Math.max(0, MAX_CHUNK_DETAIL_LENGTH - detailPrefix.length - reservedTail.length);
    return { tail: reservedTail, detailBody: detailBody.slice(0, capacity) };
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

// Same split as buildSilentChunks, but the tail is reserved out of the first chunk's capacity and
// appended to it alone, so the marker never straddles rows.
function buildSilentChunksWithTail(detailPrefix: string, detailBody: string, tail: string): string[] {
    const baseCapacity = MAX_CHUNK_DETAIL_LENGTH - detailPrefix.length;
    const firstCapacity = Math.max(0, baseCapacity - tail.length);

    if (baseCapacity <= 0 || detailBody.length <= firstCapacity) {
        return [`${detailPrefix}${detailBody}${tail}`];
    }

    const slices = [detailBody.slice(0, firstCapacity)];
    for (let start = firstCapacity; start < detailBody.length; start += baseCapacity) {
        slices.push(detailBody.slice(start, start + baseCapacity));
    }

    return slices.map((slice, index) => (index === 0 ? `${detailPrefix}${slice}${tail}` : `${detailPrefix}${slice}`));
}

// Same estimate-and-settle approach as buildGroupedChunks, but the first chunk's capacity is reduced
// by the tail length and only the first chunk carries it.
function buildGroupedChunksWithTail(detailPrefix: string, detailBody: string, tail: string): string[] {
    const groupId = createChunkGroupId();
    let estimatedTotal = Math.max(
        2,
        Math.ceil(detailBody.length / Math.max(1, MAX_CHUNK_DETAIL_LENGTH - buildChunkToken(groupId, 1, 2).length - detailPrefix.length)),
    );

    while (true) {
        const tokenLength = buildChunkToken(groupId, estimatedTotal, estimatedTotal).length;
        const baseCapacity = MAX_CHUNK_DETAIL_LENGTH - tokenLength - detailPrefix.length;

        if (baseCapacity <= 0) {
            const token = buildChunkToken(groupId, 1, 1);
            const capacity = Math.max(0, MAX_CHUNK_DETAIL_LENGTH - token.length - detailPrefix.length - tail.length);
            return [`${token}${detailPrefix}${detailBody.slice(0, capacity)}${tail}`];
        }

        const firstCapacity = Math.max(0, baseCapacity - tail.length);
        const actualTotal = detailBody.length <= firstCapacity
            ? 1
            : 1 + Math.ceil((detailBody.length - firstCapacity) / baseCapacity);

        if (actualTotal === estimatedTotal) {
            const chunks: string[] = [];
            let start = 0;
            for (let index = 0; index < actualTotal; index += 1) {
                const token = buildChunkToken(groupId, index + 1, actualTotal);
                const capacity = index === 0 ? firstCapacity : baseCapacity;
                const slice = detailBody.slice(start, start + capacity);
                start += capacity;
                chunks.push(`${token}${detailPrefix}${slice}${index === 0 ? tail : ''}`);
            }
            return chunks;
        }

        estimatedTotal = actualTotal;
    }
}

function buildDetailLines(
    chunkMode: ChunkLogMode,
    detailPrefix: string,
    detailBody: string,
    attributes: Record<string, unknown> | undefined,
): string[] {
    const { tail, detailBody: resolvedDetailBody } = resolveLogAttributeTail(chunkMode, detailPrefix, detailBody, attributes);
    const combined = `${detailPrefix}${resolvedDetailBody}${tail}`;

    if (chunkMode === 'off' || combined.length <= MAX_CHUNK_DETAIL_LENGTH) {
        return [combined];
    }

    if (chunkMode === 'silent') {
        return tail
            ? buildSilentChunksWithTail(detailPrefix, resolvedDetailBody, tail)
            : buildSilentChunks(detailPrefix, resolvedDetailBody);
    }

    return tail
        ? buildGroupedChunksWithTail(detailPrefix, resolvedDetailBody, tail)
        : buildGroupedChunks(detailPrefix, resolvedDetailBody);
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
        attributes: titleOrOptions.attributes,
    };
}

function emitLog(method: LogMethodName, titleOrOptions: string | LogCallOptions, details?: unknown): void {
    const nsLog = getNsLog();
    let normalizedCall: LogCallOptions;
    let activeExecution: ActiveTrackedExecutionSnapshot | null;
    let activeFunctionContext: ActiveFunctionContext | null;
    let detailPrefix: string;
    let titleText: string;
    let detailBody: string;
    let detailLines: string[];
    try {
        normalizedCall = normalizeLogCall(titleOrOptions, details);
        activeExecution = getActiveTrackedExecutionSnapshot();
        activeFunctionContext = getActiveFunctionContext();
        detailPrefix = buildTrackerDetailPrefix(activeExecution, activeFunctionContext);
        titleText = normalizedCall.title;
        detailBody = serializeDetailsForLog(normalizedCall.details);
        detailLines = buildDetailLines(chunkLogMode, detailPrefix, detailBody, normalizedCall.attributes);
    } catch (error) {
        // The call is logged as the application made it, without tags or chunking.
        reportWrapperFailure('log', error);
        (nsLog[method] as (titleOrOptions: string | LogCallOptions, details?: unknown) => void)(titleOrOptions, details);
        return;
    }

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

    forwardLogEntry(method, normalizedCall, activeExecution, activeFunctionContext);
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

// Last, so every export above is in place: anything N/log answers that is not instrumented here passes through.
forwardModuleExports(exports, getNsLog);
