import type { PluginResourceDescriptor, PluginResourceEdit, PluginResourceListItem, PluginResourceListResult, PluginResourceMaterializeResult, PluginResourceMoveResult, PluginResourceReadResult, PluginResourceRef, PluginResourceSearchMatch, PluginResourceSearchOptions, PluginResourceSearchResult, PluginResourceStat, PluginResourceTrashOptions, PluginResourceTrashResult, PluginResourceVersion, PluginResourceWatchTarget, PluginResourceWriteConflictResult, PluginResourceWriteExpectedVersionResult, PluginResourceMutationResult } from '@hana/plugin-protocol';
export type MaybePromise<T> = T | Promise<T>;
export type JsonSchema = Record<string, unknown>;
export declare const HANA_BUS_SKIP: unique symbol;
export interface HanaToolResult {
    content?: Array<Record<string, unknown>>;
    details?: Record<string, unknown>;
}
export interface HanaSessionRef {
    sessionId: string;
    sessionPath?: string | null;
    legacySessionPath?: string | null;
}
export type HanaSessionTarget = string | HanaSessionRef | {
    sessionId?: string | null;
    sessionPath?: string | null;
    path?: string | null;
    legacySessionPath?: string | null;
};
export interface HanaSessionFile {
    id?: string | null;
    fileId?: string | null;
    sessionId?: string | null;
    sessionPath?: string | null;
    filePath?: string;
    realPath?: string;
    displayName?: string;
    filename?: string;
    label?: string;
    ext?: string | null;
    mime?: string;
    size?: number;
    kind?: string;
    isDirectory?: boolean;
    origin?: string;
    operations?: unknown[];
    createdAt?: number | string;
    storageKind?: string;
    status?: string;
    missingAt?: number | string | null;
    resource?: HanaResourceEnvelope;
    [key: string]: unknown;
}
export interface HanaResourceEnvelope {
    schemaVersion: 1;
    resourceId: string;
    name: string;
    studioId: string;
    type: 'file' | string;
    source: 'session_file' | string;
    sourceId?: string;
    fileId?: string;
    displayName?: string;
    filename?: string;
    ext?: string | null;
    mime?: string;
    size?: number | null;
    kind?: string;
    isDirectory?: boolean;
    origin?: string;
    operations?: string[];
    createdAt?: number | string;
    mtimeMs?: number;
    lifecycle: {
        status: string;
        missingAt: number | string | null;
    };
    storage: {
        provider: string;
        storageKind?: string;
        localOnly?: boolean;
    };
    links: {
        self: string;
        content?: string;
    };
    [key: string]: unknown;
}
export type HanaResourceRef = PluginResourceRef;
export type HanaResourceVersion = PluginResourceVersion;
export type HanaResourceDescriptor = PluginResourceDescriptor;
export type HanaResourceStat = PluginResourceStat;
export type HanaResourceReadResult = PluginResourceReadResult;
export type HanaResourceMutationResult = PluginResourceMutationResult;
export type HanaResourceWriteConflictResult = PluginResourceWriteConflictResult;
export type HanaResourceWriteExpectedVersionResult = PluginResourceWriteExpectedVersionResult;
export type HanaResourceMoveResult = PluginResourceMoveResult;
export type HanaResourceTrashOptions = PluginResourceTrashOptions;
export type HanaResourceTrashResult = PluginResourceTrashResult;
export type HanaResourceEdit = PluginResourceEdit;
export type HanaResourceListItem = PluginResourceListItem;
export type HanaResourceListResult = PluginResourceListResult;
export type HanaResourceSearchOptions = PluginResourceSearchOptions;
export type HanaResourceSearchMatch = PluginResourceSearchMatch;
export type HanaResourceSearchResult = PluginResourceSearchResult;
export type HanaResourceMaterializeResult = PluginResourceMaterializeResult;
export type HanaResourceWatchTarget = PluginResourceWatchTarget;
export interface HanaPluginResourceMutationOptions {
    emit?: boolean;
}
export interface HanaPluginResourceWatchOptions {
    purpose?: string | null;
    sessionRef?: HanaSessionRef | {
        sessionPath?: string | null;
        path?: string | null;
    } | null;
    /** @deprecated Prefer sessionId/sessionRef on the invocation context. */
    sessionPath?: string | null;
}
export interface HanaResourceWatchSubscription {
    subscriptionId: string;
    resourceKeys: string[];
    unsubscribe(): boolean;
    close(): boolean;
}
export interface HanaPluginResources {
    stat(ref: HanaResourceRef | Record<string, unknown>): Promise<HanaResourceStat>;
    read(ref: HanaResourceRef | Record<string, unknown>): Promise<HanaResourceReadResult>;
    list(ref: HanaResourceRef | Record<string, unknown>): Promise<HanaResourceListResult>;
    search(ref: HanaResourceRef | Record<string, unknown>, options?: HanaResourceSearchOptions): Promise<HanaResourceSearchResult>;
    materialize(ref: HanaResourceRef | Record<string, unknown>): Promise<HanaResourceMaterializeResult>;
    write(ref: HanaResourceRef | Record<string, unknown>, content: string | Uint8Array | ArrayBuffer, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceMutationResult>;
    writeExpectedVersion(ref: HanaResourceRef | Record<string, unknown>, content: string | Uint8Array | ArrayBuffer, expectedVersion: HanaResourceVersion, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceWriteExpectedVersionResult>;
    edit(ref: HanaResourceRef | Record<string, unknown>, edits: HanaResourceEdit[], options?: HanaPluginResourceMutationOptions): Promise<HanaResourceMutationResult>;
    mkdir(ref: HanaResourceRef | Record<string, unknown>, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceMutationResult>;
    delete(ref: HanaResourceRef | Record<string, unknown>, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceMutationResult>;
    copy(from: HanaResourceRef | Record<string, unknown>, to: HanaResourceRef | Record<string, unknown>, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceMutationResult>;
    rename(from: HanaResourceRef | Record<string, unknown>, to: HanaResourceRef | Record<string, unknown>, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceMoveResult>;
    move(from: HanaResourceRef | Record<string, unknown>, to: HanaResourceRef | Record<string, unknown>, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceMoveResult>;
    trash(ref: HanaResourceRef | Record<string, unknown>, trashOptions?: HanaResourceTrashOptions, options?: HanaPluginResourceMutationOptions): Promise<HanaResourceTrashResult>;
    watch(ref: HanaResourceRef | Record<string, unknown>, options?: HanaPluginResourceWatchOptions): HanaResourceWatchSubscription;
    subscribe(resources: Array<HanaResourceRef | Record<string, unknown>>, options?: HanaPluginResourceWatchOptions): HanaResourceWatchSubscription;
    resolveWatchTarget?(ref: HanaResourceRef | Record<string, unknown>, options?: HanaPluginResourceWatchOptions): HanaResourceWatchTarget;
}
export interface HanaExecutionBoundary {
    schemaVersion: 1;
    boundaryId: string;
    kind: 'local_process' | string;
    serverNodeId: string;
    studioId: string;
    workbench?: {
        kind: string;
        root: string | null;
        [key: string]: unknown;
    };
    sandbox?: {
        kind: string;
        enforcedBy?: string;
        [key: string]: unknown;
    };
    filesystem?: {
        policy: string;
        [key: string]: unknown;
    };
    network?: {
        policy: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface HanaSessionFileMediaItem {
    type: 'session_file';
    fileId: string;
    sessionId?: string | null;
    sessionPath?: string | null;
    filePath?: string;
    label?: string;
    mime?: string;
    size?: number;
    kind?: string;
    [key: string]: unknown;
}
export interface HanaStagedSessionFile {
    file?: HanaSessionFile | null;
    sessionFile?: HanaSessionFile | null;
    mediaItem: HanaSessionFileMediaItem;
}
export interface HanaMediaDetails {
    media: {
        items: HanaSessionFileMediaItem[];
    };
}
export interface HanaChatSurfaceCardOptions {
    title?: string;
    description?: string;
    mode?: 'transcript' | 'full' | string;
    composer?: boolean;
    aspectRatio?: string;
}
export interface HanaChatSurfaceCardDetails {
    type: 'chat.surface';
    pluginId: string;
    sessionId: string;
    sessionRef: HanaSessionRef;
    sessionPath?: string;
    title?: string;
    description: string;
    mode: 'transcript' | 'full' | string;
    composer?: boolean;
    aspectRatio?: string;
}
export interface HanaPluginNetworkFetchInit extends RequestInit {
    timeoutMs?: number;
    cacheTtlMs?: number;
    maxResponseBytes?: number;
}
export interface HanaPluginNetwork {
    fetch(input: string | URL | Request, init?: HanaPluginNetworkFetchInit): Promise<Response>;
}
export interface HanaToolContext {
    serverId: string;
    serverNodeId?: string;
    userId: string;
    studioId: string;
    connectionKind?: 'local' | 'lan' | 'custom_remote' | 'relay' | 'cloud' | string;
    credentialKind?: 'none' | 'loopback_token' | 'device_credential' | 'user_session' | string;
    platformAccountId?: string | null;
    officialServiceKind?: 'relay' | 'cloud_studio' | 'inference' | 'billing' | string | null;
    executionBoundary?: HanaExecutionBoundary;
    pluginId: string;
    pluginDir: string;
    dataDir: string;
    capabilities?: string[];
    sensitiveCapabilities?: string[];
    sessionId?: string | null;
    sessionRef?: HanaSessionRef | null;
    /** @deprecated Use sessionId/sessionRef. Kept for legacy plugins. */
    sessionPath?: string | null;
    bus: HanaEventBus;
    network: HanaPluginNetwork;
    resources: HanaPluginResources;
    config: HanaPluginConfigStore;
    log: HanaPluginLogger;
    registerSessionFile?: (input: Record<string, unknown>) => HanaSessionFile;
    stageFile?: (input: Record<string, unknown>) => HanaStagedSessionFile;
    [key: string]: unknown;
}
export type HanaToolSessionPermissionKind = 'read' | 'read_only' | 'plugin_output' | 'session_file_output' | 'workspace_write' | 'external_side_effect' | 'review' | string;
export type HanaToolInvocationKind = 'read' | 'routine' | 'review';
export type HanaToolInvocationTargetType = 'url' | 'browser_tab' | 'background_task' | 'channel' | 'channel_draft' | 'agent' | 'notification_route' | 'setting' | 'memory_store' | 'pinned_memory_item' | 'pinned_memory_query' | 'experience_category' | 'session_files' | 'terminal_process';
export interface HanaToolInvocationTarget {
    type: HanaToolInvocationTargetType;
    /** Exact wildcard-free identity, limited by the host to 4096 characters. */
    id: string;
    /** Display-only label for reviewer context. */
    label?: string;
}
export interface HanaToolInvocationDescriptor {
    action: string;
    kind: HanaToolInvocationKind;
    /** Stable capability id in the form `<tool-name>.<action>`. */
    capability: string;
    target?: HanaToolInvocationTarget;
    sideEffect?: Record<string, unknown>;
}
export interface HanaToolSessionPermission<Input = unknown> {
    /**
     * True means the tool only reads already-authorized data and may run in
     * read-only sessions without reviewer escalation.
     */
    readOnly?: boolean;
    /**
     * Host approval classification hint. Unknown or external side-effect kinds
     * remain reviewer-bound in Auto mode.
     */
    kind?: HanaToolSessionPermissionKind;
    /**
     * Override Auto-mode handling for a declared non-read tool.
     */
    auto?: 'allow' | 'review';
    description?: string;
    sideEffect?: Record<string, unknown>;
    describeSideEffect?: (input: Input) => Record<string, unknown> | null | undefined;
    /**
     * Synchronously classify one concrete invocation. Return null for an
     * unsupported action or invalid target so the host can fail closed.
     * Promise/thenable results are consumed safely and rejected. The descriptor
     * action is the resolver's stable permission action; the host does not infer
     * it from an optional input.action field or require those strings to match.
     *
     * Actor, server, and session identity are host-owned and must not appear in
     * the returned descriptor or sideEffect metadata.
     */
    resolveInvocation?: (input: Input) => HanaToolInvocationDescriptor | null;
}
export interface HanaToolDefinition<Input = unknown, Output = unknown> {
    name: string;
    description: string;
    parameters?: JsonSchema;
    promptSnippet?: string;
    promptGuidelines?: string;
    sessionPermission?: HanaToolSessionPermission<Input>;
    metadata?: Record<string, unknown>;
    invocationStyle?: 'sdk_tool' | 'pi_tool';
    execute(input: Input, ctx: HanaToolContext): MaybePromise<Output>;
}
export type HanaSlashPermission = 'anyone' | 'owner' | 'admin';
export type HanaSlashScope = 'session' | 'global';
export interface HanaCommandContext {
    [key: string]: unknown;
}
export interface HanaCommandResult {
    reply?: string;
    silent?: boolean;
    error?: string;
    [key: string]: unknown;
}
export interface HanaCommandDefinition<Context = HanaCommandContext> {
    name: string;
    aliases?: string[];
    description?: string;
    scope?: HanaSlashScope;
    permission?: HanaSlashPermission;
    usage?: string;
    handler?: (ctx: Context) => MaybePromise<HanaCommandResult | void>;
    execute?: (ctx: Context) => MaybePromise<unknown>;
}
export type HanaProviderRuntimeKind = 'http' | 'oauth-http' | 'local-cli' | 'browser-cli' | 'plugin';
export type HanaMediaCapabilityName = 'imageGeneration' | 'videoGeneration' | 'speechGeneration' | string;
export type HanaMediaOutputKind = 'file_glob' | 'json_stdout' | 'url_stdout';
export type HanaCliBindingSource = 'prompt' | 'modelId' | 'inputFile' | 'outputDir' | 'size' | 'duration';
export type HanaCliArgBinding = {
    literal: string;
} | {
    option: string;
    from: HanaCliBindingSource;
};
export interface HanaCliOutputContract {
    kind: HanaMediaOutputKind;
    directory?: HanaCliBindingSource | string;
    pattern?: string;
    [key: string]: unknown;
}
export interface HanaCliCommandSpec {
    executable: string;
    args: HanaCliArgBinding[];
    timeoutMs: number;
    output: HanaCliOutputContract;
}
export interface HanaProviderRuntime {
    kind: HanaProviderRuntimeKind;
    protocolId?: string;
    command?: HanaCliCommandSpec;
    [key: string]: unknown;
}
export interface HanaProviderChatCapability {
    projection?: 'models-json' | 'sdk-auth-alias' | 'none' | string;
    credentialSource?: 'provider-catalog' | 'auth-storage' | 'none';
    runtimeProviderId?: string;
    displayProviderId?: string;
    allowListSource?: string;
    [key: string]: unknown;
}
export interface HanaMediaReferenceImageLimits {
    min?: number;
    max?: number;
    [key: string]: unknown;
}
export interface HanaMediaInputLimits {
    referenceImages?: HanaMediaReferenceImageLimits;
    [key: string]: unknown;
}
export interface HanaProviderMediaMode {
    id: string;
    label?: string;
    parameterSchema?: JsonSchema;
    defaults?: Record<string, unknown>;
    inputLimits?: HanaMediaInputLimits;
    pricing?: Record<string, unknown>;
    agentHints?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface HanaProviderMediaModel {
    id: string;
    displayName?: string;
    protocolId: string;
    inputs?: string[];
    outputs?: string[];
    supportsEdit?: boolean;
    aliases?: string[];
    credentialLaneId?: string;
    modes?: HanaProviderMediaMode[];
    parameterSchema?: JsonSchema;
    defaults?: Record<string, unknown>;
    inputLimits?: HanaMediaInputLimits;
    [key: string]: unknown;
}
export interface HanaProviderCredentialLane {
    id: string;
    kind?: string;
    label?: string;
    [key: string]: unknown;
}
export interface HanaProviderMediaCapability {
    defaultModelId?: string;
    models: HanaProviderMediaModel[];
    credentialLanes?: HanaProviderCredentialLane[];
    [key: string]: unknown;
}
export interface HanaProviderCapabilities {
    chat?: HanaProviderChatCapability;
    media?: Partial<Record<HanaMediaCapabilityName, HanaProviderMediaCapability>>;
    [key: string]: unknown;
}
export interface HanaProviderSource {
    kind: 'builtin' | 'plugin' | 'user' | string;
    pluginId?: string;
    [key: string]: unknown;
}
export interface HanaProviderDefinition {
    id: string;
    displayName?: string;
    name?: string;
    authType?: 'api-key' | 'oauth' | 'none' | string;
    authJsonKey?: string;
    defaultBaseUrl?: string;
    defaultApi?: string;
    api?: string;
    models?: unknown[];
    runtime?: HanaProviderRuntime;
    capabilities?: HanaProviderCapabilities;
    source?: HanaProviderSource;
    [key: string]: unknown;
}
export type HanaExtensionFactory<Pi = unknown> = (pi: Pi) => MaybePromise<void>;
export interface HanaPluginConfigStore {
    get<T = unknown>(key: string, options?: HanaPluginConfigScopeOptions): MaybePromise<T | undefined>;
    getAll?(options?: HanaPluginConfigScopeOptions & {
        redacted?: boolean;
    }): MaybePromise<Record<string, unknown>>;
    set<T = unknown>(key: string, value: T, options?: HanaPluginConfigScopeOptions): MaybePromise<void>;
    setMany?(values: Record<string, unknown>, options?: HanaPluginConfigScopeOptions): MaybePromise<Record<string, unknown>>;
    getSchema?(): JsonSchema;
}
export interface HanaPluginConfigScopeOptions {
    scope?: 'global' | 'per-agent' | 'per-session';
    agentId?: string;
    sessionId?: string;
    /** @deprecated Use sessionId. Kept for legacy config scopes. */
    sessionPath?: string;
}
export interface HanaSessionTurnContext {
    system?: string | Array<string | {
        text: string;
        label?: string;
    }>;
    beforeUser?: string | Array<string | {
        text: string;
        label?: string;
    }>;
    afterUser?: string | Array<string | {
        text: string;
        label?: string;
    }>;
    metadata?: Record<string, unknown>;
}
export interface HanaSessionCreateInput {
    agentId?: string | null;
    cwd?: string | null;
    memoryEnabled?: boolean;
    model?: string | {
        id?: string;
        modelId?: string;
        provider?: string;
        providerId?: string;
    };
    workspaceFolders?: string[];
    authorizedFolders?: string[];
    thinkingLevel?: string;
    permissionMode?: string;
    ownerPluginId?: string | null;
    kind?: string | null;
    sessionKind?: string | null;
    visibility?: 'public' | 'plugin_private' | 'private' | string;
}
export interface HanaSessionSendInput {
    text: string;
    context?: HanaSessionTurnContext | null;
    images?: unknown[];
    videos?: unknown[];
    audios?: unknown[];
    imageAttachmentPaths?: string[];
    videoAttachmentPaths?: string[];
    audioAttachmentPaths?: string[];
    [key: string]: unknown;
}
export interface HanaSessionListFilter {
    agentId?: string;
    ownerPluginId?: string;
    includePluginPrivate?: boolean;
}
export interface HanaSessionUpdateInput {
    title?: string;
    pinned?: boolean;
    projectId?: string | null;
    thinkingLevel?: string;
    permissionMode?: string;
    ownerPluginId?: string | null;
    kind?: string | null;
    visibility?: 'public' | 'plugin_private' | 'private' | string;
}
export interface HanaAgentCreateInput {
    id?: string;
    name: string;
    yuan?: string;
    ownerPluginId?: string | null;
    visibility?: 'public' | 'plugin_private' | 'private' | string;
    kind?: string | null;
    initialFiles?: Record<string, string>;
    initialMemory?: Record<string, unknown>;
    memoryPolicy?: {
        enabled?: boolean;
    };
}
export interface HanaAgentUpdateInput {
    name?: string;
    yuan?: string;
    ownerPluginId?: string | null;
    visibility?: 'public' | 'plugin_private' | 'private' | string;
    kind?: string | null;
    memoryPolicy?: {
        enabled?: boolean;
    };
    toolPolicy?: {
        disabled?: string[];
    };
    config?: Record<string, unknown>;
}
export interface HanaModelSampleInput {
    systemPrompt?: string;
    messages: Array<{
        role: string;
        content: unknown;
    }>;
    sessionId?: string;
    sessionRef?: HanaSessionRef;
    /** @deprecated Use sessionId/sessionRef. */
    sessionPath?: string;
    agentId?: string;
    temperature?: number;
    maxTokens?: number;
    operation?: string;
}
export interface HanaMediaProviderFilter {
    capability?: string;
}
export interface HanaMediaModelRef {
    providerId?: string;
    provider?: string;
    modelId?: string;
    model?: string;
    capability?: string;
    credentialLaneId?: string;
}
export type HanaSessionFileReference = {
    kind: 'session_file';
    fileId: string;
} | {
    type: 'session_file';
    fileId: string;
};
export type HanaGenerateImageReference = HanaSessionFileReference;
export interface HanaMediaDelivery {
    mode?: 'session' | 'response' | string;
    ttlMs?: number;
    [key: string]: unknown;
}
export interface HanaGenerateImageInput {
    sessionId?: string;
    sessionRef?: HanaSessionRef;
    /** @deprecated Use sessionId/sessionRef. */
    sessionPath?: string;
    prompt: string;
    count?: number;
    image?: HanaGenerateImageReference | HanaGenerateImageReference[];
    referenceImages?: HanaGenerateImageReference[];
    ratio?: string;
    resolution?: string;
    quality?: string;
    mode?: string;
    options?: Record<string, unknown>;
    model?: string;
    provider?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    delivery?: HanaMediaDelivery;
    deliveryMode?: string;
    deliveryTarget?: unknown;
}
export interface HanaGenerateVideoInput {
    sessionId?: string;
    sessionRef?: HanaSessionRef;
    /** @deprecated Use sessionId/sessionRef. */
    sessionPath?: string;
    prompt: string;
    image?: HanaGenerateImageReference | HanaGenerateImageReference[] | string;
    referenceImages?: HanaGenerateImageReference[];
    duration?: number;
    ratio?: string;
    resolution?: string;
    mode?: string;
    options?: Record<string, unknown>;
    model?: string;
    provider?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    delivery?: HanaMediaDelivery;
    deliveryMode?: string;
    deliveryTarget?: unknown;
}
export interface HanaGenerateMediaInput {
    kind?: 'image' | 'video' | 'audio' | 'image_generation' | 'video_generation' | 'speech_recognition' | 'asr' | 'transcription' | string;
    type?: string;
    mediaKind?: string;
    sessionId?: string;
    sessionRef?: HanaSessionRef;
    /** @deprecated Use sessionId/sessionRef. */
    sessionPath?: string;
    fileId?: string;
    prompt?: string;
    image?: HanaGenerateImageReference | HanaGenerateImageReference[] | string;
    referenceImages?: HanaGenerateImageReference[];
    duration?: number;
    ratio?: string;
    resolution?: string;
    quality?: string;
    mode?: string;
    options?: Record<string, unknown>;
    model?: string;
    provider?: string;
    delivery?: HanaMediaDelivery;
    deliveryMode?: string;
    input?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface HanaTranscribeAudioInput {
    sessionId?: string;
    sessionRef?: HanaSessionRef;
    /** @deprecated Use sessionId/sessionRef. */
    sessionPath?: string;
    fileId: string;
    language?: string;
    providerId?: string;
    provider?: string;
    modelId?: string;
    model?: string;
}
export interface HanaTranscribeAudioResult {
    ok: true;
    transcription: unknown;
    taskId?: string;
    stream?: unknown;
}
export interface HanaEventBus {
    emit(event: unknown, sessionPath?: string | null): unknown;
    emit(type: string, payload?: unknown): unknown;
    subscribe(callback: (event: unknown, sessionPath?: string | null) => void, filter?: HanaBusSubscriptionFilter): () => void;
    subscribe(type: string, handler: (payload: unknown) => void): () => void;
    request<T = unknown>(type: string, payload?: unknown, options?: Record<string, unknown>): Promise<T>;
    hasHandler?(type: string): boolean;
    handle?(type: string, handler: (payload: unknown) => MaybePromise<unknown>): () => void;
    listCapabilities?(): HanaEventBusCapability[];
    getCapability?(type: string): HanaEventBusCapability | null;
}
export interface HanaPluginRouteRequestContext {
    pluginId: string;
    agentId: string | null;
    principal: Record<string, unknown> | null;
    capabilityGrant: {
        accessLevel: string;
        declaredPermissions: readonly string[];
        legacyDeclaration: boolean;
    };
    bus: Pick<HanaEventBus, 'request' | 'emit' | 'subscribe' | 'hasHandler' | 'getCapability' | 'listCapabilities'>;
}
export interface HanaPluginHonoLikeContext {
    get?(name: string): unknown;
}
export declare function getPluginRequestContext(c: HanaPluginHonoLikeContext): HanaPluginRouteRequestContext;
export interface HanaBusSubscriptionFilter {
    types?: string[] | Set<string>;
    [key: string]: unknown;
}
export interface HanaEventBusCapability {
    type: string;
    title: string;
    description: string;
    inputSchema: JsonSchema;
    outputSchema: JsonSchema;
    permission: string;
    errors: string[];
    stability: string;
    owner: string;
    since?: string;
    available?: boolean;
}
export interface HanaNormalizedUsage {
    input: {
        totalTokens: number | null;
        uncachedTokens: number | null;
    };
    output: {
        totalTokens: number | null;
        reasoningTokens: number | null;
    };
    cache: {
        readTokens: number | null;
        writeTokens: number | null;
        missTokens: number | null;
        hit: boolean | null;
        created: boolean | null;
        hitRatio: number | null;
        support: 'reported' | 'not_reported' | 'not_supported';
    };
    totalTokens: number | null;
    costTotal: number | null;
}
export type HanaUsageAttribution = {
    kind: 'session';
    agentId: string | null;
    sessionId?: string | null;
    sessionPath?: string | null;
} | {
    kind: 'phone_conversation';
    agentId: string;
    conversationId: string;
    conversationType: 'channel' | 'dm';
    sessionId?: string | null;
    sessionPath?: string | null;
} | {
    kind: 'memory';
    agentId: string | null;
} | {
    kind: 'automation';
    jobId?: string | null;
    runId?: string | null;
    agentId?: string | null;
} | {
    kind: 'plugin';
    pluginId: string;
    agentId?: string | null;
    sessionId?: string | null;
    sessionPath?: string | null;
} | {
    kind: 'utility';
    agentId?: string | null;
    sessionId?: string | null;
    sessionPath?: string | null;
} | {
    kind: 'unknown';
};
export interface HanaUsageSource {
    subsystem: 'session' | 'phone' | 'memory' | 'automation' | 'subagent' | 'compaction' | 'plugin' | 'utility' | 'vision' | 'unknown' | string;
    operation: string;
    surface: 'desktop' | 'mobile' | 'bridge' | 'channel' | 'dm' | 'cron' | 'heartbeat' | 'system' | 'plugin' | 'unknown' | string;
    trigger: 'user' | 'manual' | 'threshold' | 'overflow' | 'daily' | 'scheduled' | 'startup' | 'tool' | 'unknown' | string;
    actor?: {
        kind: 'session' | 'phone_conversation' | 'automation' | 'plugin' | 'subagent' | 'unknown' | string;
        agentId?: string | null;
        sessionId?: string | null;
        sessionPath?: string | null;
        taskId?: string | null;
        [key: string]: unknown;
    };
    parent?: {
        kind: 'session' | 'phone_conversation' | 'automation' | 'plugin' | 'unknown' | string;
        sessionId?: string;
        sessionPath?: string;
        conversationId?: string;
        conversationType?: 'channel' | 'dm';
        taskId?: string;
        pluginId?: string;
        [key: string]: unknown;
    };
}
export interface HanaUsageLedgerEntry {
    schemaVersion: 1;
    requestId: string;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    status: 'ok' | 'error' | 'aborted' | 'usage_missing';
    source: HanaUsageSource;
    attribution: HanaUsageAttribution;
    model: {
        provider: string | null;
        modelId: string | null;
        api: string | null;
    };
    usage: HanaNormalizedUsage | null;
    rawUsageShape: string | null;
    error: {
        name: string | null;
        message: string | null;
    } | null;
}
export interface HanaUsageListFilter {
    since?: string;
    until?: string;
    attributionKind?: string;
    sessionId?: string;
    sessionPath?: string;
    agentId?: string;
    subsystem?: string;
    operation?: string;
    modelId?: string;
    provider?: string;
    status?: 'ok' | 'error' | 'aborted' | 'usage_missing' | string;
    limit?: number;
}
export interface HanaUsageListResult {
    entries: HanaUsageLedgerEntry[];
    nextCursor: string | null;
}
export interface HanaUsageEventMeta {
    sessionId?: string | null;
    sessionPath?: string | null;
    sessionRef?: HanaSessionRef | null;
}
export interface HanaPluginLogger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
export interface HanaBusHandlerContext {
    serverId: string;
    serverNodeId?: string;
    userId: string;
    studioId: string;
    connectionKind?: 'local' | 'lan' | 'custom_remote' | 'relay' | 'cloud' | string;
    credentialKind?: 'none' | 'loopback_token' | 'device_credential' | 'user_session' | string;
    platformAccountId?: string | null;
    officialServiceKind?: 'relay' | 'cloud_studio' | 'inference' | 'billing' | string | null;
    executionBoundary?: HanaExecutionBoundary;
    pluginId: string;
    bus: HanaEventBus;
    network?: HanaPluginNetwork;
    resources?: HanaPluginResources;
    config?: HanaPluginConfigStore;
    log?: HanaPluginLogger;
    [key: string]: unknown;
}
export interface HanaBusHandlerDefinition<Payload = unknown, Result = unknown, Context extends HanaBusHandlerContext = HanaBusHandlerContext> {
    type: string;
    handle(payload: Payload, ctx: Context): MaybePromise<Result>;
}
export interface HanaPluginContext {
    serverId: string;
    serverNodeId?: string;
    userId: string;
    studioId: string;
    connectionKind?: 'local' | 'lan' | 'custom_remote' | 'relay' | 'cloud' | string;
    credentialKind?: 'none' | 'loopback_token' | 'device_credential' | 'user_session' | string;
    platformAccountId?: string | null;
    officialServiceKind?: 'relay' | 'cloud_studio' | 'inference' | 'billing' | string | null;
    executionBoundary?: HanaExecutionBoundary;
    pluginId: string;
    pluginDir: string;
    dataDir: string;
    capabilities?: string[];
    sensitiveCapabilities?: string[];
    sessionId?: string | null;
    sessionRef?: HanaSessionRef | null;
    /** @deprecated Use sessionId/sessionRef. Kept for legacy plugins. */
    sessionPath?: string | null;
    bus: HanaEventBus;
    network: HanaPluginNetwork;
    resources: HanaPluginResources;
    config: HanaPluginConfigStore;
    log: HanaPluginLogger;
    registerTool?: (tool: HanaToolDefinition) => () => void;
    registerSessionFile?: (input: Record<string, unknown>) => HanaSessionFile;
    stageFile?: (input: Record<string, unknown>) => HanaStagedSessionFile;
    [key: string]: unknown;
}
export type HanaPluginDisposable = () => void;
export interface HanaPluginLifecycleHelpers {
    register(disposable: HanaPluginDisposable): void;
}
export interface HanaPluginLifecycle {
    onload?(ctx: HanaPluginContext, helpers: HanaPluginLifecycleHelpers): MaybePromise<void>;
    onunload?(ctx: HanaPluginContext): MaybePromise<void>;
}
export interface HanaPluginInstance {
    ctx: HanaPluginContext;
    register: (disposable: HanaPluginDisposable) => void;
    onload?(): MaybePromise<void>;
    onunload?(): MaybePromise<void>;
}
export type HanaTaskStatus = 'pending' | 'running' | 'paused' | 'blocked' | 'recovering' | 'completed' | 'failed' | 'canceled' | 'aborted';
export interface HanaTaskProgress {
    current?: number;
    total?: number;
    percent?: number;
    message?: string;
}
export interface HanaTaskRecord {
    taskId: string;
    type: string;
    parentSessionPath?: string | null;
    pluginId?: string | null;
    agentId?: string | null;
    meta?: Record<string, unknown>;
    progress?: HanaTaskProgress | null;
    status: HanaTaskStatus;
    aborted?: boolean;
    createdAt?: number;
    updatedAt?: number;
    completedAt?: number;
    result?: unknown;
    error?: string;
}
export interface HanaTaskSchedule {
    scheduleId: string;
    type: string;
    pluginId?: string | null;
    agentId?: string | null;
    parentSessionPath?: string | null;
    payload?: unknown;
    meta?: Record<string, unknown>;
    intervalMs?: number | null;
    runAt?: number | string | null;
    enabled?: boolean;
    nextRunAt?: number | null;
    lastRunAt?: number | null;
    lastResult?: unknown;
    lastError?: string | null;
    runCount?: number;
}
export interface HanaTaskRegisterInput {
    taskId: string;
    type: string;
    parentSessionPath?: string | null;
    pluginId?: string | null;
    agentId?: string | null;
    meta?: Record<string, unknown>;
    persist?: boolean;
}
export interface HanaTaskUpdateInput {
    taskId: string;
    status?: HanaTaskStatus;
    progress?: HanaTaskProgress | null;
    meta?: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
    parentSessionPath?: string | null;
    pluginId?: string | null;
    agentId?: string | null;
}
export interface HanaTaskScheduleInput {
    scheduleId: string;
    type: string;
    pluginId?: string | null;
    agentId?: string | null;
    parentSessionPath?: string | null;
    payload?: unknown;
    meta?: Record<string, unknown>;
    intervalMs?: number;
    runAt?: number | string | Date;
    enabled?: boolean;
}
export declare function defineTool<Input = unknown, Output = unknown>(definition: HanaToolDefinition<Input, Output>): HanaToolDefinition<Input, Output> & {
    parameters: JsonSchema;
};
export declare function defineCommand<Context = HanaCommandContext>(definition: HanaCommandDefinition<Context>): HanaCommandDefinition<Context>;
export declare function defineProvider<T extends HanaProviderDefinition>(definition: T): T;
export declare function defineBusHandler<Payload = unknown, Result = unknown, Context extends HanaBusHandlerContext = HanaBusHandlerContext>(definition: HanaBusHandlerDefinition<Payload, Result, Context>): HanaBusHandlerDefinition<Payload, Result, Context>;
export declare function requestBus<Result = unknown, Payload = unknown>(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, type: string, payload?: Payload, options?: Record<string, unknown>): Promise<Result>;
export declare function createChatSurfaceCard(ctx: {
    pluginId?: string | null;
}, target: HanaSessionTarget, options?: HanaChatSurfaceCardOptions): HanaChatSurfaceCardDetails;
export declare function createSession(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input?: HanaSessionCreateInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function getSession(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, target: HanaSessionTarget, options?: Record<string, unknown>): Promise<unknown>;
export declare function listSessions(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, filter?: HanaSessionListFilter, options?: Record<string, unknown>): Promise<unknown>;
export declare function updateSession(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, target: HanaSessionTarget, patch: HanaSessionUpdateInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function sendSessionMessage(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, target: HanaSessionTarget, input: HanaSessionSendInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function subscribeSessionEvents(ctx: {
    bus?: Pick<HanaEventBus, 'subscribe'> | null;
}, target: HanaSessionTarget, handler: (event: unknown, meta: {
    sessionId: string | null;
    sessionPath: string | null;
    sessionRef: HanaSessionRef | null;
}) => void): () => void;
export declare function listAgents(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, filter?: {
    ownerPluginId?: string;
    includePluginPrivate?: boolean;
}, options?: Record<string, unknown>): Promise<unknown>;
export declare function getAgentProfile(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, agentId: string, options?: Record<string, unknown>): Promise<unknown>;
export declare function createAgent(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaAgentCreateInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function updateAgent(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, agentId: string, patch: HanaAgentUpdateInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function sampleText(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaModelSampleInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function listMediaProviders(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, filter?: HanaMediaProviderFilter, options?: Record<string, unknown>): Promise<unknown>;
export declare function resolveMediaModel(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, ref: HanaMediaModelRef, options?: Record<string, unknown>): Promise<unknown>;
export declare function generateImage(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaGenerateImageInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function generateVideo(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaGenerateVideoInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function generateMedia(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaGenerateMediaInput, options?: Record<string, unknown>): Promise<unknown>;
export declare function transcribeAudio(ctx: {
    pluginId?: string | null;
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaTranscribeAudioInput, options?: Record<string, unknown>): Promise<HanaTranscribeAudioResult>;
export declare function listUsageEntries(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, filter?: HanaUsageListFilter, options?: Record<string, unknown>): Promise<HanaUsageListResult>;
export declare function subscribeUsageEvents(ctx: {
    bus?: Pick<HanaEventBus, 'subscribe'> | null;
}, handler: (entry: HanaUsageLedgerEntry, meta: HanaUsageEventMeta) => void): () => void;
export declare function registerTask(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaTaskRegisterInput): Promise<{
    ok: true;
}>;
export declare function updateTask(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaTaskUpdateInput): Promise<{
    ok: true;
    task: HanaTaskRecord;
}>;
export declare function completeTask(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, taskId: string, result?: unknown): Promise<{
    ok: true;
    task: HanaTaskRecord;
}>;
export declare function failTask(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, taskId: string, error: unknown): Promise<{
    ok: true;
    task: HanaTaskRecord;
}>;
export declare function cancelTask(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, taskId: string, reason?: string): Promise<{
    result: string;
    canceled: boolean;
}>;
export declare function scheduleTask(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, input: HanaTaskScheduleInput): Promise<{
    ok: true;
    schedule: HanaTaskSchedule;
}>;
export declare function unscheduleTask(ctx: {
    bus?: Pick<HanaEventBus, 'request'> | null;
}, scheduleId: string): Promise<{
    ok: true;
    removed: boolean;
}>;
export declare function sessionFileToMediaItem(file: HanaSessionFile): HanaSessionFileMediaItem;
type HanaMediaInput = HanaSessionFile | HanaSessionFileMediaItem | HanaStagedSessionFile;
export declare function createMediaDetails(items: HanaMediaInput[]): HanaMediaDetails;
export declare function defineExtension<Pi = unknown>(factory: HanaExtensionFactory<Pi>): HanaExtensionFactory<Pi>;
export declare function definePlugin(lifecycle: HanaPluginLifecycle): new () => HanaPluginInstance;
export {};
