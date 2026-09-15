// Turns an arbitrary runtime value (function arguments, thrown values) into a small, JSON-safe
// picture of itself. Serialization is the expensive and risky part of capturing arguments: NetSuite
// records and search results are large and circular, strings can be huge, and a field caps out at
// ~4000 characters. Every limit below exists so a snapshot stays cheap and bounded.
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
define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.snapshotValue = snapshotValue;
    exports.snapshotFunctionArguments = snapshotFunctionArguments;
    var DEFAULT_SNAPSHOT_OPTIONS = {
        maxDepth: 2,
        maxStringLength: 200,
        maxArrayLength: 5,
        maxObjectKeys: 20,
        maxTotalLength: 2000,
    };
    function resolveOptions(options) {
        return __assign(__assign({}, DEFAULT_SNAPSHOT_OPTIONS), (options || {}));
    }
    function truncateString(value, maxLength) {
        if (value.length <= maxLength) {
            return value;
        }
        return "".concat(value.slice(0, maxLength), "\u2026 (+").concat(value.length - maxLength, " chars)");
    }
    function isNetSuiteRecordLike(value) {
        return typeof value.getValue === 'function';
    }
    function snapshotNetSuiteRecordLike(value) {
        var recordType = value.type !== undefined ? value.type : value.recordType;
        return {
            recordType: recordType === undefined || recordType === null ? '' : String(recordType),
            id: value.id === undefined || value.id === null ? null : value.id,
        };
    }
    function snapshotValueAtDepth(value, depth, options, seen) {
        if (value === null || value === undefined) {
            return null;
        }
        switch (typeof value) {
            case 'string':
                return truncateString(value, options.maxStringLength);
            case 'number':
                return Number.isFinite(value) ? value : String(value);
            case 'boolean':
                return value;
            case 'bigint':
                return "".concat(value.toString(), "n");
            case 'symbol':
                return value.toString();
            case 'function':
                return "[function ".concat(value.name || 'anonymous', "]");
            default:
                break;
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? '[invalid date]' : value.toISOString();
        }
        if (value instanceof Error) {
            return {
                errorName: value.name,
                message: truncateString(value.message, options.maxStringLength),
            };
        }
        var objectValue = value;
        if (isNetSuiteRecordLike(objectValue)) {
            return snapshotNetSuiteRecordLike(objectValue);
        }
        if (seen.has(objectValue)) {
            return '[circular]';
        }
        if (Array.isArray(objectValue)) {
            if (depth >= options.maxDepth) {
                return "[array ".concat(objectValue.length, "]");
            }
            seen.add(objectValue);
            var items = objectValue.slice(0, options.maxArrayLength).map(function (item) { return snapshotValueAtDepth(item, depth + 1, options, seen); });
            seen.delete(objectValue);
            if (objectValue.length > options.maxArrayLength) {
                items.push("\u2026 ".concat(objectValue.length - options.maxArrayLength, " more"));
            }
            return items;
        }
        if (depth >= options.maxDepth) {
            return '[object]';
        }
        seen.add(objectValue);
        var snapshot = {};
        var keys = Object.keys(objectValue);
        keys.slice(0, options.maxObjectKeys).forEach(function (key) {
            snapshot[key] = snapshotValueAtDepth(objectValue[key], depth + 1, options, seen);
        });
        seen.delete(objectValue);
        if (keys.length > options.maxObjectKeys) {
            snapshot['…'] = "".concat(keys.length - options.maxObjectKeys, " more keys");
        }
        return snapshot;
    }
    function measureJson(value) {
        try {
            var json = JSON.stringify(value);
            return typeof json === 'string' ? json.length : 0;
        }
        catch (_error) {
            return Number.POSITIVE_INFINITY;
        }
    }
    function tightenOptions(options) {
        return __assign(__assign({}, options), { maxDepth: Math.max(1, options.maxDepth - 1), maxStringLength: Math.max(40, Math.floor(options.maxStringLength / 2)), maxArrayLength: Math.max(2, Math.floor(options.maxArrayLength / 2)), maxObjectKeys: Math.max(5, Math.floor(options.maxObjectKeys / 2)) });
    }
    /**
     * A bounded, JSON-safe picture of `value`. Strings are cut, arrays and objects are trimmed to a few
     * entries and a couple of levels, NetSuite records collapse to `{ recordType, id }`, circular
     * references become a marker. When the result is still larger than `maxTotalLength` the limits are
     * halved and the value re-snapshotted, so the output size is predictable whatever goes in.
     */
    function snapshotValue(value, options) {
        var currentOptions = resolveOptions(options);
        var snapshot = snapshotValueAtDepth(value, 0, currentOptions, new Set());
        for (var attempt = 0; attempt < 3 && measureJson(snapshot) > currentOptions.maxTotalLength; attempt += 1) {
            currentOptions = tightenOptions(currentOptions);
            snapshot = snapshotValueAtDepth(value, 0, currentOptions, new Set());
        }
        if (measureJson(snapshot) > currentOptions.maxTotalLength) {
            return "[value too large: ".concat(measureJson(snapshot), " chars]");
        }
        return snapshot;
    }
    /**
     * Snapshots a function's arguments by parameter name: `{ id: 12, options: { … } }`. A parameter
     * the build could not name (a destructured pattern) is reported as `arg<index>`.
     */
    function snapshotFunctionArguments(parameterNames, argumentValues, options) {
        var named = {};
        var count = Math.max(parameterNames.length, argumentValues.length);
        for (var index = 0; index < count; index += 1) {
            var parameterName = parameterNames[index] || "arg".concat(index);
            named[parameterName] = argumentValues[index];
        }
        var snapshot = snapshotValue(named, options);
        return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
            ? snapshot
            : { '…': snapshot };
    }
});
