const path = require('path');
const { transformSync } = require('@babel/core');
const { DEFAULT_PACKAGE_NAME } = require('./build-support');

const IGNORE_TAG = '@ptrk-ignore';
const IGNORE_OBSERVED_FUNCTIONS_TAG = '@ptrk-ignore-observed-functions';
// On a function: its arguments are never captured (not on a log call, not on an error). At the top of a
// file: applies to every function in it. For functions that receive credentials or personal data.
const IGNORE_ARGUMENTS_TAG = '@ptrk-ignore-arguments';
const PFTR_SCOPE_KEY_TAG = '@pftr:scopeKey';
const NETSUITE_SCRIPT_TYPE_TAG = '@NScriptType';
const FUNCTION_CONTEXT_EXPORT = 'withFunctionContext';
const SCRIPT_ENTRY_EXPORT = 'runTrackedScriptEntry';
const SCRIPT_ENTRY_FUNCTION_EXPORT = 'wrapTrackedScriptEntryFunction';
const DEFAULT_INSTRUMENTATION_SOURCE = 'webpack-babel-auto';
const DEFAULT_MODULE_FORMAT = 'esm';

function normalizeSlashes(value) {
    return value.replace(/\\/g, '/');
}

function stripExtension(value) {
    return value.replace(/\.[^.]+$/, '');
}

function toImportSpecifier(resourcePath, modulePath) {
    const relativePath = normalizeSlashes(path.relative(path.dirname(resourcePath), modulePath));
    const extensionlessPath = stripExtension(relativePath);
    return extensionlessPath.startsWith('.') ? extensionlessPath : `./${extensionlessPath}`;
}

function normalizeRelativePath(rootContext, resourcePath) {
    if (!rootContext) {
        return normalizeSlashes(resourcePath);
    }

    const relativePath = path.relative(rootContext, resourcePath);
    if (!relativePath || relativePath.startsWith('..')) {
        return normalizeSlashes(resourcePath);
    }

    return normalizeSlashes(relativePath);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commentContainsAnnotationTag(commentValue, annotationTag) {
    if (typeof commentValue !== 'string' || !annotationTag) {
        return false;
    }

    const annotationPattern = new RegExp(`(^|[^\\w-])${escapeRegExp(annotationTag)}(?=\\s|$)`);
    return annotationPattern.test(commentValue);
}

function hasAnnotationTagInComments(comments, annotationTag) {
    return Array.isArray(comments) && comments.some((comment) => commentContainsAnnotationTag(comment.value, annotationTag));
}

function hasIgnoreTagInComments(comments) {
    return hasAnnotationTagInComments(comments, IGNORE_TAG);
}

// Whole-tag match: `@ptrk-ignore-arguments` and `@ptrk-ignore-observed-functions` at the top of a
// file must not read as `@ptrk-ignore` and skip the file.
function hasLeadingIgnorePragma(source) {
    const leadingCommentMatch = source.match(/^\s*((?:\/\*[\s\S]*?\*\/\s*|\/\/[^\r\n]*\r?\n\s*)+)/);
    return Boolean(leadingCommentMatch && commentContainsAnnotationTag(leadingCommentMatch[1], IGNORE_TAG));
}

function getLeadingCommentText(source) {
    const leadingCommentMatch = source.match(/^\s*((?:\/\*[\s\S]*?\*\/\s*|\/\/[^\r\n]*\r?\n\s*)+)/);
    return leadingCommentMatch ? leadingCommentMatch[1] : '';
}

function getAnnotationValue(commentText, annotationTag) {
    if (!commentText) {
        return '';
    }

    const annotationPattern = new RegExp(`${annotationTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+([^\r\n*]+)`);
    const annotationMatch = commentText.match(annotationPattern);
    return annotationMatch ? annotationMatch[1].trim() : '';
}

function normalizeScriptEntryKind(scriptType) {
    switch (String(scriptType || '').trim().toLowerCase()) {
        case 'restlet':
            return 'restlet';
        case 'suitelet':
            return 'suitelet';
        case 'mapreducescript':
            return 'mapreduce';
        case 'usereventscript':
            return 'userevent';
        default:
            return '';
    }
}

// A file is a tracked script when its header names a scope key, or when the build supplies a default
// one and the header carries a supported @NScriptType. The header tag always wins over the default.
function parseTrackedScriptOptions(source, defaultScopeKey = '') {
    const leadingCommentText = getLeadingCommentText(source);
    const scopeKey = getAnnotationValue(leadingCommentText, PFTR_SCOPE_KEY_TAG)
        || (typeof defaultScopeKey === 'string' ? defaultScopeKey.trim() : '');
    if (!scopeKey) {
        return null;
    }

    const scriptType = getAnnotationValue(leadingCommentText, NETSUITE_SCRIPT_TYPE_TAG);
    const entryKind = normalizeScriptEntryKind(scriptType);
    if (!entryKind) {
        return null;
    }

    return {
        scopeKey,
        scriptType,
        entryKind,
    };
}

function getKeyName(node, types) {
    if (!node || node.computed) {
        return '';
    }

    if (types.isIdentifier(node.key)) {
        return node.key.name;
    }

    if (types.isStringLiteral(node.key) || types.isNumericLiteral(node.key)) {
        return String(node.key.value);
    }

    return '';
}

function getClassName(pathNode, types) {
    const classPath = pathNode.findParent((candidatePath) => candidatePath.isClassDeclaration() || candidatePath.isClassExpression());
    if (!classPath) {
        return '';
    }

    if (classPath.node.id && types.isIdentifier(classPath.node.id)) {
        return classPath.node.id.name;
    }

    if (classPath.parentPath && classPath.parentPath.isVariableDeclarator() && types.isIdentifier(classPath.parentPath.node.id)) {
        return classPath.parentPath.node.id.name;
    }

    return '';
}

function getObjectOwnerName(pathNode, types) {
    const objectExpressionPath = pathNode.findParent((candidatePath) => candidatePath.isObjectExpression());
    if (!objectExpressionPath || !objectExpressionPath.parentPath) {
        return '';
    }

    if (objectExpressionPath.parentPath.isVariableDeclarator() && types.isIdentifier(objectExpressionPath.parentPath.node.id)) {
        return objectExpressionPath.parentPath.node.id.name;
    }

    if (objectExpressionPath.parentPath.isAssignmentExpression()) {
        const left = objectExpressionPath.parentPath.node.left;
        if (types.isIdentifier(left)) {
            return left.name;
        }
        if (types.isMemberExpression(left) && !left.computed && types.isIdentifier(left.object) && types.isIdentifier(left.property)) {
            return `${left.object.name}.${left.property.name}`;
        }
    }

    return '';
}

function getIgnoreCommentNodes(pathNode) {
    const candidates = [pathNode.node];

    if (pathNode.parentPath) {
        candidates.push(pathNode.parentPath.node);
    }

    if (pathNode.parentPath && pathNode.parentPath.parentPath) {
        candidates.push(pathNode.parentPath.parentPath.node);
    }

    if (pathNode.isVariableDeclarator() && pathNode.node.init) {
        candidates.push(pathNode.node.init);
    }

    return candidates.filter(Boolean);
}

function getObservedFunctionsAnnotationNodes(pathNode) {
    const candidates = [pathNode.node];

    if (pathNode.parentPath && pathNode.parentPath.isExportNamedDeclaration()) {
        candidates.push(pathNode.parentPath.node);
    }

    if (pathNode.isVariableDeclarator()) {
        if (pathNode.node.init) {
            candidates.push(pathNode.node.init);
        }
        if (pathNode.parentPath && pathNode.parentPath.parentPath && pathNode.parentPath.parentPath.isExportNamedDeclaration()) {
            candidates.push(pathNode.parentPath.parentPath.node);
        }
    }

    if ((pathNode.isArrowFunctionExpression() || pathNode.isFunctionExpression()) && pathNode.parentPath && pathNode.parentPath.isVariableDeclarator()) {
        candidates.push(pathNode.parentPath.node);
        if (pathNode.parentPath.parentPath && pathNode.parentPath.parentPath.parentPath && pathNode.parentPath.parentPath.parentPath.isExportNamedDeclaration()) {
            candidates.push(pathNode.parentPath.parentPath.parentPath.node);
        }
    }

    if (pathNode.isObjectMethod() || pathNode.isObjectProperty()) {
        candidates.push(pathNode.parentPath && pathNode.parentPath.node);
    }

    return candidates.filter(Boolean);
}

function hasLeadingIgnoreComment(pathNode) {
    return getIgnoreCommentNodes(pathNode).some((node) => hasIgnoreTagInComments(node.leadingComments));
}

function hasLeadingAnnotationComment(pathNode, annotationTag) {
    return getObservedFunctionsAnnotationNodes(pathNode).some((node) => hasAnnotationTagInComments(node.leadingComments, annotationTag));
}

function createMetadataExpression(types, metadata) {
    const properties = Object.entries(metadata)
        .flatMap(([key, value]) => {
            if (typeof value === 'string' && value) {
                return [types.objectProperty(types.identifier(key), types.stringLiteral(value))];
            }

            if (typeof value === 'boolean' && value) {
                return [types.objectProperty(types.identifier(key), types.booleanLiteral(value))];
            }

            if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
                return [types.objectProperty(types.identifier(key), types.arrayExpression(value.map((item) => types.stringLiteral(item))))];
            }

            return [];
        });

    return types.objectExpression(properties);
}

// The names and value references of a function's parameters, so the wrapped body can hand
// `[a, b, rest]` to the helper at no cost beyond building the array. A destructured parameter has
// no single binding to reference; it is named arg<index> and its value is left out.
function describeFunctionParameters(types, params) {
    const parameterNames = [];
    const argumentExpressions = [];

    (params || []).forEach((param, index) => {
        let target = param;
        if (types.isTSParameterProperty(target)) {
            target = target.parameter;
        }
        if (types.isAssignmentPattern(target)) {
            target = target.left;
        }
        if (types.isRestElement(target)) {
            target = target.argument;
        }

        if (types.isIdentifier(target)) {
            parameterNames.push(target.name);
            argumentExpressions.push(types.identifier(target.name));
            return;
        }

        parameterNames.push(`arg${index}`);
        argumentExpressions.push(types.unaryExpression('void', types.numericLiteral(0)));
    });

    return { parameterNames, argumentExpressions };
}

function createWrappedBody(types, helperId, originalBody, metadata, isAsync, argumentExpressions) {
    const callbackBody = types.isBlockStatement(originalBody)
        ? originalBody
        : types.blockStatement([types.returnStatement(originalBody)]);

    const helperArguments = [
        createMetadataExpression(types, metadata),
        types.arrowFunctionExpression([], callbackBody, isAsync),
    ];
    if (argumentExpressions && argumentExpressions.length > 0) {
        helperArguments.push(types.arrayExpression(argumentExpressions));
    }

    return types.blockStatement([
        types.returnStatement(
            types.callExpression(types.cloneNode(helperId), helperArguments),
        ),
    ]);
}

function createTrackedScriptWrappedBody(types, helperId, originalBody, metadata, isAsync) {
    const callbackBody = types.isBlockStatement(originalBody)
        ? originalBody
        : types.blockStatement([types.returnStatement(originalBody)]);

    return types.blockStatement([
        types.returnStatement(
            types.callExpression(types.cloneNode(helperId), [
                createMetadataExpression(types, metadata),
                types.arrowFunctionExpression([], callbackBody, isAsync),
            ]),
        ),
    ]);
}

function getAmdDefineFactory(programPath, types) {
    for (const statementPath of programPath.get('body')) {
        if (!statementPath.isExpressionStatement()) {
            continue;
        }

        const expressionPath = statementPath.get('expression');
        if (!expressionPath.isCallExpression()) {
            continue;
        }

        const calleePath = expressionPath.get('callee');
        if (!calleePath.isIdentifier({ name: 'define' })) {
            continue;
        }

        const argumentPaths = expressionPath.get('arguments');
        if (argumentPaths.length < 2) {
            continue;
        }

        const dependenciesPath = argumentPaths[0];
        const factoryPath = argumentPaths[1];
        if (!dependenciesPath.isArrayExpression()) {
            continue;
        }

        if (!factoryPath.isFunctionExpression() && !factoryPath.isArrowFunctionExpression()) {
            continue;
        }

        return {
            dependenciesPath,
            factoryPath,
        };
    }

    return null;
}

function ensureAmdHelperBinding(programPath, types, moduleId, exportName, moduleParamId, helperId) {
    const amdFactory = getAmdDefineFactory(programPath, types);
    if (!amdFactory) {
        throw new Error('Unable to instrument non-AMD output in AMD module mode. Make sure the TypeScript output uses module: "amd".');
    }

    const dependencyElements = amdFactory.dependenciesPath.get('elements');
    let dependencyIndex = dependencyElements.findIndex((elementPath) => (
        elementPath.isStringLiteral() && elementPath.node.value === moduleId
    ));

    if (dependencyIndex < 0) {
        amdFactory.dependenciesPath.pushContainer('elements', types.stringLiteral(moduleId));
        amdFactory.factoryPath.pushContainer('params', types.cloneNode(moduleParamId));
        dependencyIndex = amdFactory.dependenciesPath.node.elements.length - 1;
    }

    const moduleParamNode = amdFactory.factoryPath.node.params[dependencyIndex];
    if (!moduleParamNode || !types.isIdentifier(moduleParamNode)) {
        throw new Error(`Unable to bind AMD dependency for ${moduleId}. Expected a factory parameter identifier.`);
    }

    amdFactory.factoryPath.get('body').node.body.unshift(
        types.variableDeclaration('var', [
            types.variableDeclarator(
                types.cloneNode(helperId),
                types.memberExpression(types.cloneNode(moduleParamNode), types.identifier(exportName)),
            ),
        ]),
    );
}

function createInstrumentationPlugin() {
    return function instrumentationPlugin(babel) {
        const { types } = babel;

        function instrumentFunctionBody(pathNode, state, metadata) {
            const body = pathNode.node.body;
            if (!body) {
                return;
            }

            const captureArguments = !metadata.excludeArguments;
            const parameters = captureArguments
                ? describeFunctionParameters(types, pathNode.node.params)
                : { parameterNames: [], argumentExpressions: [] };
            const { excludeArguments, ...helperMetadata } = metadata;
            pathNode.node.body = createWrappedBody(
                types,
                state.helperId,
                body,
                { ...helperMetadata, parameterNames: parameters.parameterNames },
                Boolean(pathNode.node.async),
                parameters.argumentExpressions,
            );
            if (pathNode.isArrowFunctionExpression()) {
                pathNode.node.expression = false;
            }
            state.instrumentedCount += 1;
        }

        function wrapTrackedScriptEntry(pathNode, state, metadata) {
            const body = pathNode.node.body;
            if (!body || !state.trackedScriptEntryHelperId) {
                return;
            }

            pathNode.node.body = createTrackedScriptWrappedBody(types, state.trackedScriptEntryHelperId, body, metadata, Boolean(pathNode.node.async));
            if (pathNode.isArrowFunctionExpression()) {
                pathNode.node.expression = false;
            }
            state.trackedScriptCount += 1;
        }

        // `export const post = defineRestlet(...)` (or tsc's `exports.post = (0, x.defineRestlet)(...)`):
        // the entry point is whatever the call returned, so the returned function is wrapped instead of a body.
        function wrapTrackedScriptEntryCallResult(expressionPath, state, metadata) {
            if (!state.trackedScriptEntryFunctionHelperId || !expressionPath.isCallExpression()) {
                return;
            }

            expressionPath.replaceWith(types.callExpression(types.cloneNode(state.trackedScriptEntryFunctionHelperId), [
                createMetadataExpression(types, metadata),
                expressionPath.node,
            ]));
            state.trackedScriptFunctionCount += 1;
        }

        function shouldExcludeArguments(pathNode, state) {
            return Boolean(state.excludeArgumentsByDefault || hasLeadingAnnotationComment(pathNode, IGNORE_ARGUMENTS_TAG));
        }

        function createBaseMetadata(state, functionName, functionContext) {
            return {
                functionName,
                functionContext,
                filePath: state.filePath,
                modulePath: state.modulePath,
                instrumentationSource: state.instrumentationSource,
            };
        }

        function shouldExcludeObservedFunctions(pathNode, state) {
            return Boolean(state.excludeObservedFunctionsByDefault || hasLeadingAnnotationComment(pathNode, IGNORE_OBSERVED_FUNCTIONS_TAG));
        }

        function isExportedFunctionPath(pathNode) {
            if (pathNode.parentPath && pathNode.parentPath.isExportNamedDeclaration()) {
                return true;
            }

            return Boolean(
                pathNode.parentPath
                && pathNode.parentPath.parentPath
                && pathNode.parentPath.parentPath.isExportNamedDeclaration(),
            );
        }

        function collectAmdExportedNames(programPath) {
            const names = new Set();
            programPath.traverse({
                AssignmentExpression(assignmentPath) {
                    const left = assignmentPath.node.left;
                    if (types.isMemberExpression(left)
                        && !left.computed
                        && types.isIdentifier(left.object, { name: 'exports' })
                        && types.isIdentifier(left.property)) {
                        names.add(left.property.name);
                    }
                },
            });
            return names;
        }

        // Compiled AMD/CommonJS output has no `export` keyword; tsc emits `exports.map = map;` instead.
        // Treat a function as an exported entry when its name is assigned onto `exports`.
        function isExportedEntry(pathNode, state) {
            if (isExportedFunctionPath(pathNode)) {
                return true;
            }

            if (state.moduleFormat !== 'amd' || !state.exportedFunctionNames) {
                return false;
            }

            const id = pathNode.node.id;
            return Boolean(id && id.name && state.exportedFunctionNames.has(id.name));
        }

        function createTrackedScriptMetadata(state, functionName) {
            if (!state.trackedScript) {
                return null;
            }

            return {
                scopeKey: state.trackedScript.scopeKey,
                entryKind: state.trackedScript.entryKind,
                entryKey: functionName,
                filePath: state.filePath,
                modulePath: state.modulePath,
                scriptType: state.trackedScript.scriptType,
            };
        }

        return {
            pre(file) {
                this.helperId = null;
                this.instrumentedCount = 0;
                this.trackedScriptEntryHelperId = null;
                this.trackedScriptCount = 0;
                this.packageName = this.opts.packageName || DEFAULT_PACKAGE_NAME;
                this.filePath = normalizeRelativePath(this.opts.rootContext, file.opts.filename || '');
                this.modulePath = stripExtension(this.filePath);
                this.instrumentationSource = this.opts.instrumentationSource || DEFAULT_INSTRUMENTATION_SOURCE;
                this.moduleFormat = this.opts.moduleFormat || DEFAULT_MODULE_FORMAT;
                this.functionContextModule = this.opts.functionContextModule
                    ? (this.moduleFormat === 'amd'
                        ? this.opts.functionContextModule
                        : toImportSpecifier(file.opts.filename || '', this.opts.functionContextModule))
                    : `${this.packageName}/function-context`;
                this.trackedScriptEntryModule = this.opts.trackedScriptEntryModule
                    ? (this.moduleFormat === 'amd'
                        ? this.opts.trackedScriptEntryModule
                        : toImportSpecifier(file.opts.filename || '', this.opts.trackedScriptEntryModule))
                    : `${this.packageName}/performance-tracker`;
                this.trackedScript = this.opts.trackedScript || null;
                this.trackedScriptEntryFunctionHelperId = null;
                this.trackedScriptFunctionCount = 0;
                this.excludeObservedFunctionsByDefault = false;
                this.excludeArgumentsByDefault = false;
                this.functionContextModuleId = null;
                this.trackedScriptEntryModuleId = null;
            },
            visitor: {
                Program: {
                    enter(pathNode, state) {
                        state.helperId = pathNode.scope.generateUidIdentifier('ptrkWithFunctionContext');
                        if (state.moduleFormat === 'amd') {
                            state.functionContextModuleId = pathNode.scope.generateUidIdentifier('ptrkFunctionContextModule');
                        }
                        const leadingCommentText = getLeadingCommentText(state.file.code || '');
                        state.excludeObservedFunctionsByDefault = leadingCommentText.includes(IGNORE_OBSERVED_FUNCTIONS_TAG);
                        state.excludeArgumentsByDefault = commentContainsAnnotationTag(leadingCommentText, IGNORE_ARGUMENTS_TAG);
                        if (state.trackedScript) {
                            state.trackedScriptEntryHelperId = pathNode.scope.generateUidIdentifier('ptrkRunTrackedScriptEntry');
                            state.trackedScriptEntryFunctionHelperId = pathNode.scope.generateUidIdentifier('ptrkWrapTrackedScriptEntryFunction');
                            if (state.moduleFormat === 'amd') {
                                state.trackedScriptEntryModuleId = pathNode.scope.generateUidIdentifier('ptrkTrackedScriptModule');
                                state.exportedFunctionNames = collectAmdExportedNames(pathNode);
                            }
                        }
                    },
                    exit(pathNode, state) {
                        if (state.instrumentedCount > 0) {
                            if (state.moduleFormat === 'amd') {
                                ensureAmdHelperBinding(
                                    pathNode,
                                    types,
                                    state.functionContextModule,
                                    FUNCTION_CONTEXT_EXPORT,
                                    state.functionContextModuleId,
                                    state.helperId,
                                );
                            } else {
                                pathNode.unshiftContainer('body', {
                                    type: 'ImportDeclaration',
                                    specifiers: [types.importSpecifier(types.cloneNode(state.helperId), types.identifier(FUNCTION_CONTEXT_EXPORT))],
                                    source: types.stringLiteral(state.functionContextModule),
                                });
                            }
                        }

                        const entryHelpers = [];
                        if (state.trackedScriptCount > 0 && state.trackedScriptEntryHelperId) {
                            entryHelpers.push({ exportName: SCRIPT_ENTRY_EXPORT, helperId: state.trackedScriptEntryHelperId });
                        }
                        if (state.trackedScriptFunctionCount > 0 && state.trackedScriptEntryFunctionHelperId) {
                            entryHelpers.push({ exportName: SCRIPT_ENTRY_FUNCTION_EXPORT, helperId: state.trackedScriptEntryFunctionHelperId });
                        }

                        if (entryHelpers.length > 0) {
                            if (state.moduleFormat === 'amd') {
                                entryHelpers.forEach((entryHelper) => ensureAmdHelperBinding(
                                    pathNode,
                                    types,
                                    state.trackedScriptEntryModule,
                                    entryHelper.exportName,
                                    state.trackedScriptEntryModuleId,
                                    entryHelper.helperId,
                                ));
                            } else {
                                pathNode.unshiftContainer('body', {
                                    type: 'ImportDeclaration',
                                    specifiers: entryHelpers.map((entryHelper) => types.importSpecifier(types.cloneNode(entryHelper.helperId), types.identifier(entryHelper.exportName))),
                                    source: types.stringLiteral(state.trackedScriptEntryModule),
                                });
                            }
                        }
                    },
                },
                // tsc output assigns a call result straight onto exports: `exports.post = (0, server_1.defineRestlet)(...)`.
                AssignmentExpression(pathNode, state) {
                    if (!state.trackedScript || state.moduleFormat !== 'amd') {
                        return;
                    }

                    const left = pathNode.node.left;
                    if (!types.isMemberExpression(left)
                        || left.computed
                        || !types.isIdentifier(left.object, { name: 'exports' })
                        || !types.isIdentifier(left.property)
                        || !pathNode.get('right').isCallExpression()) {
                        return;
                    }

                    wrapTrackedScriptEntryCallResult(pathNode.get('right'), state, createTrackedScriptMetadata(state, left.property.name));
                },
                FunctionDeclaration(pathNode, state) {
                    if (!pathNode.node.id || !pathNode.node.id.name || pathNode.node.generator || hasLeadingIgnoreComment(pathNode)) {
                        return;
                    }

                    const declarationEntryMetadata = isExportedEntry(pathNode, state)
                        ? createTrackedScriptMetadata(state, pathNode.node.id.name)
                        : null;

                    instrumentFunctionBody(pathNode, state, {
                        ...createBaseMetadata(state, pathNode.node.id.name, 'function-declaration'),
                        excludeFromObservedFunctions: shouldExcludeObservedFunctions(pathNode, state),
                        excludeArguments: shouldExcludeArguments(pathNode, state),
                    });

                    // A tracked entry is ALSO recorded as an observed function (with no parent) so it is the
                    // root node of the observed-function call tree; its children attribute to it.
                    if (declarationEntryMetadata) {
                        wrapTrackedScriptEntry(pathNode, state, declarationEntryMetadata);
                    }
                },
                FunctionExpression(pathNode, state) {
                    if (!pathNode.node.id || !pathNode.node.id.name || pathNode.node.generator || hasLeadingIgnoreComment(pathNode)) {
                        return;
                    }

                    if (pathNode.parentPath && (pathNode.parentPath.isVariableDeclarator() || pathNode.parentPath.isObjectProperty())) {
                        return;
                    }

                    instrumentFunctionBody(pathNode, state, {
                        ...createBaseMetadata(state, pathNode.node.id.name, 'function-expression'),
                        excludeFromObservedFunctions: shouldExcludeObservedFunctions(pathNode, state),
                        excludeArguments: shouldExcludeArguments(pathNode, state),
                    });
                },
                VariableDeclarator(pathNode, state) {
                    if (!types.isIdentifier(pathNode.node.id) || !pathNode.node.init || hasLeadingIgnoreComment(pathNode)) {
                        return;
                    }

                    if (pathNode.get('init').isCallExpression() && state.trackedScript && isExportedEntry(pathNode, state)) {
                        wrapTrackedScriptEntryCallResult(pathNode.get('init'), state, createTrackedScriptMetadata(state, pathNode.node.id.name));
                        return;
                    }

                    if (!pathNode.get('init').isArrowFunctionExpression() && !pathNode.get('init').isFunctionExpression()) {
                        return;
                    }

                    if (pathNode.node.init.generator) {
                        return;
                    }

                    const initPath = pathNode.get('init');
                    const functionContext = initPath.isArrowFunctionExpression()
                        ? 'variable-arrow-function'
                        : 'variable-function-expression';

                    const variableEntryMetadata = isExportedEntry(pathNode, state)
                        ? createTrackedScriptMetadata(state, pathNode.node.id.name)
                        : null;

                    instrumentFunctionBody(initPath, state, {
                        ...createBaseMetadata(state, pathNode.node.id.name, functionContext),
                        excludeFromObservedFunctions: shouldExcludeObservedFunctions(pathNode, state),
                        excludeArguments: shouldExcludeArguments(pathNode, state),
                    });

                    // A tracked entry is ALSO recorded as an observed function (with no parent) so it is the
                    // root node of the observed-function call tree; its children attribute to it.
                    if (variableEntryMetadata) {
                        wrapTrackedScriptEntry(initPath, state, variableEntryMetadata);
                    }
                },
                ClassMethod(pathNode, state) {
                    if (pathNode.node.kind === 'constructor' || pathNode.node.generator || hasLeadingIgnoreComment(pathNode)) {
                        return;
                    }

                    const methodName = getKeyName(pathNode.node, types);
                    if (!methodName) {
                        return;
                    }

                    const className = getClassName(pathNode, types);
                    instrumentFunctionBody(pathNode, state, {
                        ...createBaseMetadata(state, className ? `${className}.${methodName}` : methodName, 'class-method'),
                        className,
                        methodName,
                        excludeFromObservedFunctions: shouldExcludeObservedFunctions(pathNode, state),
                        excludeArguments: shouldExcludeArguments(pathNode, state),
                    });
                },
                ObjectMethod(pathNode, state) {
                    if (pathNode.node.kind !== 'method' || pathNode.node.generator || hasLeadingIgnoreComment(pathNode)) {
                        return;
                    }

                    const methodName = getKeyName(pathNode.node, types);
                    if (!methodName) {
                        return;
                    }

                    const objectOwnerName = getObjectOwnerName(pathNode, types);
                    instrumentFunctionBody(pathNode, state, {
                        ...createBaseMetadata(state, objectOwnerName ? `${objectOwnerName}.${methodName}` : methodName, 'object-method'),
                        methodName,
                        excludeFromObservedFunctions: shouldExcludeObservedFunctions(pathNode, state),
                        excludeArguments: shouldExcludeArguments(pathNode, state),
                    });
                },
                ObjectProperty(pathNode, state) {
                    if (pathNode.node.computed || hasLeadingIgnoreComment(pathNode)) {
                        return;
                    }

                    const valuePath = pathNode.get('value');
                    if (!valuePath.isArrowFunctionExpression() && !valuePath.isFunctionExpression()) {
                        return;
                    }

                    if (valuePath.node.generator) {
                        return;
                    }

                    const methodName = getKeyName(pathNode.node, types);
                    if (!methodName) {
                        return;
                    }

                    const objectOwnerName = getObjectOwnerName(pathNode, types);
                    const functionContext = valuePath.isArrowFunctionExpression()
                        ? 'object-property-arrow-function'
                        : 'object-property-function-expression';

                    instrumentFunctionBody(valuePath, state, {
                        ...createBaseMetadata(state, objectOwnerName ? `${objectOwnerName}.${methodName}` : methodName, functionContext),
                        methodName,
                        excludeFromObservedFunctions: shouldExcludeObservedFunctions(pathNode, state),
                        excludeArguments: shouldExcludeArguments(pathNode, state),
                    });
                },
            },
            post() {
                this.file.metadata.ptrkInstrumentedCount = this.instrumentedCount;
                this.file.metadata.ptrkTrackedEntryCount = this.trackedScriptCount + this.trackedScriptFunctionCount;
            },
        };
    };
}

function transformNetSuiteWrapperSource(source, options = {}) {
    const resourcePath = options.resourcePath || '';
    if (/node_modules/.test(resourcePath) || /\.d\.ts$/i.test(resourcePath) || hasLeadingIgnorePragma(source)) {
        return null;
    }

    // Skip output that is already instrumented. The rewrite is a post-tsc step; if it runs again over
    // already-instrumented files (e.g. tsc did not re-emit a clean build), re-wrapping would double the
    // entry helpers and produce duplicate execution spans. The function-context helper binding is added
    // to every instrumented file, so its presence is a reliable "already instrumented" marker.
    if (/_ptrk[A-Za-z0-9]*WithFunctionContext|_ptrk[A-Za-z0-9]*FunctionContextModule/.test(source)) {
        return null;
    }

    const trackedScript = parseTrackedScriptOptions(source, options.defaultScopeKey);
    const result = transformSync(source, {
        filename: resourcePath,
        babelrc: false,
        configFile: false,
        comments: true,
        sourceMaps: Boolean(options.sourceMap),
        inputSourceMap: options.inputSourceMap || undefined,
        parserOpts: {
            sourceType: 'unambiguous',
            plugins: [
                'typescript',
                'jsx',
                'classProperties',
                'classPrivateProperties',
                'classPrivateMethods',
                'objectRestSpread',
                'optionalChaining',
                'nullishCoalescingOperator',
                'decorators-legacy',
            ],
        },
        generatorOpts: {
            comments: true,
            compact: false,
            retainLines: true,
        },
        plugins: [[createInstrumentationPlugin(), {
            rootContext: options.rootContext || process.cwd(),
            packageName: options.packageName,
            functionContextModule: options.functionContextModule,
            trackedScriptEntryModule: options.trackedScriptEntryModule,
            instrumentationSource: options.instrumentationSource || DEFAULT_INSTRUMENTATION_SOURCE,
            moduleFormat: options.moduleFormat || DEFAULT_MODULE_FORMAT,
            trackedScript,
        }]],
    });

    if (!result || !result.metadata || (result.metadata.ptrkInstrumentedCount === 0 && !result.metadata.ptrkTrackedEntryCount)) {
        return null;
    }

    return {
        code: result.code,
        map: result.map || options.inputSourceMap,
        instrumentedCount: result.metadata.ptrkInstrumentedCount,
        trackedEntryCount: result.metadata.ptrkTrackedEntryCount || 0,
    };
}

module.exports = {
    DEFAULT_INSTRUMENTATION_SOURCE,
    IGNORE_ARGUMENTS_TAG,
    parseTrackedScriptOptions,
    transformNetSuiteWrapperSource,
};