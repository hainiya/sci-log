export declare const PLUGIN_UI_PROTOCOL: "hana.plugin.ui";
export declare const PLUGIN_UI_PROTOCOL_VERSION: 1;
/**
 * Plugin surface session 的线协议名（#1629）：宿主把会话凭证以
 * `PLUGIN_SURFACE_SESSION_QUERY` 追加在 iframe src 上；iframe 页面调用本插件
 * route handler 时通过 `PLUGIN_SURFACE_SESSION_HEADER`（或同名 query）回传。
 * 服务端、桌面宿主与 iframe SDK 共用这一份定义。
 */
export declare const PLUGIN_SURFACE_SESSION_HEADER: "X-Hana-Plugin-Surface-Session";
export declare const PLUGIN_SURFACE_SESSION_QUERY: "pluginSurfaceSession";
export declare const PLUGIN_UI_ERROR_CODE: {
    readonly BAD_MESSAGE: "BAD_MESSAGE";
    readonly UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION";
    readonly UNKNOWN_TYPE: "UNKNOWN_TYPE";
    readonly CAPABILITY_DENIED: "CAPABILITY_DENIED";
    readonly SLOT_DENIED: "SLOT_DENIED";
    readonly TIMEOUT: "TIMEOUT";
    readonly HOST_ERROR: "HOST_ERROR";
};
export declare const PLUGIN_UI_CAPABILITY: {
    readonly TOAST_SHOW: "toast.show";
    readonly EXTERNAL_OPEN: "external.open";
    readonly SESSION_FILE_OPEN: "sessionFile.open";
    readonly RESOURCE_OPEN: "resource.open";
    readonly RESOURCE_PICK: "resource.pick";
    readonly RESOURCE_REQUEST_ACCESS: "resource.requestAccess";
    readonly UI_RESIZE: "ui.resize";
    readonly CLIPBOARD_WRITE_TEXT: "clipboard.writeText";
};
export declare const PLUGIN_RESOURCE_CAPABILITY: {
    readonly READ: "resource.read";
    readonly SEARCH: "resource.search";
    readonly WRITE: "resource.write";
    readonly MATERIALIZE: "resource.materialize";
    readonly WATCH: "resource.watch";
};
export type PluginUiErrorCode = (typeof PLUGIN_UI_ERROR_CODE)[keyof typeof PLUGIN_UI_ERROR_CODE];
export type PluginUiCapabilityName = (typeof PLUGIN_UI_CAPABILITY)[keyof typeof PLUGIN_UI_CAPABILITY];
export type PluginResourceCapabilityName = (typeof PLUGIN_RESOURCE_CAPABILITY)[keyof typeof PLUGIN_RESOURCE_CAPABILITY];
export type PluginResourceRef = {
    kind: 'local-file';
    path: string;
} | {
    kind: 'mount';
    mountId: string;
    path: string;
} | {
    kind: 'session-file';
    fileId: string;
    sessionId?: string;
    sessionPath?: string;
} | {
    kind: 'resource';
    resourceId: string;
} | {
    kind: 'url';
    url: string;
};
export interface PluginResourceVersion {
    mtimeMs?: number;
    size?: number | null;
    sha256?: string;
    etag?: string;
    sequence?: number;
}
export type PluginResourceDescriptor = PluginResourceRef & {
    provider?: string;
    filePath?: string;
    displayName?: string;
};
export interface PluginResourceStat {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    exists: boolean;
    isDirectory: boolean;
    version?: PluginResourceVersion;
    filePath?: string;
}
export interface PluginResourceReadResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    content: Uint8Array;
    version?: PluginResourceVersion;
    filePath?: string;
}
export interface PluginResourceMutationResult {
    changeType: 'created' | 'modified';
    resourceKey: string;
    resource: PluginResourceDescriptor;
    version?: PluginResourceVersion;
    filePath?: string;
}
export interface PluginResourceWriteConflictResult {
    ok: false;
    conflict: true;
    resourceKey: string;
    resource: PluginResourceDescriptor;
    version?: PluginResourceVersion;
    filePath?: string;
}
export type PluginResourceWriteExpectedVersionResult = PluginResourceMutationResult | PluginResourceWriteConflictResult;
export interface PluginResourceMoveResult {
    oldResourceKey: string;
    newResourceKey: string;
    oldResource: PluginResourceDescriptor;
    newResource: PluginResourceDescriptor;
    oldFilePath?: string;
    newFilePath?: string;
}
export interface PluginResourceTrashOptions {
    namespace?: string;
    metadata?: Record<string, unknown>;
}
export interface PluginResourceTrashResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    trashId: string;
    trashPath?: string;
    payloadPath?: string;
    filePath?: string;
}
export interface PluginResourceEdit {
    oldText: string;
    newText: string;
}
export interface PluginResourceListItem {
    name: string;
    isDirectory: boolean;
    size: number | null;
    mtimeMs: number;
}
export interface PluginResourceListResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    items: PluginResourceListItem[];
}
export interface PluginResourceSearchOptions {
    query?: string;
    [key: string]: unknown;
}
export interface PluginResourceSearchMatch {
    filePath: string;
    line: number;
    text: string;
    name?: string;
    relativePath?: string;
    parentSubdir?: string;
    isDirectory?: boolean;
    size?: number | null;
    mtimeMs?: number;
}
export interface PluginResourceSearchResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    matches: PluginResourceSearchMatch[];
}
export interface PluginResourceMaterializeResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    filePath: string;
    version?: PluginResourceVersion;
}
export interface PluginResourceWatchTarget {
    ref?: PluginResourceRef;
    filePath: string;
    isDirectory?: boolean;
    resourceKey: string;
    resource: PluginResourceDescriptor;
}
export interface PluginResourceEventCursor {
    streamId?: string;
    sequence: number;
    occurredAt?: string;
}
export interface PluginResourceError {
    code: string;
    message: string;
    capability?: PluginResourceCapabilityName | string;
    resource?: PluginResourceDescriptor;
    cursor?: PluginResourceEventCursor;
    safeMessage?: string;
    details?: unknown;
}
export interface PluginResourceOpenInput {
    resource: PluginResourceRef | Record<string, unknown>;
    mode?: 'preview' | 'reveal' | 'download' | string;
}
export interface PluginResourceOpenResult {
    opened: boolean;
}
export interface PluginResourcePickInput {
    mode?: 'file' | 'directory' | string;
    multiple?: boolean;
    capability?: PluginResourceCapabilityName | string;
}
export interface PluginResourcePickResult {
    resources: Array<PluginResourceRef | Record<string, unknown>>;
}
export interface PluginResourceRequestAccessInput {
    capability: PluginResourceCapabilityName | string;
    resource?: PluginResourceRef | Record<string, unknown>;
    reason?: string;
}
export interface PluginResourceRequestAccessResult {
    granted: boolean;
    capability: PluginResourceCapabilityName | string;
}
export type PluginUiSlot = 'page' | 'widget' | 'card' | 'settings';
export type PluginUiMessageKind = 'event' | 'request' | 'response' | 'error';
export interface PluginUiError {
    code: PluginUiErrorCode | string;
    message: string;
    details?: unknown;
}
export interface PluginUiMessage {
    protocol: typeof PLUGIN_UI_PROTOCOL;
    version: typeof PLUGIN_UI_PROTOCOL_VERSION;
    id?: string;
    kind: PluginUiMessageKind;
    type: string;
    payload?: unknown;
    error?: PluginUiError;
}
export type PluginUiParseResult = {
    ok: true;
    value: PluginUiMessage;
} | {
    ok: false;
    error: {
        code: typeof PLUGIN_UI_ERROR_CODE.BAD_MESSAGE | typeof PLUGIN_UI_ERROR_CODE.UNSUPPORTED_VERSION;
        message: string;
    };
};
export declare function parsePluginUiMessage(value: unknown): PluginUiParseResult;
export declare function isPluginUiMessage(value: unknown): value is PluginUiMessage;
//# sourceMappingURL=index.d.ts.map