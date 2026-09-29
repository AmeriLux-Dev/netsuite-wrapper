import { reportWrapperFailure } from './fail-open';
import { forwardModuleExports } from './lazy-module';

declare const require: <T = unknown>(moduleName: string) => T;

declare const exports: Record<string, unknown>;

const LOG_CHUNK_MARKER = '[[NSW_CHUNK';
const MAX_CHUNK_DETAIL_LENGTH = 3980;
const LOG_ATTRIBUTE_TAIL_MARKER = '[[NSW_ATTR|1]]';
// Inside the tail's JSON the marker can only appear within a string, where `[` is a valid escape
// for `[`: JSON.parse restores it, and the real marker stays the last one in the line.
const LOG_ATTRIBUTE_TAIL_MARKER_START = '[[NSW_ATTR';
const ESCAPED_LOG_ATTRIBUTE_TAIL_MARKER_START = '[\\u005bNSW_ATTR';
const MAX_LOG_ATTRIBUTE_JSON_LENGTH = 1024;
// Exporter entries are held until the run ends (up to 500 of them), so the copies they carry are capped.
const MAX_EXPORTED_LOG_DETAILS_LENGTH = 8000;
const MAX_EXPORTED_LOG_ATTRIBUTES_LENGTH = 4000;
// Details JSON cannot encode (a circular structure, a BigInt) have no known size up front, so their
// snapshot walk is kept small.
const UNENCODABLE_LOG_DETAILS_SNAPSHOT_OPTIONS = {
    maxDepth: 3,
    maxStringLength: 1000,
    maxArrayLength: 20,
    maxObjectKeys: 30,
    maxTotalLength: MAX_EXPORTED_LOG_DETAILS_LENGTH,
};

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

type SerializedLogDetails = {
    /** What N/log gets: a string as passed, the JSON of anything else. */
    text: string;
    /** Set when the details could not be JSON-encoded, so `text` is only their String() form. */
    unencodable: boolean;
};

type PreparedTelemetryLogEntry = {
    executionId: string;
    entry: import('./telemetry-exporter').TelemetryLogEntry;
    /** `[log:N] ` when the details were replaced by a pointer back to this call's N/log rows; otherwise empty. */
    logReferenceTag: string;
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

// A call becomes an exporter entry only inside a tracked execution (otherwise there is no run to
// batch with) and only when some exporter wants log entries (otherwise the copies and the argument
// snapshot would be paid for nothing). The N/log write happens regardless; this is the second
// destination, never a replacement.
function shouldForwardLogEntry(activeExecution: ActiveTrackedExecutionSnapshot | null): boolean {
    if (!activeExecution?.executionId) {
        return false;
    }

    try {
        const telemetryExporter = require<typeof import('./telemetry-exporter')>('./telemetry-exporter');
        return telemetryExporter.hasLogAcceptingTelemetryExporter();
    } catch (error) {
        emitTraceLog('shouldForwardLogEntry.error', {
            message: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

// Builds the structured entry exporters receive. It runs before the N/log write, so details too large
// to copy can be replaced by a pointer whose `[log:N]` tag goes into that write. Entries are exported
// when the run ends, so details and attributes are copied now: a caller that changes them afterwards
// does not change what was logged. Returns null when anything fails; the N/log write happens regardless.
function prepareTelemetryLogEntry(
    method: LogMethodName,
    normalizedCall: LogCallOptions,
    serializedDetails: SerializedLogDetails,
    attributeJson: string | null,
    activeExecution: ActiveTrackedExecutionSnapshot,
    activeFunctionContext: ActiveFunctionContext | null,
): PreparedTelemetryLogEntry | null {
    try {
        const telemetryExporter = require<typeof import('./telemetry-exporter')>('./telemetry-exporter');
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

        const executionId = activeExecution.executionId;
        let logReferenceTag = '';
        let details: unknown;
        if (serializedDetails.text.length > MAX_EXPORTED_LOG_DETAILS_LENGTH) {
            const logSequence = telemetryExporter.countTelemetryLogEntriesForExecution(executionId) + 1;
            logReferenceTag = `[log:${logSequence}] `;
            details = {
                _dropped: true,
                _reason: 'too_large',
                _size: serializedDetails.text.length,
                _logReference: `[${executionId}] [log:${logSequence}]`,
            };
        } else {
            details = copyLogDetailsForExport(normalizedCall.details, serializedDetails);
        }

        // The entry names the innermost application function (wrapper-internal and infrastructure
        // frames skipped), the same frame whose arguments are snapshotted; the N/log tag keeps
        // using the raw top of the stack as before.
        const preferredFunctionContext = functionContext.getPreferredActiveFunctionContext() || activeFunctionContext;
        const functionArguments = functionContext.snapshotActiveFunctionArguments();
        return {
            executionId,
            logReferenceTag,
            entry: {
                level: method,
                title: normalizedCall.title,
                details,
                timestamp: new Date().toISOString(),
                executionId,
                flowId: activeExecution.flowId || '',
                scriptId,
                deploymentId,
                functionName: normalizeTitle(preferredFunctionContext?.functionName),
                functionModulePath: normalizeTitle(preferredFunctionContext?.modulePath || preferredFunctionContext?.filePath),
                callChain: functionContext.getFunctionCallChainLabel(),
                ...(functionArguments ? { functionArguments } : {}),
                ...(hasLogAttributes(normalizedCall.attributes) ? { attributes: copyLogAttributesForExport(attributeJson) } : {}),
            },
        };
    } catch (error) {
        emitTraceLog('prepareTelemetryLogEntry.error', {
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function enqueuePreparedTelemetryLogEntry(preparedLogEntry: PreparedTelemetryLogEntry): void {
    try {
        const telemetryExporter = require<typeof import('./telemetry-exporter')>('./telemetry-exporter');
        telemetryExporter.enqueueTelemetryLogEntry(preparedLogEntry.executionId, preparedLogEntry.entry);
    } catch (error) {
        emitTraceLog('enqueuePreparedTelemetryLogEntry.error', {
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

// Built from the text already written to N/log, so the copy is exactly what JSON makes of the
// details, the same thing an exporter serializing them would send. Error objects (which JSON turns
// into {}) and details JSON cannot encode (a circular structure, a BigInt) are snapshotted instead.
function copyLogDetailsForExport(details: unknown, serializedDetails: SerializedLogDetails): unknown {
    if (details === null || details === undefined) {
        return null;
    }

    if (typeof details === 'string') {
        return details;
    }

    if (details instanceof Error || serializedDetails.unencodable) {
        const valueSnapshot = require<typeof import('./value-snapshot')>('./value-snapshot');
        return valueSnapshot.snapshotValue(details, UNENCODABLE_LOG_DETAILS_SNAPSHOT_OPTIONS);
    }

    return JSON.parse(serializedDetails.text);
}

// Parsed from the JSON already built for the N/log tail, so both destinations carry the same values.
function copyLogAttributesForExport(attributeJson: string | null): Record<string, unknown> {
    if (attributeJson === null) {
        return { _dropped: true, _reason: 'unreadable', _size: -1 };
    }

    if (attributeJson.length > MAX_EXPORTED_LOG_ATTRIBUTES_LENGTH) {
        return { _dropped: true, _reason: 'too_large', _size: attributeJson.length };
    }

    return JSON.parse(attributeJson) as Record<string, unknown>;
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

// `logReferenceTag` is `[log:N] ` only on a call whose exporter entry points back at these rows.
function buildTrackerDetailPrefix(snapshot: ActiveTrackedExecutionSnapshot | null, activeFunctionContext: ActiveFunctionContext | null, logReferenceTag: string): string {
    const executionTag = snapshot?.executionId ? `[${snapshot.executionId}] ` : '';
    const functionTag = buildTrackerFunctionTitleTag(activeFunctionContext);

    return `${executionTag}${logReferenceTag}${functionTag}`;
}

// Same text as stringifyDetails, plus whether JSON could encode the details at all.
function serializeDetailsForLog(details: unknown): SerializedLogDetails {
    if (details === null || details === undefined || typeof details === 'string') {
        return { text: stringifyDetails(details), unencodable: false };
    }

    try {
        return { text: JSON.stringify(details), unencodable: false };
    } catch (_error) {
        return { text: String(details), unencodable: true };
    }
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
// sub-structure) falls back to String(value) instead of dropping the whole payload. An Error, which
// JSON turns into {}, keeps its name and message.
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

            if (value instanceof Error) {
                sanitized[key] = { errorName: value.name, message: value.message };
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

function buildLogAttributeTailText(json: string): string {
    const escapedJson = json.split(LOG_ATTRIBUTE_TAIL_MARKER_START).join(ESCAPED_LOG_ATTRIBUTE_TAIL_MARKER_START);
    return ` ${LOG_ATTRIBUTE_TAIL_MARKER}${escapedJson}`;
}

function buildDroppedLogAttributeTail(size: number, messageTruncated: boolean): string {
    return buildLogAttributeTailText(JSON.stringify({ _dropped: true, _size: size, ...(messageTruncated ? { _truncated: true } : {}) }));
}

// Cutting the message in off mode marks the attribute JSON; the JSON is the tail's own, so this cannot throw.
function addTruncatedFlagToLogAttributeJson(json: string): string {
    return JSON.stringify({ ...(JSON.parse(json) as Record<string, unknown>), _truncated: true });
}

type ResolvedLogAttributeTail = {
    tail: string;
    detailBody: string;
};

// Resolves the `[[NSW_ATTR|1]]` tail (or a `_dropped` placeholder) and, for chunkMode 'off' only, the
// detail body cut to make room for it when the two together would not otherwise fit. `attributeJson`
// is serializeLogAttributes' result for these attributes, null when their keys could not be read.
function resolveLogAttributeTail(
    chunkMode: ChunkLogMode,
    detailPrefix: string,
    detailBody: string,
    attributes: Record<string, unknown> | undefined,
    attributeJson: string | null,
): ResolvedLogAttributeTail {
    if (!logAttributeTailEnabled || !hasLogAttributes(attributes)) {
        return { tail: '', detailBody };
    }

    if (attributeJson === null) {
        return fitDroppedLogAttributeTail(chunkMode, detailPrefix, detailBody, -1);
    }

    if (attributeJson.length > MAX_LOG_ATTRIBUTE_JSON_LENGTH) {
        return fitDroppedLogAttributeTail(chunkMode, detailPrefix, detailBody, attributeJson.length);
    }

    const tail = buildLogAttributeTailText(attributeJson);

    if (chunkMode !== 'off') {
        if (detailPrefix.length + tail.length > MAX_CHUNK_DETAIL_LENGTH) {
            return fitDroppedLogAttributeTail(chunkMode, detailPrefix, detailBody, attributeJson.length);
        }

        return { tail, detailBody };
    }

    // Cutting the message adds "_truncated":true to the JSON, so the fit check reserves space for
    // that growth up front.
    const reservedTail = buildLogAttributeTailText(addTruncatedFlagToLogAttributeJson(attributeJson));

    if (detailPrefix.length + reservedTail.length > MAX_CHUNK_DETAIL_LENGTH) {
        return fitDroppedLogAttributeTail(chunkMode, detailPrefix, detailBody, attributeJson.length);
    }

    if (detailPrefix.length + detailBody.length + tail.length <= MAX_CHUNK_DETAIL_LENGTH) {
        return { tail, detailBody };
    }

    const capacity = Math.max(0, MAX_CHUNK_DETAIL_LENGTH - detailPrefix.length - reservedTail.length);
    return { tail: reservedTail, detailBody: detailBody.slice(0, capacity) };
}

// The `_dropped` placeholder. Chunked modes carry it like any tail; with chunking off it needs room on
// the one line just as the real tail does, so the message is cut to fit and the placeholder says so.
function fitDroppedLogAttributeTail(chunkMode: ChunkLogMode, detailPrefix: string, detailBody: string, size: number): ResolvedLogAttributeTail {
    const tail = buildDroppedLogAttributeTail(size, false);
    if (chunkMode !== 'off' || detailPrefix.length + detailBody.length + tail.length <= MAX_CHUNK_DETAIL_LENGTH) {
        return { tail, detailBody };
    }

    const truncatedTail = buildDroppedLogAttributeTail(size, true);
    const capacity = Math.max(0, MAX_CHUNK_DETAIL_LENGTH - detailPrefix.length - truncatedTail.length);
    return { tail: truncatedTail, detailBody: detailBody.slice(0, capacity) };
}

function createChunkGroupId(): string {
    const timestamp = Date.now().toString(36);
    const randomComponent = Math.floor(Math.random() * 0xffffff).toString(36).padStart(4, '0');
    return `${timestamp}${randomComponent}`;
}

function buildChunkToken(groupId: string, index: number, total: number): string {
    return `${LOG_CHUNK_MARKER}|${groupId}|${index}/${total}]] `;
}

// Splits the body across rows that each repeat the prefix. The attribute tail, when there is one, is
// reserved out of the first chunk's capacity and appended to it alone, so the marker never straddles rows.
function buildSilentChunks(detailPrefix: string, detailBody: string, tail: string): string[] {
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

// Like buildSilentChunks, with a `[[NSW_CHUNK|group|index/total]]` token on every row. The total is
// part of each token, so its length is estimated first and the split settled once it stops changing.
function buildGroupedChunks(detailPrefix: string, detailBody: string, tail: string): string[] {
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
    attributeJson: string | null,
): string[] {
    const { tail, detailBody: resolvedDetailBody } = resolveLogAttributeTail(chunkMode, detailPrefix, detailBody, attributes, attributeJson);
    const combined = `${detailPrefix}${resolvedDetailBody}${tail}`;

    if (chunkMode === 'off' || combined.length <= MAX_CHUNK_DETAIL_LENGTH) {
        return [combined];
    }

    return chunkMode === 'silent'
        ? buildSilentChunks(detailPrefix, resolvedDetailBody, tail)
        : buildGroupedChunks(detailPrefix, resolvedDetailBody, tail);
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
    let preparedLogEntry: PreparedTelemetryLogEntry | null;
    let detailPrefix: string;
    let titleText: string;
    let detailBody: string;
    let detailLines: string[];
    try {
        normalizedCall = normalizeLogCall(titleOrOptions, details);
        activeExecution = getActiveTrackedExecutionSnapshot();
        activeFunctionContext = getActiveFunctionContext();
        titleText = normalizedCall.title;
        const serializedDetails = serializeDetailsForLog(normalizedCall.details);
        detailBody = serializedDetails.text;
        const forwardsLogEntry = shouldForwardLogEntry(activeExecution);
        // Serialized once, for both the N/log tail and the exporter copy, and only when one of them wants it.
        const attributeJson = hasLogAttributes(normalizedCall.attributes) && (logAttributeTailEnabled || forwardsLogEntry)
            ? serializeLogAttributes(normalizedCall.attributes)
            : null;
        preparedLogEntry = forwardsLogEntry && activeExecution
            ? prepareTelemetryLogEntry(method, normalizedCall, serializedDetails, attributeJson, activeExecution, activeFunctionContext)
            : null;
        detailPrefix = buildTrackerDetailPrefix(activeExecution, activeFunctionContext, preparedLogEntry ? preparedLogEntry.logReferenceTag : '');
        detailLines = buildDetailLines(chunkLogMode, detailPrefix, detailBody, normalizedCall.attributes, attributeJson);
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

    if (preparedLogEntry) {
        enqueuePreparedTelemetryLogEntry(preparedLogEntry);
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

// Last, so every export above is in place: anything N/log answers that is not instrumented here passes through.
forwardModuleExports(exports, getNsLog);
