// The default exporter: one `customrecord_ptrk_exec_span` record per span, the schema the
// PerformanceTracker NetSuite app reads. Log entries are not stored here; the app has no place for them.
define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EXECUTION_FIELDS = exports.EXECUTION_RECORD_TYPE = exports.NETSUITE_RECORD_EXPORTER_NAME = void 0;
    exports.persistSpanRecord = persistSpanRecord;
    exports.createNetSuiteRecordExporter = createNetSuiteRecordExporter;
    exports.NETSUITE_RECORD_EXPORTER_NAME = 'netsuite-record';
    exports.EXECUTION_RECORD_TYPE = 'customrecord_ptrk_exec_span';
    exports.EXECUTION_FIELDS = {
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
    function getNsLog() {
        return require('N/log');
    }
    function getNsRecord() {
        return require('N/record');
    }
    function persistSpanRecord(span) {
        try {
            var spanRecord = getNsRecord().create({
                type: exports.EXECUTION_RECORD_TYPE,
                isDynamic: false,
            });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.executionId, value: span.executionId });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.flowId, value: span.flowId });
            if (span.parentExecutionId) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.parentExecutionId, value: span.parentExecutionId });
            }
            if (span.rootExecutionId) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.rootExecutionId, value: span.rootExecutionId });
            }
            if (span.spanRole) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.spanRole, value: span.spanRole });
            }
            if (span.entryKind) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.entryKind, value: span.entryKind });
            }
            if (span.entryKey) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.entryKey, value: span.entryKey });
            }
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.scriptId, value: span.scriptId });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.scriptName, value: span.scriptName });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.scriptType, value: span.scriptType });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.deploymentId, value: span.deploymentId });
            if (span.scopeKey) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.scopeKey, value: span.scopeKey });
            }
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.stage, value: span.stage });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.operation, value: span.operation });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.transactionType, value: span.transactionType });
            if (span.transactionId !== undefined) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.transactionId, value: span.transactionId });
            }
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.startedAt, value: span.startedAt });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.endedAt, value: span.endedAt });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.durationMs, value: span.durationMs });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.status, value: span.status });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.context, value: span.context });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.summary, value: span.summary });
            spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.detail, value: span.detail });
            if (span.functionName) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.functionName, value: span.functionName });
            }
            if (span.functionModulePath) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.functionModulePath, value: span.functionModulePath });
            }
            if (span.callChain) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.callChain, value: span.callChain });
            }
            if (span.wrapperModule) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.wrapperModule, value: span.wrapperModule });
            }
            if (span.wrapperAction) {
                spanRecord.setValue({ fieldId: exports.EXECUTION_FIELDS.wrapperAction, value: span.wrapperAction });
            }
            spanRecord.save({ enableSourcing: false, ignoreMandatoryFields: true });
        }
        catch (error) {
            getNsLog().error({ title: 'netsuite-wrapper PerformanceTracker telemetry save failed', details: String(error) });
        }
    }
    function createNetSuiteRecordExporter() {
        return {
            name: exports.NETSUITE_RECORD_EXPORTER_NAME,
            acceptsLogEntries: false,
            export: function (batch) {
                batch.spans.forEach(persistSpanRecord);
            },
        };
    }
});
