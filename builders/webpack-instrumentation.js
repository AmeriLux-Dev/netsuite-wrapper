const path = require('path');
const {
    applyNetSuiteWrapperWebpack,
    createNetSuiteWrapperInstrumentationRule,
} = require('./webpack');

function applyNetSuiteWrapperInstrumentationWebpack(config, options = {}) {
    return applyNetSuiteWrapperWebpack(config, options);
}

module.exports = {
    applyNetSuiteWrapperInstrumentationWebpack,
    createNetSuiteWrapperInstrumentationRule,
};