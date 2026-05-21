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
    if (!activeSink || (typeof activeSink.isActive === 'function' && !activeSink.isActive())) {
        return work();
    }

    return activeSink.runOperation(resolveWrapperOperationMetadata(metadata), work);
}