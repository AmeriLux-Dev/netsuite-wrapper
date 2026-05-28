var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
define(["require", "exports", "./function-context", "./execution-tracking"], function (require, exports, function_context_1, execution_tracking_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.runTrackedScriptEntry = runTrackedScriptEntry;
    exports.createPerformanceTrackerSink = createPerformanceTrackerSink;
    var EXECUTION_RECORD_TYPE = 'customrecord_ptrk_exec_span';
    var SCOPE_RECORD_TYPE = 'customrecord_ptrk_scope';
    var TELEMETRY_SCOPE_CACHE = 'ptrk_scope_modes';
    var DEFAULT_SCOPE_TTL_SECONDS = 1800;
    var MIN_SCOPE_TTL_SECONDS = 300;
    var EXECUTION_FIELDS = {
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
    };
    var SCOPE_FIELDS = {
        scopeKey: 'custrecord_ptrk_scope_key',
        mode: 'custrecord_ptrk_scope_mode',
        expiresAt: 'custrecord_ptrk_scope_expires_at',
    };
    var deferredSpanQueues = new Map();
    function getNsCache() {
        return require('N/cache');
    }
    function getNsLog() {
        return require('N/log');
    }
    function getNsRecord() {
        return require('N/record');
    }
    function getNsRuntime() {
        return require('N/runtime');
    }
    function getNsSearch() {
        return require('N/search');
    }
    function normalizeText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }
    function truncateText(value, maxLength) {
        if (value.length <= maxLength) {
            return value;
        }
        return value.slice(0, maxLength);
    }
    function normalizeTransactionId(value) {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        var parsed = typeof value === 'number' ? value : Number(String(value).trim());
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    function serializeDetail(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }
        if (typeof value === 'string') {
            return truncateText(value, 100000);
        }
        try {
            return truncateText(JSON.stringify(value), 100000);
        }
        catch (_error) {
            return truncateText(String(value), 100000);
        }
    }
    function mergeDetailMetadata(detail, metadata) {
        if (!detail || detail === '') {
            return metadata;
        }
        if (typeof detail === 'object' && !Array.isArray(detail)) {
            return __assign(__assign({}, detail), metadata);
        }
        return __assign({ note: typeof detail === 'string' ? detail : String(detail) }, metadata);
    }
    function getExecutionOriginMetadata(executionContext) {
        var normalizedContext = normalizeText(executionContext).toUpperCase();
        var metadata = {};
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
    function normalizeScopeMode(value) {
        if (value === 'off' || value === 'boundary' || value === 'diagnostic') {
            return value;
        }
        return 'diagnostic';
    }
    function hasScopeExpired(expiresAt) {
        if (!expiresAt) {
            return false;
        }
        var parsed = Date.parse(expiresAt);
        return !Number.isNaN(parsed) && parsed <= Date.now();
    }
    function resolveModeFromScopeState(scopeState) {
        if (hasScopeExpired(scopeState.expiresAt)) {
            return 'off';
        }
        return normalizeScopeMode(scopeState.mode);
    }
    function serializeScopeState(scopeState) {
        return JSON.stringify(scopeState);
    }
    function parseScopeState(value) {
        if (!value) {
            return null;
        }
        try {
            var parsed = JSON.parse(value);
            return {
                mode: normalizeScopeMode(parsed.mode),
                expiresAt: normalizeText(parsed.expiresAt),
            };
        }
        catch (_error) {
            return null;
        }
    }
    function computeScopeCacheTtlSeconds(scopeState) {
        if (!scopeState.expiresAt) {
            return DEFAULT_SCOPE_TTL_SECONDS;
        }
        var parsed = Date.parse(scopeState.expiresAt);
        if (Number.isNaN(parsed)) {
            return DEFAULT_SCOPE_TTL_SECONDS;
        }
        var secondsUntilExpiry = Math.ceil((parsed - Date.now()) / 1000);
        return Math.max(MIN_SCOPE_TTL_SECONDS, secondsUntilExpiry);
    }
    function getScopeCache() {
        var nsCache = getNsCache();
        return nsCache.getCache({
            name: TELEMETRY_SCOPE_CACHE,
            scope: nsCache.Scope.PUBLIC,
        });
    }
    function loadScopeState(scopeKey) {
        try {
            var nsSearch = getNsSearch();
            var results = nsSearch.create({
                type: SCOPE_RECORD_TYPE,
                filters: [[SCOPE_FIELDS.scopeKey, 'is', scopeKey]],
                columns: [SCOPE_FIELDS.mode, SCOPE_FIELDS.expiresAt],
            }).run().getRange({ start: 0, end: 1 });
            var match = results[0];
            return {
                mode: normalizeScopeMode(match === null || match === void 0 ? void 0 : match.getValue(SCOPE_FIELDS.mode)),
                expiresAt: normalizeText(match === null || match === void 0 ? void 0 : match.getValue(SCOPE_FIELDS.expiresAt)),
            };
        }
        catch (_error) {
            return {
                mode: 'diagnostic',
                expiresAt: '',
            };
        }
    }
    function resolveTelemetryMode(scopeKey) {
        if (!scopeKey) {
            return 'diagnostic';
        }
        try {
            var scopeCache = getScopeCache();
            var cachedValue = scopeCache.get({ key: scopeKey });
            var cachedScopeState = parseScopeState(cachedValue || '');
            if (cachedScopeState) {
                return resolveModeFromScopeState(cachedScopeState);
            }
            var scopeState = loadScopeState(scopeKey);
            scopeCache.put({
                key: scopeKey,
                value: serializeScopeState(scopeState),
                ttl: computeScopeCacheTtlSeconds(scopeState),
            });
            return resolveModeFromScopeState(scopeState);
        }
        catch (_error) {
            return 'diagnostic';
        }
    }
    function formatTimestamp(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        var hours = String(date.getHours()).padStart(2, '0');
        var minutes = String(date.getMinutes()).padStart(2, '0');
        var seconds = String(date.getSeconds()).padStart(2, '0');
        return "".concat(year, "-").concat(month, "-").concat(day, " ").concat(hours, ":").concat(minutes, ":").concat(seconds);
    }
    function getCurrentScriptMetadata() {
        var currentScript = getNsRuntime().getCurrentScript();
        return {
            scriptId: normalizeText(currentScript.id),
            deploymentId: normalizeText(currentScript.deploymentId),
        };
    }
    function getCurrentUserId() {
        try {
            var currentUser = getNsRuntime().getCurrentUser();
            return normalizeText(currentUser.id);
        }
        catch (_error) {
            return '';
        }
    }
    function getExecutionContextLabel() {
        try {
            return normalizeText(getNsRuntime().executionContext);
        }
        catch (_error) {
            return '';
        }
    }
    function makeId(prefix, startedAt) {
        var randomComponent = Math.floor(Math.random() * 0xffffff).toString(36);
        return "".concat(prefix, "_").concat(startedAt.getTime().toString(36), "_").concat(randomComponent);
    }
    function hashString(input) {
        var hash = 0;
        for (var index = 0; index < input.length; index += 1) {
            hash = ((hash << 5) - hash) + input.charCodeAt(index);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
    function getDetailRecord(detail) {
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
            return {};
        }
        return detail;
    }
    function cloneCallerContext(context) {
        return __assign({}, context);
    }
    function isCallerContext(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }
        return typeof value.functionName === 'string';
    }
    function getCallerChain(detail) {
        var detailRecord = getDetailRecord(detail);
        var callerChain = detailRecord.callerChain;
        if (!Array.isArray(callerChain)) {
            return [];
        }
        return callerChain.filter(isCallerContext).map(cloneCallerContext);
    }
    function isWrapperAdapterContext(context) {
        var modulePath = normalizeText(context.modulePath) || normalizeText(context.filePath);
        return modulePath.startsWith('netsuite-wrapper/')
            || modulePath.includes('/netsuite-wrapper/');
    }
    function isInfrastructureCallerContext(context) {
        return Boolean(context.excludeFromObservedFunctions);
    }
    function getPreferredCallerContext(callerChain) {
        var applicationContext = callerChain.find(function (context) { return !isWrapperAdapterContext(context) && !isInfrastructureCallerContext(context); });
        if (applicationContext) {
            return cloneCallerContext(applicationContext);
        }
        var nonInfrastructureContext = callerChain.find(function (context) { return !isInfrastructureCallerContext(context); });
        if (nonInfrastructureContext) {
            return cloneCallerContext(nonInfrastructureContext);
        }
        var innermostContext = callerChain[callerChain.length - 1];
        return innermostContext ? cloneCallerContext(innermostContext) : null;
    }
    function getInnermostCallerContext(callerChain) {
        var innermostContext = callerChain[callerChain.length - 1];
        return innermostContext ? cloneCallerContext(innermostContext) : null;
    }
    function buildCallerChainLabel(callerChain) {
        return callerChain
            .map(function (context) { return normalizeText(context.functionName); })
            .filter(Boolean)
            .join(' -> ');
    }
    function buildModuleOperationLabel(moduleName, action) {
        var normalizedModuleName = normalizeText(moduleName);
        var normalizedAction = normalizeText(action);
        if (!normalizedModuleName && !normalizedAction) {
            return '';
        }
        if (!normalizedModuleName) {
            return normalizedAction;
        }
        if (!normalizedAction) {
            return normalizedModuleName;
        }
        return "".concat(normalizedModuleName, ".").concat(normalizedAction);
    }
    function buildCallChain(detail, metadata) {
        var callerChain = getCallerChain(detail);
        var callerChainLabel = buildCallerChainLabel(callerChain);
        var moduleOperationLabel = buildModuleOperationLabel(metadata.module, metadata.action);
        if (!callerChainLabel) {
            return moduleOperationLabel;
        }
        return moduleOperationLabel ? "".concat(callerChainLabel, " -> ").concat(moduleOperationLabel) : callerChainLabel;
    }
    function getCallerDetailRecord(detail) {
        var detailRecord = getDetailRecord(detail);
        var callerDetail = detailRecord.caller;
        if (!callerDetail || typeof callerDetail !== 'object' || Array.isArray(callerDetail)) {
            return {};
        }
        return callerDetail;
    }
    function getCallerFunctionName(detail) {
        return normalizeText(getCallerDetailRecord(detail).functionName);
    }
    function getCallerModulePath(detail) {
        var callerDetail = getCallerDetailRecord(detail);
        return normalizeText(callerDetail.modulePath) || normalizeText(callerDetail.filePath);
    }
    function mergeCallerContext(detail) {
        var activeCallerStack = (0, function_context_1.getFunctionContextStack)();
        var activeCallerContext = (0, function_context_1.getActiveFunctionContext)();
        var callerChain = activeCallerStack.length > 0
            ? activeCallerStack.map(cloneCallerContext)
            : (activeCallerContext ? [cloneCallerContext(activeCallerContext)] : getCallerChain(detail));
        if (callerChain.length === 0) {
            return detail;
        }
        var mergedCaller = getPreferredCallerContext(callerChain);
        var mergedWrapperCaller = getInnermostCallerContext(callerChain);
        var callerChainLabel = buildCallerChainLabel(callerChain);
        if (!detail || detail === '') {
            return __assign(__assign(__assign(__assign({}, (mergedCaller ? { caller: mergedCaller } : {})), (mergedWrapperCaller ? { wrapperCaller: mergedWrapperCaller } : {})), { callerChain: callerChain }), (callerChainLabel ? { callerChainLabel: callerChainLabel } : {}));
        }
        if (typeof detail === 'object' && !Array.isArray(detail)) {
            return __assign(__assign(__assign(__assign(__assign({}, detail), (mergedCaller ? { caller: mergedCaller } : {})), (mergedWrapperCaller ? { wrapperCaller: mergedWrapperCaller } : {})), { callerChain: callerChain }), (callerChainLabel ? { callerChainLabel: callerChainLabel } : {}));
        }
        return __assign(__assign(__assign(__assign({ note: typeof detail === 'string' ? detail : String(detail) }, (mergedCaller ? { caller: mergedCaller } : {})), (mergedWrapperCaller ? { wrapperCaller: mergedWrapperCaller } : {})), { callerChain: callerChain }), (callerChainLabel ? { callerChainLabel: callerChainLabel } : {}));
    }
    function classifyResponseCode(code) {
        if (!Number.isFinite(code) || code <= 0) {
            return '';
        }
        return "".concat(Math.floor(code / 100), "xx");
    }
    function enrichSuccessDetail(metadata, result) {
        var detail = __assign({}, getDetailRecord(metadata.detail));
        if (metadata.module === 'https') {
            var response = result;
            var responseCode = typeof (response === null || response === void 0 ? void 0 : response.code) === 'number' ? response.code : Number(response === null || response === void 0 ? void 0 : response.code);
            if (Number.isFinite(responseCode)) {
                detail.responseCode = responseCode;
                detail.responseClass = classifyResponseCode(responseCode);
            }
            if (typeof (response === null || response === void 0 ? void 0 : response.body) === 'string') {
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
            var statusResult = result;
            detail.currentStatus = normalizeText(statusResult === null || statusResult === void 0 ? void 0 : statusResult.status);
            if (!normalizeText(detail.taskId)) {
                detail.taskId = normalizeText(statusResult === null || statusResult === void 0 ? void 0 : statusResult.taskId);
            }
        }
        if (metadata.module === 'query') {
            var queryResult = result;
            if (Array.isArray(queryResult === null || queryResult === void 0 ? void 0 : queryResult.results)) {
                detail.rowCount = queryResult.results.length;
            }
            if (typeof (queryResult === null || queryResult === void 0 ? void 0 : queryResult.count) === 'number') {
                detail.rowCount = queryResult.count;
            }
            if (Array.isArray(queryResult === null || queryResult === void 0 ? void 0 : queryResult.pageRanges)) {
                detail.pageCount = queryResult.pageRanges.length;
            }
            if ((queryResult === null || queryResult === void 0 ? void 0 : queryResult.data) && Array.isArray(queryResult.data.results)) {
                detail.rowCount = queryResult.data.results.length;
            }
        }
        if (metadata.module === 'search') {
            if (Array.isArray(result)) {
                detail.rowCount = result.length;
            }
            var searchResult = result;
            if (typeof (searchResult === null || searchResult === void 0 ? void 0 : searchResult.count) === 'number') {
                detail.rowCount = searchResult.count;
            }
            if (Array.isArray(searchResult === null || searchResult === void 0 ? void 0 : searchResult.pageRanges)) {
                detail.pageCount = searchResult.pageRanges.length;
            }
            if (Array.isArray(searchResult === null || searchResult === void 0 ? void 0 : searchResult.data)) {
                detail.rowCount = searchResult.data.length;
            }
            if (Array.isArray(searchResult === null || searchResult === void 0 ? void 0 : searchResult.columns)) {
                detail.columnCount = searchResult.columns.length;
            }
            if (metadata.action === 'lookupFields' && result && typeof result === 'object' && !Array.isArray(result)) {
                detail.fieldCount = Object.keys(result).length;
            }
        }
        return detail;
    }
    function buildSuccessSummary(metadata, detail) {
        if (metadata.module === 'https') {
            var requestKind = normalizeText(detail.requestKind) || 'request';
            var targetKey = normalizeText(detail.targetKey);
            var responseCode = normalizeText(detail.responseCode);
            return "HTTPS ".concat(normalizeText(detail.method) || metadata.action, " ").concat(requestKind).concat(targetKey ? " ".concat(targetKey) : '').concat(responseCode ? " [".concat(responseCode, "]") : '');
        }
        if (metadata.module === 'url') {
            var targetType = normalizeText(detail.targetType);
            var targetKey = normalizeText(detail.targetKey);
            return "Resolve ".concat(targetType || 'NetSuite', " URL").concat(targetKey ? " ".concat(targetKey) : '');
        }
        if (metadata.module === 'task' && metadata.action === 'submit') {
            var taskType = normalizeText(detail.taskType) || 'NetSuite';
            var taskId = normalizeText(detail.taskId) || normalizeText(detail.returnedTaskId);
            var targetKey = normalizeText(detail.targetKey);
            return "Submit ".concat(taskType, " task").concat(targetKey ? " ".concat(targetKey) : '').concat(taskId ? " [".concat(taskId, "]") : '');
        }
        if (metadata.module === 'task' && metadata.action === 'checkStatus') {
            var taskType = normalizeText(detail.taskType) || 'NetSuite';
            var taskId = normalizeText(detail.taskId);
            var currentStatus = normalizeText(detail.currentStatus);
            return "Check ".concat(taskType, " task status").concat(taskId ? " ".concat(taskId) : '').concat(currentStatus ? " [".concat(currentStatus, "]") : '');
        }
        if (metadata.module === 'query') {
            var targetKey = normalizeText(detail.targetKey);
            var rowCount = normalizeText(detail.rowCount);
            return "".concat(metadata.action === 'load' ? 'Load' : metadata.action === 'create' ? 'Create' : 'Run', " query").concat(targetKey ? " ".concat(targetKey) : '').concat(rowCount ? " [".concat(rowCount, " rows]") : '');
        }
        if (metadata.module === 'search') {
            var targetKey = normalizeText(detail.targetKey);
            var rowCount = normalizeText(detail.rowCount);
            var fieldCount = normalizeText(detail.fieldCount);
            if (metadata.action === 'lookupFields') {
                return "Lookup fields".concat(targetKey ? " ".concat(targetKey) : '').concat(fieldCount ? " [".concat(fieldCount, " fields]") : '');
            }
            return "".concat(metadata.action === 'load' ? 'Load' : metadata.action === 'create' ? 'Create' : metadata.action === 'getRange' ? 'Fetch' : 'Run', " search").concat(targetKey ? " ".concat(targetKey) : '').concat(rowCount ? " [".concat(rowCount, " rows]") : '');
        }
        return '';
    }
    function deriveFlowId(metadata, detail, startedAt) {
        var callerFunctionName = getCallerFunctionName(detail);
        var callerModulePath = getCallerModulePath(detail);
        var timeBucket = Math.floor(startedAt.getTime() / 10000);
        var identityParts = [
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
        return "flow_".concat(hashString(identityParts.join('|')), "_").concat(timeBucket.toString(36));
    }
    function isPromiseLike(value) {
        return Boolean(value && typeof value.then === 'function');
    }
    function inferTransactionType(detail) {
        return normalizeText(detail.type)
            || normalizeText(detail.fromType)
            || normalizeText(detail.toType)
            || normalizeText(detail.targetType)
            || normalizeText(detail.taskType)
            || normalizeText(detail.requestKind);
    }
    function inferTransactionId(detail) {
        return normalizeTransactionId(detail.id)
            || normalizeTransactionId(detail.fromId);
    }
    function buildPersistedSpan(metadata, span, activeExecution, parentExecutionId, scopeKey, status, startedAt, endedAt, detail, summaryOverride) {
        var currentScriptMetadata = getCurrentScriptMetadata();
        var durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        var detailWithCaller = mergeCallerContext(detail);
        var detailRecord = getDetailRecord(detailWithCaller);
        var callerFunctionName = getCallerFunctionName(detailWithCaller);
        var callerModulePath = getCallerModulePath(detailWithCaller);
        var executionContext = getExecutionContextLabel();
        var persistedDetail = mergeDetailMetadata(detailWithCaller, getExecutionOriginMetadata(executionContext));
        var operation = callerFunctionName || normalizeText(metadata.action) || 'operation';
        var summary = normalizeText(summaryOverride)
            || normalizeText(metadata.summary)
            || (callerFunctionName
                ? "".concat(callerFunctionName, " via ").concat(normalizeText(metadata.module) || 'wrapper', ".").concat(normalizeText(metadata.action) || 'operation')
                : "".concat(normalizeText(metadata.module) || 'module', ".").concat(normalizeText(metadata.action) || 'operation'));
        return {
            executionId: span.executionId,
            flowId: span.flowId,
            parentExecutionId: normalizeText(parentExecutionId),
            rootExecutionId: normalizeText(activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.executionId) || span.executionId,
            spanRole: 'module-call',
            entryKind: normalizeText(activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.entryKind),
            entryKey: normalizeText(activeExecution === null || activeExecution === void 0 ? void 0 : activeExecution.entryKey),
            scriptId: currentScriptMetadata.scriptId,
            scriptName: currentScriptMetadata.scriptId,
            scriptType: executionContext,
            deploymentId: currentScriptMetadata.deploymentId,
            scopeKey: scopeKey,
            stage: normalizeText(metadata.stage) || normalizeText(metadata.module) || 'wrapper',
            operation: operation,
            transactionType: inferTransactionType(detailRecord),
            transactionId: inferTransactionId(detailRecord),
            startedAt: formatTimestamp(startedAt),
            endedAt: formatTimestamp(endedAt),
            durationMs: durationMs,
            status: status,
            context: "netsuite-wrapper:".concat(normalizeText(metadata.module) || 'module'),
            summary: truncateText(summary, 3900),
            detail: serializeDetail(persistedDetail),
            functionName: callerFunctionName,
            functionModulePath: callerModulePath,
            callChain: buildCallChain(detailWithCaller, metadata),
            wrapperModule: normalizeText(metadata.module),
            wrapperAction: normalizeText(metadata.action),
        };
    }
    function buildRootExecutionDetail(metadata, execution, detail) {
        var detailRecord = getDetailRecord(detail);
        return __assign(__assign({}, detailRecord), { entryKind: normalizeText(metadata.entryKind), entryKey: normalizeText(metadata.entryKey), filePath: normalizeText(metadata.filePath), modulePath: normalizeText(metadata.modulePath), observedFunctionCount: execution.observedFunctions.length, observedFunctions: execution.observedFunctions });
    }
    function buildRootExecutionSpan(metadata, execution, status, startedAt, endedAt, detail, summaryOverride) {
        var currentScriptMetadata = getCurrentScriptMetadata();
        var durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        var executionContext = getExecutionContextLabel();
        var persistedDetail = mergeDetailMetadata(buildRootExecutionDetail(metadata, execution, detail), getExecutionOriginMetadata(executionContext));
        var normalizedEntryKind = normalizeText(metadata.entryKind) || normalizeText(metadata.scriptType) || 'entry';
        var normalizedEntryKey = normalizeText(metadata.entryKey) || normalizedEntryKind;
        var summary = normalizeText(summaryOverride)
            || "".concat(normalizedEntryKind, " ").concat(normalizedEntryKey);
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
            durationMs: durationMs,
            status: status,
            context: "netsuite-entry:".concat(normalizedEntryKind),
            summary: truncateText(summary, 3900),
            detail: serializeDetail(persistedDetail),
            functionName: normalizedEntryKey,
            functionModulePath: normalizeText(metadata.modulePath) || normalizeText(metadata.filePath),
            callChain: normalizedEntryKey,
            wrapperModule: '',
            wrapperAction: '',
        };
    }
    function persistSpan(span) {
        try {
            var spanRecord = getNsRecord().create({
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
        }
        catch (error) {
            getNsLog().error({ title: 'netsuite-wrapper PerformanceTracker telemetry save failed', details: String(error) });
        }
    }
    function enqueueDeferredSpan(rootExecutionId, span) {
        var executionKey = normalizeText(rootExecutionId);
        if (!executionKey) {
            persistSpan(span);
            return;
        }
        var existingQueue = deferredSpanQueues.get(executionKey);
        if (existingQueue) {
            existingQueue.push(span);
            return;
        }
        deferredSpanQueues.set(executionKey, [span]);
    }
    function flushDeferredSpans(rootExecutionId) {
        var executionKey = normalizeText(rootExecutionId);
        if (!executionKey) {
            return;
        }
        var queuedSpans = deferredSpanQueues.get(executionKey);
        if (!queuedSpans || queuedSpans.length === 0) {
            deferredSpanQueues.delete(executionKey);
            return;
        }
        deferredSpanQueues.delete(executionKey);
        queuedSpans.forEach(function (span) { return persistSpan(span); });
    }
    function normalizeSinkOptions(optionsOrScopeKey) {
        if (typeof optionsOrScopeKey === 'string') {
            return { defaultScopeKey: optionsOrScopeKey };
        }
        return optionsOrScopeKey || {};
    }
    function runTrackedScriptEntry(metadata, work) {
        var scopeKey = normalizeText(metadata.scopeKey);
        var telemetryMode = resolveTelemetryMode(scopeKey);
        if (!scopeKey || telemetryMode === 'off') {
            return work();
        }
        var startedAt = new Date();
        var execution = (0, execution_tracking_1.startTrackedScriptExecution)(metadata, startedAt);
        var finish = function (status, detail, summaryOverride) {
            var completedExecution = (0, execution_tracking_1.finishTrackedScriptExecution)(execution.executionId) || execution;
            flushDeferredSpans(completedExecution.executionId);
            persistSpan(buildRootExecutionSpan(metadata, completedExecution, status, startedAt, new Date(), detail, summaryOverride));
        };
        try {
            var result = work();
            if (isPromiseLike(result)) {
                return result.then(function (value) {
                    finish('SUCCESS', {
                        resultType: typeof value,
                    }, "".concat(normalizeText(metadata.entryKind), " ").concat(normalizeText(metadata.entryKey)));
                    return value;
                }, function (error) {
                    var errorObject = error;
                    finish('ERROR', {
                        errorName: normalizeText(errorObject.name),
                        message: normalizeText(errorObject.message),
                        stack: normalizeText(errorObject.stack),
                    }, normalizeText(errorObject.message) || normalizeText(metadata.entryKey));
                    throw error;
                });
            }
            finish('SUCCESS', {
                resultType: typeof result,
            }, "".concat(normalizeText(metadata.entryKind), " ").concat(normalizeText(metadata.entryKey)));
            return result;
        }
        catch (error) {
            var errorObject = error;
            finish('ERROR', {
                errorName: normalizeText(errorObject.name),
                message: normalizeText(errorObject.message),
                stack: normalizeText(errorObject.stack),
            }, normalizeText(errorObject.message) || normalizeText(metadata.entryKey));
            throw error;
        }
    }
    function createPerformanceTrackerSink(optionsOrScopeKey) {
        var options = normalizeSinkOptions(optionsOrScopeKey);
        var defaultScopeKey = normalizeText(options.defaultScopeKey);
        var activeSpans = [];
        return {
            isActive: function () {
                return Boolean((0, execution_tracking_1.getActiveTrackedExecutionSnapshot)());
            },
            runOperation: function (metadata, work) {
                var activeExecution = (0, execution_tracking_1.getActiveTrackedExecutionSnapshot)();
                if (!activeExecution) {
                    return work();
                }
                var scopeKey = normalizeText(metadata.scopeKey) || normalizeText(activeExecution.scopeKey) || defaultScopeKey;
                var telemetryMode = resolveTelemetryMode(scopeKey);
                if (telemetryMode === 'off') {
                    return work();
                }
                var startedAt = new Date();
                var parentSpan = activeSpans[activeSpans.length - 1];
                var span = {
                    executionId: makeId('exec', startedAt),
                    flowId: normalizeText(activeExecution.flowId) || (parentSpan ? parentSpan.flowId : deriveFlowId(metadata, getDetailRecord(mergeCallerContext(metadata.detail)), startedAt)),
                };
                var shouldPersist = telemetryMode === 'diagnostic';
                activeSpans.push(span);
                var finish = function (status, detail, summaryOverride) {
                    var activeSpanIndex = activeSpans.lastIndexOf(span);
                    if (activeSpanIndex !== -1) {
                        activeSpans.splice(activeSpanIndex, 1);
                    }
                    if (!shouldPersist) {
                        return;
                    }
                    enqueueDeferredSpan(activeExecution.executionId, buildPersistedSpan(metadata, span, activeExecution, (parentSpan === null || parentSpan === void 0 ? void 0 : parentSpan.executionId) || normalizeText(activeExecution.executionId), scopeKey, status, startedAt, new Date(), detail, summaryOverride));
                };
                try {
                    var result = work();
                    if (isPromiseLike(result)) {
                        return result.then(function (value) {
                            if (shouldPersist) {
                                var successDetail = enrichSuccessDetail(metadata, value);
                                var successSummary = buildSuccessSummary(metadata, successDetail);
                                finish('SUCCESS', successDetail, successSummary);
                            }
                            else {
                                finish('SUCCESS', null, normalizeText(metadata.summary));
                            }
                            return value;
                        }, function (error) {
                            var errorObject = error;
                            if (shouldPersist) {
                                finish('ERROR', __assign(__assign({}, (metadata.detail || {})), { errorName: normalizeText(errorObject.name), message: normalizeText(errorObject.message), stack: normalizeText(errorObject.stack) }), normalizeText(errorObject.message) || normalizeText(metadata.summary));
                            }
                            else {
                                finish('ERROR', null, normalizeText(errorObject.message) || normalizeText(metadata.summary));
                            }
                            throw error;
                        });
                    }
                    if (shouldPersist) {
                        var successDetail = enrichSuccessDetail(metadata, result);
                        var successSummary = buildSuccessSummary(metadata, successDetail);
                        finish('SUCCESS', successDetail, successSummary);
                    }
                    else {
                        finish('SUCCESS', null, normalizeText(metadata.summary));
                    }
                    return result;
                }
                catch (error) {
                    var errorObject = error;
                    if (shouldPersist) {
                        finish('ERROR', __assign(__assign({}, (metadata.detail || {})), { errorName: normalizeText(errorObject.name), message: normalizeText(errorObject.message), stack: normalizeText(errorObject.stack) }), normalizeText(errorObject.message) || normalizeText(metadata.summary));
                    }
                    else {
                        finish('ERROR', null, normalizeText(errorObject.message) || normalizeText(metadata.summary));
                    }
                    throw error;
                }
            },
        };
    }
});
