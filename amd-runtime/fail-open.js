define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.reportWrapperFailure = reportWrapperFailure;
    exports.instrumentReturnedObject = instrumentReturnedObject;
    exports.observe = observe;
    var reportedFailure = false;
    function isPromiseLike(value) {
        return Boolean(value) && typeof value.then === 'function';
    }
    /**
     * Tells N/log that the wrapper stepped aside, once per loaded script: a broken wrapper stays visible
     * without flooding the execution log, and reporting can never fail the caller.
     */
    function reportWrapperFailure(stage, error) {
        if (reportedFailure) {
            return;
        }
        reportedFailure = true;
        try {
            require('N/log').error({
                title: 'netsuite-wrapper stepped aside',
                details: JSON.stringify({ stage: stage, message: error instanceof Error ? error.message : String(error) }),
            });
        }
        catch (_logError) {
            // Nothing left to report to.
        }
    }
    /**
     * Swaps instrumented methods onto an object an N/* call returned (a record's save, a query's run).
     * If NetSuite's object refuses the change, for example because the method is read-only, the object
     * comes back as NetSuite made it: a method already swapped stays swapped, the rest stay native.
     */
    function instrumentReturnedObject(target, instrument) {
        try {
            return instrument(target);
        }
        catch (error) {
            reportWrapperFailure('instrument', error);
            return target;
        }
    }
    /**
     * Runs the application's `work` under an observer (a telemetry sink, a tracked run, a function
     * context), so that nothing the observer does can change what the application sees:
     *
     * - `work` runs exactly once.
     * - The caller gets exactly what `work` gave: its return value (the same promise, when it returns
     *   one) or the error it threw.
     * - An observer that throws before running `work`, returns without running it, or throws after it,
     *   is reported and ignored.
     *
     * The observer receives a stand-in for `work` and must call it at most once.
     */
    function observe(work, observer) {
        var outcome;
        var observedWork = function () {
            if (outcome) {
                throw new Error('netsuite-wrapper ran the same operation twice.');
            }
            try {
                var result = work();
                outcome = { result: result };
                return result;
            }
            catch (error) {
                outcome = { error: error };
                throw error;
            }
        };
        var observerResult;
        try {
            observerResult = observer(observedWork);
        }
        catch (observerError) {
            if (!outcome) {
                reportWrapperFailure('before', observerError);
                return work();
            }
            if (!('error' in outcome) || observerError !== outcome.error) {
                reportWrapperFailure('after', observerError);
            }
        }
        if (!outcome) {
            reportWrapperFailure('skipped', new Error('the observer returned without running the operation'));
            return work();
        }
        if ('error' in outcome) {
            throw outcome.error;
        }
        // The observer chains its own bookkeeping onto a returned promise. The application keeps the
        // original promise, so a failure in that chain has to be handled here or it would surface as
        // an unhandled rejection.
        if (observerResult !== outcome.result && isPromiseLike(observerResult)) {
            observerResult.then(undefined, function () { return undefined; });
        }
        return outcome.result;
    }
});
