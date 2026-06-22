define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.defineLazyExport = defineLazyExport;
    exports.forwardModuleExports = forwardModuleExports;
    function defineLazyExport(target, exportName, getter) {
        Object.defineProperty(target, exportName, {
            enumerable: true,
            configurable: true,
            get: getter,
        });
    }
    /**
     * Forwards every member of the underlying NetSuite module that the wrapper does not already
     * instrument, so the wrapper behaves like a drop-in replacement. Members the wrapper defines
     * itself (the instrumented exports) are left untouched; everything else resolves lazily to the
     * real module on each access.
     */
    function forwardModuleExports(target, getModule) {
        var source = getModule();
        if (!source || typeof source !== 'object') {
            return;
        }
        var _loop_1 = function (key) {
            if (Object.prototype.hasOwnProperty.call(target, key)) {
                return "continue";
            }
            defineLazyExport(target, key, function () { return getModule()[key]; });
        };
        for (var _i = 0, _a = Object.keys(source); _i < _a.length; _i++) {
            var key = _a[_i];
            _loop_1(key);
        }
    }
});
