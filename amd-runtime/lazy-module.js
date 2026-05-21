define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.defineLazyExport = defineLazyExport;
    function defineLazyExport(target, exportName, getter) {
        Object.defineProperty(target, exportName, {
            enumerable: true,
            configurable: true,
            get: getter,
        });
    }
});
