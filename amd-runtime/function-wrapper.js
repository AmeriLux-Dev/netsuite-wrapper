define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wrapFunction = wrapFunction;
    function wrapFunction(sync, async) {
        return Object.assign(sync, async ? { promise: async } : {});
    }
});
