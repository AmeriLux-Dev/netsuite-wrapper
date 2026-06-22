const path = require('path');
const { transformSync } = require('@babel/core');
const { DEFAULT_PACKAGE_NAME } = require('./build-support');

const IGNORE_TAG = '@ptrk-ignore';
const IGNORE_OBSERVED_FUNCTIONS_TAG = '@ptrk-ignore-observed-functions';
const PFTR_SCOPE_KEY_TAG = '@pftr:scopeKey';
const NETSUITE_SCRIPT_TYPE_TAG = '@NScriptType';
const FUNCTION_CONTEXT_EXPORT = 'withFunctionContext';
const SCRIPT_ENTRY_EXPORT = 'runTrackedScriptEntry';
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

function hasLeadingIgnorePragma(source) {
    const leadingCommentMatch = source.match(/^\s*((?:\/\*[\s\S]*?\*\/\s*|\/\/[^\r\n]*\r?\n\s*)+)/);
    return Boolean(leadingCommentMatch && leadingCommentMatch[1].includes(IGNORE_TAG));
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

function parseTrackedScriptOptions(source) {
    const leadingCommentText = getLeadingCommentText(source);
    const scopeKey = getAnnotationValue(leadingCommentText, PFTR_SCOPE_KEY_TAG);
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

            return [];
        });

    return types.objectExpression(properties);
}

function createWrappedBody(types, helperId, originalBody, metadata, isAsync) {
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

            pathNode.node.body = createWrappedBody(types, state.helperId, body, metadata, Boolean(pathNode.node.async));
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
                this.excludeObservedFunctionsByDefault = false;
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
                        state.excludeObservedFunctionsByDefault = Boolean(getLeadingCommentText(state.file.code || '').includes(IGNORE_OBSERVED_FUNCTIONS_TAG));
                        if (state.trackedScript) {
                            state.trackedScriptEntryHelperId = pathNode.scope.generateUidIdentifier('ptrkRunTrackedScriptEntry');
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

                        if (state.trackedScriptCount > 0 && state.trackedScriptEntryHelperId) {
                            if (state.moduleFormat === 'amd') {
                                ensureAmdHelperBinding(
                                    pathNode,
                                    types,
                                    state.trackedScriptEntryModule,
                                    SCRIPT_ENTRY_EXPORT,
                                    state.trackedScriptEntryModuleId,
                                    state.trackedScriptEntryHelperId,
                                );
                            } else {
                                pathNode.unshiftContainer('body', {
                                    type: 'ImportDeclaration',
                                    specifiers: [types.importSpecifier(types.cloneNode(state.trackedScriptEntryHelperId), types.identifier(SCRIPT_ENTRY_EXPORT))],
                                    source: types.stringLiteral(state.trackedScriptEntryModule),
                                });
                            }
                        }
                    },
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
                    });
                },
                VariableDeclarator(pathNode, state) {
                    if (!types.isIdentifier(pathNode.node.id) || !pathNode.node.init || hasLeadingIgnoreComment(pathNode)) {
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
                    });
                },
            },
            post() {
                this.file.metadata.ptrkInstrumentedCount = this.instrumentedCount;
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

    const trackedScript = parseTrackedScriptOptions(source);
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

    if (!result || !result.metadata || result.metadata.ptrkInstrumentedCount === 0) {
        return null;
    }

    return {
        code: result.code,
        map: result.map || options.inputSourceMap,
        instrumentedCount: result.metadata.ptrkInstrumentedCount,
    };
}

module.exports = {
    DEFAULT_INSTRUMENTATION_SOURCE,
    parseTrackedScriptOptions,
    transformNetSuiteWrapperSource,
};