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
    /** Every member name an object answers: its own and inherited ones, enumerable or not. */
    function listMemberNames(source) {
        var names = new Set();
        for (var current = source; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
            for (var _i = 0, _a = Object.getOwnPropertyNames(current); _i < _a.length; _i++) {
                var name = _a[_i];
                if (name !== 'constructor') {
                    names.add(name);
                }
            }
        }
        return Array.from(names);
    }
    /** True for an export the wrapper declared for its types but left for the N module to fill. */
    function isPlaceholderExport(target, name) {
        var descriptor = Object.getOwnPropertyDescriptor(target, name);
        return Boolean(descriptor) && !descriptor.get && descriptor.value === undefined;
    }
    /**
     * Makes a wrapper module a drop-in replacement for its N module: every member the wrapper does not
     * instrument resolves to the N module's own, read on each access. Build tools swap the N module for
     * the wrapper in every file of a bundle, including code the application did not write, so a
     * member missing here would be missing for all of it.
     *
     * Forwarded: every member the N module answers (own, inherited or non-enumerable), and every
     * placeholder export the wrapper declared for its types (`export const Type = undefined as ...`),
     * even when the N module does not list it. Instrumented exports are left alone. If the N module
     * cannot be loaded yet, the placeholders are still forwarded.
     */
    function forwardModuleExports(target, getModule) {
        var names = new Set(Object.getOwnPropertyNames(target).filter(function (name) { return isPlaceholderExport(target, name); }));
        try {
            var source = getModule();
            if (source && typeof source === 'object') {
                for (var _i = 0, _a = listMemberNames(source); _i < _a.length; _i++) {
                    var name = _a[_i];
                    names.add(name);
                }
            }
        }
        catch (_error) {
            // Outside NetSuite (a test without an N/* stub) the module is not there; members read later still resolve.
        }
        var _loop_1 = function (name) {
            if (name === '__esModule' || (Object.prototype.hasOwnProperty.call(target, name) && !isPlaceholderExport(target, name))) {
                return "continue";
            }
            try {
                defineLazyExport(target, name, function () { return getModule()[name]; });
            }
            catch (_error) {
                // A member that cannot be redefined keeps whatever it had; loading the wrapper must not fail over one.
            }
        };
        for (var _b = 0, _c = Array.from(names); _b < _c.length; _b++) {
            var name = _c[_b];
            _loop_1(name);
        }
    }
});
