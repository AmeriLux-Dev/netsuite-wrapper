// The exporter seam. The performance tracker builds spans and the log module builds log entries;
// neither decides where they go. At the end of a tracked script run everything the run produced is
// handed to every registered exporter as one batch, so a remote destination costs one request per
// run rather than one per call.

declare const require: <T = unknown>(moduleName: string) => T;

export type TelemetryMode = 'off' | 'boundary' | 'diagnostic';

export type TelemetryLogLevel = 'debug' | 'audit' | 'error' | 'emergency';

/** One span as the PerformanceTracker record schema stores it. Field names match the custom record. */
export interface TelemetrySpan {
    executionId: string;
    flowId: string;
    parentExecutionId?: string;
    rootExecutionId: string;
    spanRole: string;
    entryKind: string;
    entryKey: string;
    scriptId: string;
    scriptName: string;
    scriptType: string;
    deploymentId: string;
    scopeKey: string;
    stage: string;
    operation: string;
    transactionType: string;
    transactionId?: number;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    status: string;
    context: string;
    summary: string;
    detail: string;
    functionName: string;
    functionModulePath: string;
    callChain: string;
    wrapperModule: string;
    wrapperAction: string;
}

/** One `log.*` call, with everything the wrapper knew about where it came from. */
export interface TelemetryLogEntry {
    level: TelemetryLogLevel;
    title: string;
    /** The details as passed to the log call, not the chunked string written to N/log. */
    details: unknown;
    timestamp: string;
    executionId: string;
    flowId: string;
    scriptId: string;
    deploymentId: string;
    functionName: string;
    functionModulePath: string;
    callChain: string;
    /** The enclosing function's arguments, snapshotted; absent when the function opted out. */
    functionArguments?: Record<string, unknown>;
}

/** Everything one tracked script run produced. `mode` is the scope mode the run executed under. */
export interface TelemetryExportBatch {
    executionId: string;
    flowId: string;
    scopeKey: string;
    mode: Exclude<TelemetryMode, 'off'>;
    spans: TelemetrySpan[];
    logs: TelemetryLogEntry[];
}

export interface TelemetryExporter {
    /** Unique; registering a second exporter with the same name replaces the first. */
    name: string;
    /** False lets the log module skip building entries (and snapshotting arguments) for nothing. */
    acceptsLogEntries: boolean;
    export(batch: TelemetryExportBatch): void;
}

const MAX_LOG_ENTRIES_PER_EXECUTION = 500;

const registeredExporters: TelemetryExporter[] = [];
const pendingLogEntriesByExecution = new Map<string, TelemetryLogEntry[]>();
const droppedLogEntryCountByExecution = new Map<string, number>();

function getNsLog(): typeof import('N/log') {
    return require<typeof import('N/log')>('N/log');
}

export function registerTelemetryExporter(exporter: TelemetryExporter): void {
    const existingIndex = registeredExporters.findIndex((candidate) => candidate.name === exporter.name);
    if (existingIndex === -1) {
        registeredExporters.push(exporter);
        return;
    }

    registeredExporters[existingIndex] = exporter;
}

export function unregisterTelemetryExporter(name: string): void {
    const existingIndex = registeredExporters.findIndex((candidate) => candidate.name === name);
    if (existingIndex !== -1) {
        registeredExporters.splice(existingIndex, 1);
    }
}

export function clearTelemetryExporters(): void {
    registeredExporters.length = 0;
}

export function getTelemetryExporters(): TelemetryExporter[] {
    return registeredExporters.slice();
}

export function hasLogAcceptingTelemetryExporter(): boolean {
    return registeredExporters.some((exporter) => exporter.acceptsLogEntries);
}

/** Queues a log entry for the run it belongs to; the batch picks it up when the run finishes. */
export function enqueueTelemetryLogEntry(executionId: string, entry: TelemetryLogEntry): void {
    if (!executionId) {
        return;
    }

    const queue = pendingLogEntriesByExecution.get(executionId);
    if (!queue) {
        pendingLogEntriesByExecution.set(executionId, [entry]);
        return;
    }

    if (queue.length >= MAX_LOG_ENTRIES_PER_EXECUTION) {
        droppedLogEntryCountByExecution.set(executionId, (droppedLogEntryCountByExecution.get(executionId) || 0) + 1);
        return;
    }

    queue.push(entry);
}

/** Removes and returns the run's queued log entries, with a closing entry when some were dropped. */
export function takeTelemetryLogEntries(executionId: string): TelemetryLogEntry[] {
    const queue = pendingLogEntriesByExecution.get(executionId) || [];
    pendingLogEntriesByExecution.delete(executionId);

    const droppedCount = droppedLogEntryCountByExecution.get(executionId) || 0;
    droppedLogEntryCountByExecution.delete(executionId);
    if (droppedCount > 0 && queue.length > 0) {
        const lastEntry = queue[queue.length - 1];
        queue.push({
            ...lastEntry,
            level: 'audit',
            title: 'netsuite-wrapper log entries dropped',
            details: { droppedCount, keptCount: queue.length, limit: MAX_LOG_ENTRIES_PER_EXECUTION },
            functionArguments: undefined,
        });
    }

    return queue;
}

export function discardTelemetryLogEntries(executionId: string): void {
    pendingLogEntriesByExecution.delete(executionId);
    droppedLogEntryCountByExecution.delete(executionId);
}

/** Hands the batch to every exporter. One exporter failing never stops the others or the script. */
export function dispatchTelemetryBatch(batch: TelemetryExportBatch): void {
    registeredExporters.forEach((exporter) => {
        try {
            exporter.export(exporter.acceptsLogEntries ? batch : { ...batch, logs: [] });
        } catch (error) {
            try {
                getNsLog().error({
                    title: 'netsuite-wrapper telemetry export failed',
                    details: JSON.stringify({ exporter: exporter.name, message: error instanceof Error ? error.message : String(error) }),
                });
            } catch (_logError) {
                // Nothing left to report to.
            }
        }
    });
}
