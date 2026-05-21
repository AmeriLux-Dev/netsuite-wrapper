define(["require", "exports", "./telemetry", "./lazy-module"], function (require, exports, telemetry_1, lazy_module_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.checkStatus = exports.create = exports.MapReduceStage = exports.ActionCondition = exports.DedupeEntityType = exports.DedupeMode = exports.MasterSelectionMode = exports.TaskStatus = exports.TaskType = void 0;
    var moduleExports = exports;
    function getNsTask() {
        return require('N/task');
    }
    exports.TaskType = undefined;
    exports.TaskStatus = undefined;
    exports.MasterSelectionMode = undefined;
    exports.DedupeMode = undefined;
    exports.DedupeEntityType = undefined;
    exports.ActionCondition = undefined;
    exports.MapReduceStage = undefined;
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'TaskType', function () { return getNsTask().TaskType; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'TaskStatus', function () { return getNsTask().TaskStatus; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'MasterSelectionMode', function () { return getNsTask().MasterSelectionMode; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'DedupeMode', function () { return getNsTask().DedupeMode; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'DedupeEntityType', function () { return getNsTask().DedupeEntityType; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'ActionCondition', function () { return getNsTask().ActionCondition; });
    (0, lazy_module_1.defineLazyExport)(moduleExports, 'MapReduceStage', function () { return getNsTask().MapReduceStage; });
    function normalizeText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }
    function getOptionValue(options, key) {
        if (!options || typeof options !== 'object') {
            return undefined;
        }
        return options[key];
    }
    function normalizeTaskParams(value) {
        if (!value || typeof value !== 'object') {
            return '';
        }
        return Object.keys(value).sort().join(',');
    }
    function buildTaskTargetKey(options) {
        var taskType = normalizeText(getOptionValue(options, 'taskType'));
        var scriptId = normalizeText(getOptionValue(options, 'scriptId'));
        var deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));
        var workflowId = normalizeText(getOptionValue(options, 'workflowId'));
        var savedSearchId = normalizeText(getOptionValue(options, 'savedSearchId'));
        if (scriptId) {
            return "".concat(taskType, ":").concat(scriptId).concat(deploymentId ? "/".concat(deploymentId) : '');
        }
        if (workflowId) {
            return "".concat(taskType, ":").concat(workflowId);
        }
        if (savedSearchId) {
            return "".concat(taskType, ":").concat(savedSearchId);
        }
        return taskType;
    }
    function buildTaskMetadata(action, summary, options) {
        return {
            module: 'task',
            action: action,
            summary: summary,
            detail: {
                targetType: 'task',
                targetKey: buildTaskTargetKey(options),
                taskType: normalizeText(getOptionValue(options, 'taskType')),
                taskId: normalizeText(getOptionValue(options, 'taskId')),
                scriptId: normalizeText(getOptionValue(options, 'scriptId')),
                deploymentId: normalizeText(getOptionValue(options, 'deploymentId')),
                recordType: normalizeText(getOptionValue(options, 'recordType')),
                workflowId: normalizeText(getOptionValue(options, 'workflowId')),
                savedSearchId: normalizeText(getOptionValue(options, 'savedSearchId')),
                fileId: normalizeText(getOptionValue(options, 'fileId')),
                filePath: normalizeText(getOptionValue(options, 'filePath')),
                paramKeys: normalizeTaskParams(getOptionValue(options, 'params')),
            },
        };
    }
    function createTaskSubmitMetadata(options) {
        var taskType = normalizeText(getOptionValue(options, 'taskType')) || 'NetSuite';
        var scriptId = normalizeText(getOptionValue(options, 'scriptId'));
        var deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));
        var summarySuffix = scriptId ? " ".concat(scriptId).concat(deploymentId ? "/".concat(deploymentId) : '') : '';
        return buildTaskMetadata('submit', "Submit ".concat(taskType, " task").concat(summarySuffix), options);
    }
    function instrumentTaskInstance(taskInstance, createOptions) {
        if (typeof taskInstance.submit === 'function') {
            var originalSubmit_1 = taskInstance.submit.bind(taskInstance);
            taskInstance.submit = function () { return (0, telemetry_1.runWrappedOperation)(createTaskSubmitMetadata(createOptions), function () { return originalSubmit_1(); }); };
        }
        if (typeof taskInstance.addInboundDependency === 'function') {
            var originalAddInboundDependency_1 = taskInstance.addInboundDependency.bind(taskInstance);
            taskInstance.addInboundDependency = function () {
                var args = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    args[_i] = arguments[_i];
                }
                return (0, telemetry_1.runWrappedOperation)(buildTaskMetadata('addInboundDependency', 'Add task inbound dependency', {
                    taskType: getOptionValue(createOptions, 'taskType'),
                    dependencyTaskType: getOptionValue(args[0], 'taskType'),
                    scriptId: getOptionValue(args[0], 'scriptId'),
                    deploymentId: getOptionValue(args[0], 'deploymentId'),
                    params: getOptionValue(args[0], 'params'),
                }), function () { return originalAddInboundDependency_1.apply(void 0, args); });
            };
        }
        return taskInstance;
    }
    exports.create = (function (options) { return (0, telemetry_1.runWrappedOperation)(buildTaskMetadata('create', "Create ".concat(normalizeText(getOptionValue(options, 'taskType')) || 'NetSuite', " task"), options), function () { return instrumentTaskInstance(getNsTask().create(options), options); }); });
    exports.checkStatus = (function (options) { return (0, telemetry_1.runWrappedOperation)(buildTaskMetadata('checkStatus', 'Check NetSuite task status', options), function () { return getNsTask().checkStatus(options); }); });
});
