import { observe } from './fail-open';

export interface WrapperOperationMetadata {
    module: string;
    action: string;
    summary?: string;
    scopeKey?: string;
    stage?: string;
    detail?: Record<string, unknown>;
}

export interface WrapperTelemetrySink {
    isActive?(): boolean;
    runOperation<T>(metadata: WrapperOperationMetadata, work: () => T): T;
}

export type WrapperOperationMetadataInput = WrapperOperationMetadata | (() => WrapperOperationMetadata);

let activeSink: WrapperTelemetrySink | null = null;

export function getWrapperTelemetrySink(): WrapperTelemetrySink | null {
    return activeSink;
}

export function setWrapperTelemetrySink(sink: WrapperTelemetrySink | null): void {
    activeSink = sink;
}

export function withWrapperTelemetrySink<T>(sink: WrapperTelemetrySink, work: () => T): T {
    const previousSink = activeSink;
    activeSink = sink;

    try {
        return work();
    } finally {
        activeSink = previousSink;
    }
}

function resolveWrapperOperationMetadata(metadata: WrapperOperationMetadataInput): WrapperOperationMetadata {
    return typeof metadata === 'function'
        ? metadata()
        : metadata;
}

export function runWrappedOperation<T>(metadata: WrapperOperationMetadataInput, work: () => T): T {
    const sink = activeSink;
    if (!sink) {
        return work();
    }

    // Everything the sink does, including deciding whether it is active and building the metadata,
    // runs inside observe(): a sink that fails never stops the N/* call or changes what it returns.
    return observe(work, (observedWork) => {
        if (typeof sink.isActive === 'function' && !sink.isActive()) {
            return observedWork();
        }

        return sink.runOperation(resolveWrapperOperationMetadata(metadata), observedWork);
    });
}