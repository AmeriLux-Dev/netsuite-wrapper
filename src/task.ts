import type * as NsTask from 'N/task';
import { runWrappedOperation } from './telemetry';
import { defineLazyExport } from './lazy-module';

declare const require: <T = unknown>(moduleName: string) => T;
declare const exports: Record<string, unknown>;

const moduleExports = exports;

function getNsTask(): typeof import('N/task') {
    return require<typeof import('N/task')>('N/task');
}

export const TaskType = undefined as unknown as typeof NsTask.TaskType;
export const TaskStatus = undefined as unknown as typeof NsTask.TaskStatus;
export const MasterSelectionMode = undefined as unknown as typeof NsTask.MasterSelectionMode;
export const DedupeMode = undefined as unknown as typeof NsTask.DedupeMode;
export const DedupeEntityType = undefined as unknown as typeof NsTask.DedupeEntityType;
export const ActionCondition = undefined as unknown as typeof NsTask.ActionCondition;
export const MapReduceStage = undefined as unknown as typeof NsTask.MapReduceStage;
defineLazyExport(moduleExports, 'TaskType', () => getNsTask().TaskType);
defineLazyExport(moduleExports, 'TaskStatus', () => getNsTask().TaskStatus);
defineLazyExport(moduleExports, 'MasterSelectionMode', () => getNsTask().MasterSelectionMode);
defineLazyExport(moduleExports, 'DedupeMode', () => getNsTask().DedupeMode);
defineLazyExport(moduleExports, 'DedupeEntityType', () => getNsTask().DedupeEntityType);
defineLazyExport(moduleExports, 'ActionCondition', () => getNsTask().ActionCondition);
defineLazyExport(moduleExports, 'MapReduceStage', () => getNsTask().MapReduceStage);

type TaskInstance = {
    submit?: () => string;
    addInboundDependency?: (...args: any[]) => unknown;
};

function normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function getOptionValue(options: unknown, key: string): unknown {
    if (!options || typeof options !== 'object') {
        return undefined;
    }

    return (options as Record<string, unknown>)[key];
}

function normalizeTaskParams(value: unknown): string {
    if (!value || typeof value !== 'object') {
        return '';
    }

    return Object.keys(value as Record<string, unknown>).sort().join(',');
}

function buildTaskTargetKey(options: unknown): string {
    const taskType = normalizeText(getOptionValue(options, 'taskType'));
    const scriptId = normalizeText(getOptionValue(options, 'scriptId'));
    const deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));
    const workflowId = normalizeText(getOptionValue(options, 'workflowId'));
    const savedSearchId = normalizeText(getOptionValue(options, 'savedSearchId'));

    if (scriptId) {
        return `${taskType}:${scriptId}${deploymentId ? `/${deploymentId}` : ''}`;
    }

    if (workflowId) {
        return `${taskType}:${workflowId}`;
    }

    if (savedSearchId) {
        return `${taskType}:${savedSearchId}`;
    }

    return taskType;
}

function buildTaskMetadata(action: string, summary: string, options: unknown) {
    return {
        module: 'task',
        action,
        summary,
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
    } as const;
}

function createTaskSubmitMetadata(options: unknown) {
    const taskType = normalizeText(getOptionValue(options, 'taskType')) || 'NetSuite';
    const scriptId = normalizeText(getOptionValue(options, 'scriptId'));
    const deploymentId = normalizeText(getOptionValue(options, 'deploymentId'));
    const summarySuffix = scriptId ? ` ${scriptId}${deploymentId ? `/${deploymentId}` : ''}` : '';
    return buildTaskMetadata('submit', `Submit ${taskType} task${summarySuffix}`, options);
}

function instrumentTaskInstance<T extends TaskInstance>(taskInstance: T, createOptions: unknown): T {
    if (typeof taskInstance.submit === 'function') {
        const originalSubmit = taskInstance.submit.bind(taskInstance);
        taskInstance.submit = () => runWrappedOperation(() => createTaskSubmitMetadata(createOptions), () => originalSubmit());
    }

    if (typeof taskInstance.addInboundDependency === 'function') {
        const originalAddInboundDependency = taskInstance.addInboundDependency.bind(taskInstance) as (...args: any[]) => unknown;
        taskInstance.addInboundDependency = (...args: any[]) => runWrappedOperation(() => buildTaskMetadata('addInboundDependency', 'Add task inbound dependency', {
            taskType: getOptionValue(createOptions, 'taskType'),
            dependencyTaskType: getOptionValue(args[0], 'taskType'),
            scriptId: getOptionValue(args[0], 'scriptId'),
            deploymentId: getOptionValue(args[0], 'deploymentId'),
            params: getOptionValue(args[0], 'params'),
        }), () => originalAddInboundDependency(...args)) as typeof taskInstance.addInboundDependency;
    }

    return taskInstance;
}

export const create = ((options: Parameters<typeof NsTask.create>[0]) => runWrappedOperation(() => buildTaskMetadata('create', `Create ${normalizeText(getOptionValue(options, 'taskType')) || 'NetSuite'} task`, options), () => instrumentTaskInstance(getNsTask().create(options), options))) as typeof NsTask.create;

export const checkStatus = ((options: Parameters<typeof NsTask.checkStatus>[0]) => runWrappedOperation(() => buildTaskMetadata('checkStatus', 'Check NetSuite task status', options), () => getNsTask().checkStatus(options))) as typeof NsTask.checkStatus;