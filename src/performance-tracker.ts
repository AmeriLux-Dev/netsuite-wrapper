import { getActiveFunctionContext, getFunctionContextStack, type FunctionCallerContext } from './function-context';
import {
    finishTrackedScriptExecution,
    getActiveTrackedExecutionSnapshot,
    startTrackedScriptExecution,
    type ActiveTrackedExecutionSnapshot,
    type TrackedScriptEntryMetadata,
} from './execution-tracking';
import type { WrapperOperationMetadata, WrapperTelemetrySink } from './telemetry';

declare const require: <T = unknown>(moduleName: string) => T;

type TelemetryMode = 'off' | 'boundary' | 'diagnostic';

type PerformanceTrackerSinkOptions = {
    defaultScopeKey?: string;
};

type CachedScopeState = {
    mode: TelemetryMode;
    expiresAt: string;
};

type PersistedTrackerSpan = {
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
};

const EXECUTION_RECORD_TYPE = 'customrecord_ptrk_exec_span';
const SCOPE_RECORD_TYPE = 'customrecord_ptrk_scope';
const TELEMETRY_SCOPE_CACHE = 'ptrk_scope_modes';
const DEFAULT_SCOPE_TTL_SECONDS = 1800;
const MIN_SCOPE_TTL_SECONDS = 300;

const EXECUTION_FIELDS = {
    executionId: 'custrecord_ptrk_exec_id',
    flowId: 'custrecord_ptrk_flow_id',
    parentExecutionId: 'custrecord_ptrk_parent_exec',
    rootExecutionId: 'custrecord_ptrk_root_exec_id',
    spanRole: 'custrecord_ptrk_span_role',
    entryKind: 'custrecord_ptrk_entry_kind',
    entryKey: 'custrecord_ptrk_entry_key',
    scriptId: 'custrecord_ptrk_script_id',
    scriptName: 'custrecord_ptrk_script_name',
    scriptType: 'custrecord_ptrk_script_type',
    deploymentId: 'custrecord_ptrk_deploy_id',
    scopeKey: 'custrecord_ptrk_span_scope_key',
    stage: 'custrecord_ptrk_stage',
    operation: 'custrecord_ptrk_op',
    transactionType: 'custrecord_ptrk_txn_type',
    transactionId: 'custrecord_ptrk_txn_id',
    startedAt: 'custrecord_ptrk_start_ts',
    endedAt: 'custrecord_ptrk_end_ts',
    durationMs: 'custrecord_ptrk_dur_ms',
    status: 'custrecord_ptrk_status',
    context: 'custrecord_ptrk_context',
    summary: 'custrecord_ptrk_summary',
    detail: 'custrecord_ptrk_detail',
    functionName: 'custrecord_ptrk_func_name',
    functionModulePath: 'custrecord_ptrk_func_module',
    callChain: 'custrecord_ptrk_call_chain',
    wrapperModule: 'custrecord_ptrk_wrapper_module',
    wrapperAction: 'custrecord_ptrk_wrapper_action',
} as const;

const SCOPE_FIELDS = {
    scopeKey: 'custrecord_ptrk_scope_key',
    mode: 'custrecord_ptrk_scope_mode',
    expiresAt: 'custrecord_ptrk_scope_expires_at',
} as const;

type ActiveWrapperSpan = {
    executionId: string;
    flowId: string;
};

const deferredSpanQueues = new Map<string, PersistedTrackerSpan[]>();

function getNsCache(): typeof import('N/cache') {
    return require<typeof import('N/cache')>('N/cache');
}

function getNsFormat(): typeof import('N/format') {
    return require<typeof import('N/format')>('N/format');
}

function getNsLog(): typeof import('N/log') {
    return require<typeof import('N/log')>('N/log');
}

function getNsRecord(): typeof import('N/record') {
    return require<typeof import('N/record')>('N/record');
}

function getNsRuntime(): typeof import('N/runtime') {
    return require<typeof import('N/runtime')>('N/runtime');
}

function getNsSearch(): typeof import('N/search') {
    return require<typeof import('N/search')>('N/search');
}

function normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return value.slice(0, maxLength);
}

function normalizeTransactionId(value: number | string | null | undefined): number | undefined {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }

    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(parsed) ? parsed : undefined;
}

function serializeDetail(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '';
    }

    if (typeof value === 'string') {
        return truncateText(value, 100000);
    }

    try {
        return truncateText(JSON.stringify(value), 100000);
    } catch (_error) {
        return truncateText(String(value), 100000);
    }
}

function mergeDetailMetadata(detail: unknown, metadata: Record<string, unknown>): unknown {
    if (!detail || detail === '') {
        return metadata;
    }

    if (typeof detail === 'object' && !Array.isArray(detail)) {
        return { ...(detail as Record<string, unknown>), ...metadata };
    }

    return {
        note: typeof detail === 'string' ? detail : String(detail),
        ...metadata,
    };
}

function getExecutionOriginMetadata(executionContext: string): Record<string, string> {
    const normalizedContext = normalizeText(executionContext).toUpperCase();
    const metadata: Record<string, string> = {};

    if (executionContext) {
        metadata.executionContext = executionContext;
    }

    if (normalizedContext === 'WORKFLOW') {
        metadata.originCategory = 'workflow-wrapper';
        metadata.originLabel = 'Workflow-triggered wrapper activity';
        return metadata;
    }

    if (normalizedContext === 'USEREVENT') {
        metadata.originCategory = 'user-event-wrapper';
        metadata.originLabel = 'User event wrapper activity';
    }

    return metadata;
}

function normalizeScopeMode(value: unknown): TelemetryMode {
    if (value === 'off' || value === 'boundary' || value === 'diagnostic') {
        return value;
    }

    return 'diagnostic';
}

function hasScopeExpired(expiresAt: string): boolean {
    if (!expiresAt) {
        return false;
    }

    const parsed = Date.parse(expiresAt);
    return !Number.isNaN(parsed) && parsed <= Date.now();
}

function resolveModeFromScopeState(scopeState: CachedScopeState): TelemetryMode {
    if (hasScopeExpired(scopeState.expiresAt)) {
        return 'off';
    }

    return normalizeScopeMode(scopeState.mode);
}

function serializeScopeState(scopeState: CachedScopeState): string {
    return JSON.stringify(scopeState);
}

function parseScopeState(value: string): CachedScopeState | null {
    if (!value) {
        return null;
    }

    try {
        const parsed = JSON.parse(value) as { mode?: unknown; expiresAt?: unknown };
        return {
            mode: normalizeScopeMode(parsed.mode),
            expiresAt: normalizeText(parsed.expiresAt),
        };
    } catch (_error) {
        return null;
    }
}

function computeScopeCacheTtlSeconds(scopeState: CachedScopeState): number {
    if (!scopeState.expiresAt) {
        return DEFAULT_SCOPE_TTL_SECONDS;
    }

    const parsed = Date.parse(scopeState.expiresAt);
    if (Number.isNaN(parsed)) {
        return DEFAULT_SCOPE_TTL_SECONDS;
    }

    const secondsUntilExpiry = Math.ceil((parsed - Date.now()) / 1000);
    return Math.max(MIN_SCOPE_TTL_SECONDS, secondsUntilExpiry);
}

function getScopeCache() {
    const nsCache = getNsCache();
    return nsCache.getCache({
        name: TELEMETRY_SCOPE_CACHE,
        scope: nsCache.Scope.PUBLIC,
    });
}

function loadScopeState(scopeKey: string): CachedScopeState {
    try {
        const nsSearch = getNsSearch();
        const results = nsSearch.create({
            type: SCOPE_RECORD_TYPE,
            filters: [[SCOPE_FIELDS.scopeKey, 'is', scopeKey]],
            columns: [SCOPE_FIELDS.mode, SCOPE_FIELDS.expiresAt],
        }).run().getRange({ start: 0, end: 1 });

        const match = results[0];
        return {
            mode: normalizeScopeMode(match?.getValue(SCOPE_FIELDS.mode)),
            expiresAt: normalizeText(match?.getValue(SCOPE_FIELDS.expiresAt)),
        };
    } catch (_error) {
        return {
            mode: 'diagnostic',
            expiresAt: '',
        };
    }
}

function resolveTelemetryMode(scopeKey: string): TelemetryMode {
    if (!scopeKey) {
        return 'diagnostic';
    }

    try {
        const scopeCache = getScopeCache();
        const cachedValue = scopeCache.get({ key: scopeKey });
        const cachedScopeState = parseScopeState(cachedValue || '');

        if (cachedScopeState) {
            return resolveModeFromScopeState(cachedScopeState);
        }

        const scopeState = loadScopeState(scopeKey);
        scopeCache.put({
            key: scopeKey,
            value: serializeScopeState(scopeState),
            ttl: computeScopeCacheTtlSeconds(scopeState),
        });
        return resolveModeFromScopeState(scopeState);
    } catch (_error) {
        return 'diagnostic';
    }
}

export function formatLocalParts(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Server-side SuiteScript Date getters report the server timezone (Pacific), not the
// account/user timezone, so naively formatting an instant skews every timestamp by the
// difference between the two. Re-express the instant as the current user's preferred-timezone
// wall clock: format.format with DATETIMETZ and no explicit timezone uses that preference, and
// re-parsing the result as a timezone-naive DATETIME yields a Date whose server-local getters
// read back those preferred-timezone wall-clock components. Returns null on any failure so the
// caller can fall back to the unconverted (server-local) timestamp rather than throw.
export function convertToUserTimezone(date: Date): Date | null {
    try {
        const nsFormat = getNsFormat();
        const userWallClock = nsFormat.format({ value: date, type: nsFormat.Type.DATETIMETZ });
        const reparsed = nsFormat.parse({ value: userWallClock, type: nsFormat.Type.DATETIME });
        if (reparsed instanceof Date && !Number.isNaN(reparsed.getTime())) {
            return reparsed;
        }

        return null;
    } catch (_error) {
        return null;
    }
}

export function formatTimestamp(date: Date): string {
    return formatLocalParts(convertToUserTimezone(date) || date);
}

function getCurrentScriptMetadata() {
    const currentScript = getNsRuntime().getCurrentScript() as unknown as Record<string, unknown>;
    return {
        scriptId: normalizeText(currentScript.id),
        deploymentId: normalizeText(currentScript.deploymentId),
    };
}

function getCurrentUserId(): string {
    try {
        const currentUser = getNsRuntime().getCurrentUser();
        return normalizeText(currentUser.id);
    } catch (_error) {
        return '';
    }
}

function getExecutionContextLabel(): string {
    try {
        return normalizeText(getNsRuntime().executionContext);
    } catch (_error) {
        return '';
    }
}

function makeId(prefix: string, startedAt: Date): string {
    const randomComponent = Math.floor(Math.random() * 0xffffff).toString(36);
    return `${prefix}_${startedAt.getTime().toString(36)}_${randomComponent}`;
}

function hashString(input: string): string {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash) + input.charCodeAt(index);
        hash |= 0;
    }

    return Math.abs(hash).toString(36);
}

function getDetailRecord(detail: unknown): Record<string, unknown> {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
        return {};
    }

    return detail as Record<string, unknown>;
}

function cloneCallerContext(context: FunctionCallerContext): FunctionCallerContext {
    return {
        ...context,
    };
}

function isCallerContext(value: unknown): value is FunctionCallerContext {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return typeof (value as { functionName?: unknown }).functionName === 'string';
}

function getCallerChain(detail: unknown): FunctionCallerContext[] {
    const detailRecord = getDetailRecord(detail);
    const callerChain = detailRecord.callerChain;

    if (!Array.isArray(callerChain)) {
        return [];
    }

    return callerChain.filter(isCallerContext).map(cloneCallerContext);
}

function isWrapperAdapterContext(context: FunctionCallerContext): boolean {
    const modulePath = normalizeText(context.modulePath) || normalizeText(context.filePath);
    return modulePath.startsWith('netsuite-wrapper/')
        || modulePath.includes('/netsuite-wrapper/');
}

function isInfrastructureCallerContext(context: FunctionCallerContext): boolean {
    return Boolean(context.excludeFromObservedFunctions);
}

function getPreferredCallerContext(callerChain: FunctionCallerContext[]): FunctionCallerContext | null {
    const applicationContext = callerChain.find((context) => !isWrapperAdapterContext(context) && !isInfrastructureCallerContext(context));
    if (applicationContext) {
        return cloneCallerContext(applicationContext);
    }

    const nonInfrastructureContext = callerChain.find((context) => !isInfrastructureCallerContext(context));
    if (nonInfrastructureContext) {
        return cloneCallerContext(nonInfrastructureContext);
    }

    const innermostContext = callerChain[callerChain.length - 1];
    return innermostContext ? cloneCallerContext(innermostContext) : null;
}

function getInnermostCallerContext(callerChain: FunctionCallerContext[]): FunctionCallerContext | null {
    const innermostContext = callerChain[callerChain.length - 1];
    return innermostContext ? cloneCallerContext(innermostContext) : null;
}

function buildCallerChainLabel(callerChain: FunctionCallerContext[]): string {
    return callerChain
        .map((context) => normalizeText(context.functionName))
        .filter(Boolean)
        .join(' -> ');
}

function buildModuleOperationLabel(moduleName: string, action: string): string {
    const normalizedModuleName = normalizeText(moduleName);
    const normalizedAction = normalizeText(action);
    if (!normalizedModuleName && !normalizedAction) {
        return '';
    }

    if (!normalizedModuleName) {
        return normalizedAction;
    }

    if (!normalizedAction) {
        return normalizedModuleName;
    }

    return `${normalizedModuleName}.${normalizedAction}`;
}

function buildCallChain(detail: unknown, metadata: WrapperOperationMetadata): string {
    const callerChain = getCallerChain(detail);
    const callerChainLabel = buildCallerChainLabel(callerChain);
    const moduleOperationLabel = buildModuleOperationLabel(metadata.module, metadata.action);

    if (!callerChainLabel) {
        return moduleOperationLabel;
    }

    return moduleOperationLabel ? `${callerChainLabel} -> ${moduleOperationLabel}` : callerChainLabel;
}

function getCallerDetailRecord(detail: unknown): Record<string, unknown> {
    const detailRecord = getDetailRecord(detail);
    const callerDetail = detailRecord.caller;

    if (!callerDetail || typeof callerDetail !== 'object' || Array.isArray(callerDetail)) {
        return {};
    }

    return callerDetail as Record<string, unknown>;
}

function getCallerFunctionName(detail: unknown): string {
    return normalizeText(getCallerDetailRecord(detail).functionName);
}

function getCallerModulePath(detail: unknown): string {
    const callerDetail = getCallerDetailRecord(detail);
    return normalizeText(callerDetail.modulePath) || normalizeText(callerDetail.filePath);
}

function mergeCallerContext(detail: unknown): unknown {
    const activeCallerStack = getFunctionContextStack();
    const activeCallerContext = getActiveFunctionContext();
    const callerChain = activeCallerStack.length > 0
        ? activeCallerStack.map(cloneCallerContext)
        : (activeCallerContext ? [cloneCallerContext(activeCallerContext)] : getCallerChain(detail));

    if (callerChain.length === 0) {
        return detail;
    }

    const mergedCaller = getPreferredCallerContext(callerChain);
    const mergedWrapperCaller = getInnermostCallerContext(callerChain);
    const callerChainLabel = buildCallerChainLabel(callerChain);

    if (!detail || detail === '') {
        return {
            ...(mergedCaller ? { caller: mergedCaller } : {}),
            ...(mergedWrapperCaller ? { wrapperCaller: mergedWrapperCaller } : {}),
            callerChain,
            ...(callerChainLabel ? { callerChainLabel } : {}),
        };
    }

    if (typeof detail === 'object' && !Array.isArray(detail)) {
        return {
            ...(detail as Record<string, unknown>),
            ...(mergedCaller ? { caller: mergedCaller } : {}),
            ...(mergedWrapperCaller ? { wrapperCaller: mergedWrapperCaller } : {}),
            callerChain,
            ...(callerChainLabel ? { callerChainLabel } : {}),
        };
    }

    return {
        note: typeof detail === 'string' ? detail : String(detail),
        ...(mergedCaller ? { caller: mergedCaller } : {}),
        ...(mergedWrapperCaller ? { wrapperCaller: mergedWrapperCaller } : {}),
        callerChain,
        ...(callerChainLabel ? { callerChainLabel } : {}),
    };
}

function classifyResponseCode(code: number): string {
    if (!Number.isFinite(code) || code <= 0) {
        return '';
    }

    return `${Math.floor(code / 100)}xx`;
}

function enrichSuccessDetail(metadata: WrapperOperationMetadata, result: unknown): Record<string, unknown> {
    const detail = { ...getDetailRecord(metadata.detail) };

    if (metadata.module === 'https') {
        const response = result as { code?: unknown; body?: unknown };
        const responseCode = typeof response?.code === 'number' ? response.code : Number(response?.code);
        if (Number.isFinite(responseCode)) {
            detail.responseCode = responseCode;
            detail.responseClass = classifyResponseCode(responseCode);
        }

        if (typeof response?.body === 'string') {
            detail.responseBodySizeBucket = response.body.length < 256 ? 'small' : response.body.length < 4096 ? 'medium' : 'large';
        }
    }

    if (metadata.module === 'task' && metadata.action === 'submit' && typeof result === 'string') {
        detail.returnedTaskId = result;
        if (!normalizeText(detail.taskId)) {
            detail.taskId = result;
        }
    }

    if (metadata.module === 'task' && metadata.action === 'checkStatus') {
        const statusResult = result as { status?: unknown; taskId?: unknown };
        detail.currentStatus = normalizeText(statusResult?.status);
        if (!normalizeText(detail.taskId)) {
            detail.taskId = normalizeText(statusResult?.taskId);
        }
    }

    if (metadata.module === 'query') {
        const queryResult = result as { results?: unknown[]; count?: unknown; pageRanges?: unknown[]; data?: { results?: unknown[] } };
        if (Array.isArray(queryResult?.results)) {
            detail.rowCount = queryResult.results.length;
        }
        if (typeof queryResult?.count === 'number') {
            detail.rowCount = queryResult.count;
        }
        if (Array.isArray(queryResult?.pageRanges)) {
            detail.pageCount = queryResult.pageRanges.length;
        }
        if (queryResult?.data && Array.isArray(queryResult.data.results)) {
            detail.rowCount = queryResult.data.results.length;
        }
    }

    if (metadata.module === 'search') {
        if (Array.isArray(result)) {
            detail.rowCount = result.length;
        }

        const searchResult = result as { count?: unknown; pageRanges?: unknown[]; data?: unknown[]; columns?: unknown[] };
        if (typeof searchResult?.count === 'number') {
            detail.rowCount = searchResult.count;
        }
        if (Array.isArray(searchResult?.pageRanges)) {
            detail.pageCount = searchResult.pageRanges.length;
        }
        if (Array.isArray(searchResult?.data)) {
            detail.rowCount = searchResult.data.length;
        }
        if (Array.isArray(searchResult?.columns)) {
            detail.columnCount = searchResult.columns.length;
        }
        if (metadata.action === 'lookupFields' && result && typeof result === 'object' && !Array.isArray(result)) {
            detail.fieldCount = Object.keys(result as Record<string, unknown>).length;
        }
    }

    return detail;
}

function buildSuccessSummary(metadata: WrapperOperationMetadata, detail: Record<string, unknown>): string {
    if (metadata.module === 'https') {
        const requestKind = normalizeText(detail.requestKind) || 'request';
        const targetKey = normalizeText(detail.targetKey);
        const responseCode = normalizeText(detail.responseCode);
        return `HTTPS ${normalizeText(detail.method) || metadata.action} ${requestKind}${targetKey ? ` ${targetKey}` : ''}${responseCode ? ` [${responseCode}]` : ''}`;
    }

    if (metadata.module === 'url') {
        const targetType = normalizeText(detail.targetType);
        const targetKey = normalizeText(detail.targetKey);
        return `Resolve ${targetType || 'NetSuite'} URL${targetKey ? ` ${targetKey}` : ''}`;
    }

    if (metadata.module === 'task' && metadata.action === 'submit') {
        const taskType = normalizeText(detail.taskType) || 'NetSuite';
        const taskId = normalizeText(detail.taskId) || normalizeText(detail.returnedTaskId);
        const targetKey = normalizeText(detail.targetKey);
        return `Submit ${taskType} task${targetKey ? ` ${targetKey}` : ''}${taskId ? ` [${taskId}]` : ''}`;
    }

    if (metadata.module === 'task' && metadata.action === 'checkStatus') {
        const taskType = normalizeText(detail.taskType) || 'NetSuite';
        const taskId = normalizeText(detail.taskId);
        const currentStatus = normalizeText(detail.currentStatus);
        return `Check ${taskType} task status${taskId ? ` ${taskId}` : ''}${currentStatus ? ` [${currentStatus}]` : ''}`;
    }

    if (metadata.module === 'query') {
        const targetKey = normalizeText(detail.targetKey);
        const rowCount = normalizeText(detail.rowCount);
        return `${metadata.action === 'load' ? 'Load' : metadata.action === 'create' ? 'Create' : 'Run'} query${targetKey ? ` ${targetKey}` : ''}${rowCount ? ` [${rowCount} rows]` : ''}`;
    }

    if (metadata.module === 'search') {
        const targetKey = normalizeText(detail.targetKey);
        const rowCount = normalizeText(detail.rowCount);
        const fieldCount = normalizeText(detail.fieldCount);
        if (metadata.action === 'lookupFields') {
            return `Lookup fields${targetKey ? ` ${targetKey}` : ''}${fieldCount ? ` [${fieldCount} fields]` : ''}`;
        }

        return `${metadata.action === 'load' ? 'Load' : metadata.action === 'create' ? 'Create' : metadata.action === 'getRange' ? 'Fetch' : 'Run'} search${targetKey ? ` ${targetKey}` : ''}${rowCount ? ` [${rowCount} rows]` : ''}`;
    }

    return '';
}

function deriveFlowId(metadata: WrapperOperationMetadata, detail: Record<string, unknown>, startedAt: Date): string {
    const callerFunctionName = getCallerFunctionName(detail);
    const callerModulePath = getCallerModulePath(detail);
    const timeBucket = Math.floor(startedAt.getTime() / 10000);
    const identityParts = [
        callerModulePath,
        callerFunctionName,
        normalizeText(metadata.module),
        normalizeText(metadata.action),
        normalizeText(detail.targetType),
        normalizeText(detail.targetKey),
        normalizeText(detail.taskId),
        normalizeText(detail.returnedTaskId),
        normalizeText(detail.requestKind),
        normalizeText(detail.urlHost),
        normalizeText(detail.urlPath),
        normalizeText(detail.type),
        normalizeText(detail.id),
        getCurrentUserId(),
        normalizeText(timeBucket),
    ].filter(Boolean);

    if (identityParts.length === 0) {
        return makeId('flow', startedAt);
    }

    return `flow_${hashString(identityParts.join('|'))}_${timeBucket.toString(36)}`;
}

function isPromiseLike<T>(value: T): value is Extract<T, PromiseLike<unknown>> {
    return Boolean(value && typeof (value as { then?: unknown }).then === 'function');
}

function inferTransactionType(detail: Record<string, unknown>): string {
    return normalizeText(detail.type)
        || normalizeText(detail.fromType)
        || normalizeText(detail.toType)
        || normalizeText(detail.targetType)
        || normalizeText(detail.taskType)
        || normalizeText(detail.requestKind);
}

function inferTransactionId(detail: Record<string, unknown>): number | undefined {
    return normalizeTransactionId(detail.id as string | number | null | undefined)
        || normalizeTransactionId(detail.fromId as string | number | null | undefined);
}

function buildPersistedSpan(metadata: WrapperOperationMetadata, span: ActiveWrapperSpan, activeExecution: ActiveTrackedExecutionSnapshot | null, parentExecutionId: string, scopeKey: string, status: string, startedAt: Date, endedAt: Date, detail: unknown, summaryOverride?: string): PersistedTrackerSpan {
    const currentScriptMetadata = getCurrentScriptMetadata();
    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
    const detailWithCaller = mergeCallerContext(detail);
    const detailRecord = getDetailRecord(detailWithCaller);
    const callerFunctionName = getCallerFunctionName(detailWithCaller);
    const callerModulePath = getCallerModulePath(detailWithCaller);
    const executionContext = getExecutionContextLabel();
    const persistedDetail = mergeDetailMetadata(detailWithCaller, getExecutionOriginMetadata(executionContext));
    const operation = callerFunctionName || normalizeText(metadata.action) || 'operation';
    const summary = normalizeText(summaryOverride)
        || normalizeText(metadata.summary)
        || (callerFunctionName
            ? `${callerFunctionName} via ${normalizeText(metadata.module) || 'wrapper'}.${normalizeText(metadata.action) || 'operation'}`
            : `${normalizeText(metadata.module) || 'module'}.${normalizeText(metadata.action) || 'operation'}`);

    return {
        executionId: span.executionId,
        flowId: span.flowId,
        parentExecutionId: normalizeText(parentExecutionId),
        rootExecutionId: normalizeText(activeExecution?.executionId) || span.executionId,
        spanRole: 'module-call',
        entryKind: normalizeText(activeExecution?.entryKind),
        entryKey: normalizeText(activeExecution?.entryKey),
        scriptId: currentScriptMetadata.scriptId,
        scriptName: currentScriptMetadata.scriptId,
        scriptType: executionContext,
        deploymentId: currentScriptMetadata.deploymentId,
        scopeKey,
        stage: normalizeText(metadata.stage) || normalizeText(metadata.module) || 'wrapper',
        operation,
        transactionType: inferTransactionType(detailRecord),
        transactionId: inferTransactionId(detailRecord),
        startedAt: formatTimestamp(startedAt),
        endedAt: formatTimestamp(endedAt),
        durationMs,
        status,
        context: `netsuite-wrapper:${normalizeText(metadata.module) || 'module'}`,
        summary: truncateText(summary, 3900),
        detail: serializeDetail(persistedDetail),
        functionName: callerFunctionName,
        functionModulePath: callerModulePath,
        callChain: buildCallChain(detailWithCaller, metadata),
        wrapperModule: normalizeText(metadata.module),
        wrapperAction: normalizeText(metadata.action),
    };
}

function buildRootExecutionDetail(metadata: TrackedScriptEntryMetadata, execution: ActiveTrackedExecutionSnapshot, detail: unknown): unknown {
    const detailRecord = getDetailRecord(detail);
    return {
        ...detailRecord,
        entryKind: normalizeText(metadata.entryKind),
        entryKey: normalizeText(metadata.entryKey),
        filePath: normalizeText(metadata.filePath),
        modulePath: normalizeText(metadata.modulePath),
        observedFunctionCount: execution.observedFunctions.length,
        observedFunctions: execution.observedFunctions,
    };
}

function buildRootExecutionSpan(metadata: TrackedScriptEntryMetadata, execution: ActiveTrackedExecutionSnapshot, status: string, startedAt: Date, endedAt: Date, detail: unknown, summaryOverride?: string): PersistedTrackerSpan {
    const currentScriptMetadata = getCurrentScriptMetadata();
    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
    const executionContext = getExecutionContextLabel();
    const persistedDetail = mergeDetailMetadata(
        buildRootExecutionDetail(metadata, execution, detail),
        getExecutionOriginMetadata(executionContext),
    );
    const normalizedEntryKind = normalizeText(metadata.entryKind) || normalizeText(metadata.scriptType) || 'entry';
    const normalizedEntryKey = normalizeText(metadata.entryKey) || normalizedEntryKind;
    const summary = normalizeText(summaryOverride)
        || `${normalizedEntryKind} ${normalizedEntryKey}`;

    return {
        executionId: execution.executionId,
        flowId: execution.flowId,
        parentExecutionId: '',
        rootExecutionId: execution.executionId,
        spanRole: 'entry',
        entryKind: normalizedEntryKind,
        entryKey: normalizedEntryKey,
        scriptId: currentScriptMetadata.scriptId,
        scriptName: currentScriptMetadata.scriptId,
        scriptType: normalizeText(metadata.scriptType) || executionContext,
        deploymentId: currentScriptMetadata.deploymentId,
        scopeKey: normalizeText(metadata.scopeKey),
        stage: normalizedEntryKind,
        operation: normalizedEntryKey,
        transactionType: '',
        transactionId: undefined,
        startedAt: formatTimestamp(startedAt),
        endedAt: formatTimestamp(endedAt),
        durationMs,
        status,
        context: `netsuite-entry:${normalizedEntryKind}`,
        summary: truncateText(summary, 3900),
        detail: serializeDetail(persistedDetail),
        functionName: normalizedEntryKey,
        functionModulePath: normalizeText(metadata.modulePath) || normalizeText(metadata.filePath),
        callChain: normalizedEntryKey,
        wrapperModule: '',
        wrapperAction: '',
    };
}

function persistSpan(span: PersistedTrackerSpan): void {
    try {
        const spanRecord = getNsRecord().create({
            type: EXECUTION_RECORD_TYPE,
            isDynamic: false,
        });

        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.executionId, value: span.executionId });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.flowId, value: span.flowId });
        if (span.parentExecutionId) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.parentExecutionId, value: span.parentExecutionId });
        }
        if (span.rootExecutionId) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.rootExecutionId, value: span.rootExecutionId });
        }
        if (span.spanRole) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.spanRole, value: span.spanRole });
        }
        if (span.entryKind) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.entryKind, value: span.entryKind });
        }
        if (span.entryKey) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.entryKey, value: span.entryKey });
        }
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.scriptId, value: span.scriptId });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.scriptName, value: span.scriptName });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.scriptType, value: span.scriptType });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.deploymentId, value: span.deploymentId });
        if (span.scopeKey) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.scopeKey, value: span.scopeKey });
        }
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.stage, value: span.stage });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.operation, value: span.operation });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.transactionType, value: span.transactionType });
        if (span.transactionId !== undefined) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.transactionId, value: span.transactionId });
        }
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.startedAt, value: span.startedAt });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.endedAt, value: span.endedAt });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.durationMs, value: span.durationMs });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.status, value: span.status });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.context, value: span.context });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.summary, value: span.summary });
        spanRecord.setValue({ fieldId: EXECUTION_FIELDS.detail, value: span.detail });
        if (span.functionName) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.functionName, value: span.functionName });
        }
        if (span.functionModulePath) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.functionModulePath, value: span.functionModulePath });
        }
        if (span.callChain) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.callChain, value: span.callChain });
        }
        if (span.wrapperModule) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.wrapperModule, value: span.wrapperModule });
        }
        if (span.wrapperAction) {
            spanRecord.setValue({ fieldId: EXECUTION_FIELDS.wrapperAction, value: span.wrapperAction });
        }
        spanRecord.save({ enableSourcing: false, ignoreMandatoryFields: true });
    } catch (error) {
        getNsLog().error({ title: 'netsuite-wrapper PerformanceTracker telemetry save failed', details: String(error) });
    }
}

function enqueueDeferredSpan(rootExecutionId: string, span: PersistedTrackerSpan): void {
    const executionKey = normalizeText(rootExecutionId);
    if (!executionKey) {
        persistSpan(span);
        return;
    }

    const existingQueue = deferredSpanQueues.get(executionKey);
    if (existingQueue) {
        existingQueue.push(span);
        return;
    }

    deferredSpanQueues.set(executionKey, [span]);
}

function flushDeferredSpans(rootExecutionId: string): void {
    const executionKey = normalizeText(rootExecutionId);
    if (!executionKey) {
        return;
    }

    const queuedSpans = deferredSpanQueues.get(executionKey);
    if (!queuedSpans || queuedSpans.length === 0) {
        deferredSpanQueues.delete(executionKey);
        return;
    }

    deferredSpanQueues.delete(executionKey);
    queuedSpans.forEach((span) => persistSpan(span));
}

function normalizeSinkOptions(optionsOrScopeKey?: string | PerformanceTrackerSinkOptions): PerformanceTrackerSinkOptions {
    if (typeof optionsOrScopeKey === 'string') {
        return { defaultScopeKey: optionsOrScopeKey };
    }

    return optionsOrScopeKey || {};
}

export function runTrackedScriptEntry<T>(metadata: TrackedScriptEntryMetadata, work: () => T): T {
    const scopeKey = normalizeText(metadata.scopeKey);
    const telemetryMode = resolveTelemetryMode(scopeKey);
    if (!scopeKey || telemetryMode === 'off') {
        return work();
    }

    const startedAt = new Date();
    const execution = startTrackedScriptExecution(metadata, startedAt);

    const finish = (status: string, detail: unknown, summaryOverride?: string): void => {
        const completedExecution = finishTrackedScriptExecution(execution.executionId) || execution;
        flushDeferredSpans(completedExecution.executionId);
        persistSpan(buildRootExecutionSpan(
            metadata,
            completedExecution,
            status,
            startedAt,
            new Date(),
            detail,
            summaryOverride,
        ));
    };

    try {
        const result = work();
        if (isPromiseLike(result)) {
            return result.then((value) => {
                finish('SUCCESS', {
                    resultType: typeof value,
                }, `${normalizeText(metadata.entryKind)} ${normalizeText(metadata.entryKey)}`);
                return value;
            }, (error) => {
                const errorObject = error as { message?: string; stack?: string; name?: string };
                finish('ERROR', {
                    errorName: normalizeText(errorObject.name),
                    message: normalizeText(errorObject.message),
                    stack: normalizeText(errorObject.stack),
                }, normalizeText(errorObject.message) || normalizeText(metadata.entryKey));
                throw error;
            }) as T;
        }

        finish('SUCCESS', {
            resultType: typeof result,
        }, `${normalizeText(metadata.entryKind)} ${normalizeText(metadata.entryKey)}`);
        return result;
    } catch (error) {
        const errorObject = error as { message?: string; stack?: string; name?: string };
        finish('ERROR', {
            errorName: normalizeText(errorObject.name),
            message: normalizeText(errorObject.message),
            stack: normalizeText(errorObject.stack),
        }, normalizeText(errorObject.message) || normalizeText(metadata.entryKey));
        throw error;
    }
}

export function createPerformanceTrackerSink(optionsOrScopeKey?: string | PerformanceTrackerSinkOptions): WrapperTelemetrySink {
    const options = normalizeSinkOptions(optionsOrScopeKey);
    const defaultScopeKey = normalizeText(options.defaultScopeKey);
    const activeSpans: ActiveWrapperSpan[] = [];

    return {
        isActive(): boolean {
            return Boolean(getActiveTrackedExecutionSnapshot());
        },
        runOperation<T>(metadata: WrapperOperationMetadata, work: () => T): T {
            const activeExecution = getActiveTrackedExecutionSnapshot();
            if (!activeExecution) {
                return work();
            }

            const scopeKey = normalizeText(metadata.scopeKey) || normalizeText(activeExecution.scopeKey) || defaultScopeKey;
            const telemetryMode = resolveTelemetryMode(scopeKey);
            if (telemetryMode === 'off') {
                return work();
            }

            const startedAt = new Date();
            const parentSpan = activeSpans[activeSpans.length - 1];
            const span: ActiveWrapperSpan = {
                executionId: makeId('exec', startedAt),
                flowId: normalizeText(activeExecution.flowId) || (parentSpan ? parentSpan.flowId : deriveFlowId(metadata, getDetailRecord(mergeCallerContext(metadata.detail)), startedAt)),
            };
            const shouldPersist = telemetryMode === 'diagnostic';
            activeSpans.push(span);

            const finish = (status: string, detail: unknown, summaryOverride?: string): void => {
                const activeSpanIndex = activeSpans.lastIndexOf(span);
                if (activeSpanIndex !== -1) {
                    activeSpans.splice(activeSpanIndex, 1);
                }

                if (!shouldPersist) {
                    return;
                }

                enqueueDeferredSpan(activeExecution.executionId, buildPersistedSpan(
                    metadata,
                    span,
                    activeExecution,
                    parentSpan?.executionId || normalizeText(activeExecution.executionId),
                    scopeKey,
                    status,
                    startedAt,
                    new Date(),
                    detail,
                    summaryOverride,
                ));
            };

            try {
                const result = work();
                if (isPromiseLike(result)) {
                    return result.then((value) => {
                        if (shouldPersist) {
                            const successDetail = enrichSuccessDetail(metadata, value);
                            const successSummary = buildSuccessSummary(metadata, successDetail);
                            finish('SUCCESS', successDetail, successSummary);
                        } else {
                            finish('SUCCESS', null, normalizeText(metadata.summary));
                        }
                        return value;
                    }, (error) => {
                        const errorObject = error as { message?: string; stack?: string; name?: string };
                        if (shouldPersist) {
                            finish('ERROR', {
                                ...(metadata.detail || {}),
                                errorName: normalizeText(errorObject.name),
                                message: normalizeText(errorObject.message),
                                stack: normalizeText(errorObject.stack),
                            }, normalizeText(errorObject.message) || normalizeText(metadata.summary));
                        } else {
                            finish('ERROR', null, normalizeText(errorObject.message) || normalizeText(metadata.summary));
                        }
                        throw error;
                    }) as T;
                }

                if (shouldPersist) {
                    const successDetail = enrichSuccessDetail(metadata, result);
                    const successSummary = buildSuccessSummary(metadata, successDetail);
                    finish('SUCCESS', successDetail, successSummary);
                } else {
                    finish('SUCCESS', null, normalizeText(metadata.summary));
                }
                return result;
            } catch (error) {
                const errorObject = error as { message?: string; stack?: string; name?: string };
                if (shouldPersist) {
                    finish('ERROR', {
                        ...(metadata.detail || {}),
                        errorName: normalizeText(errorObject.name),
                        message: normalizeText(errorObject.message),
                        stack: normalizeText(errorObject.stack),
                    }, normalizeText(errorObject.message) || normalizeText(metadata.summary));
                } else {
                    finish('ERROR', null, normalizeText(errorObject.message) || normalizeText(metadata.summary));
                }
                throw error;
            }
        },
    };
}