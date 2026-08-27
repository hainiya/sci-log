export const HANA_BUS_SKIP = Symbol.for('hana.event-bus.skip');
export function getPluginRequestContext(c) {
    if (!c || typeof c.get !== 'function') {
        throw new Error('getPluginRequestContext requires a Hono context with c.get(name)');
    }
    const requestContext = c.get('pluginRequestContext');
    if (!requestContext || typeof requestContext !== 'object') {
        throw new Error('getPluginRequestContext must be called inside a Hana plugin route handler');
    }
    const bus = requestContext.bus;
    const request = bus && typeof bus === 'object'
        ? bus.request
        : null;
    if (typeof request !== 'function') {
        throw new Error('getPluginRequestContext found an invalid plugin route request context');
    }
    return requestContext;
}
const EMPTY_PARAMETERS = { type: 'object', properties: {} };
export function defineTool(definition) {
    return {
        ...definition,
        parameters: definition.parameters ?? EMPTY_PARAMETERS,
    };
}
export function defineCommand(definition) {
    return { ...definition };
}
export function defineProvider(definition) {
    return definition;
}
export function defineBusHandler(definition) {
    return { ...definition };
}
export function requestBus(ctx, type, payload, options) {
    if (!ctx.bus || typeof ctx.bus.request !== 'function') {
        throw new Error('plugin bus request unavailable');
    }
    return ctx.bus.request(type, payload, options);
}
function pluginIdFromContext(ctx) {
    return typeof ctx.pluginId === 'string' && ctx.pluginId.length > 0 ? ctx.pluginId : null;
}
function withOwnerPlugin(ctx, input) {
    const pluginId = pluginIdFromContext(ctx);
    if (!pluginId || input.ownerPluginId)
        return input;
    return { ...input, ownerPluginId: pluginId };
}
function withContextMetadata(ctx, context) {
    const pluginId = pluginIdFromContext(ctx);
    if (!pluginId)
        return context;
    if (!context) {
        return { metadata: { pluginId } };
    }
    return {
        ...context,
        metadata: {
            pluginId,
            ...(context.metadata || {}),
        },
    };
}
function textOrNull(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function normalizeSessionTarget(target) {
    if (typeof target === 'string')
        return { sessionPath: target };
    if (!target || typeof target !== 'object')
        return { sessionPath: target };
    const sessionId = textOrNull(target.sessionId);
    const sessionPath = textOrNull(target.sessionPath) || textOrNull(target.path);
    const legacySessionPath = textOrNull(target.legacySessionPath);
    if (!sessionId) {
        return sessionPath ? { sessionPath } : {};
    }
    const sessionRef = {
        sessionId,
        ...(sessionPath ? { sessionPath } : {}),
        ...(legacySessionPath ? { legacySessionPath } : {}),
    };
    return {
        sessionId,
        ...(sessionPath ? { sessionPath } : {}),
        ...(legacySessionPath ? { legacySessionPath } : {}),
        sessionRef,
    };
}
function sessionRefFromTarget(target) {
    const payload = normalizeSessionTarget(target);
    return payload.sessionRef || null;
}
export function createChatSurfaceCard(ctx, target, options = {}) {
    const pluginId = pluginIdFromContext(ctx);
    if (!pluginId) {
        throw new Error('createChatSurfaceCard requires ctx.pluginId');
    }
    const payload = normalizeSessionTarget(target);
    const sessionId = textOrNull(payload.sessionId);
    const sessionPath = textOrNull(payload.sessionPath);
    if (!sessionId) {
        throw new Error('createChatSurfaceCard requires sessionId or sessionRef; sessionPath alone is legacy locator metadata');
    }
    const sessionRef = {
        sessionId,
        ...(sessionPath ? { sessionPath } : {}),
    };
    return {
        type: 'chat.surface',
        pluginId,
        sessionId,
        sessionRef,
        ...(sessionPath ? { sessionPath } : {}),
        ...(options.title ? { title: options.title } : {}),
        description: options.description || 'Plugin private chat session.',
        mode: options.mode || 'transcript',
        ...(options.composer !== undefined ? { composer: options.composer } : {}),
        ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    };
}
export function createSession(ctx, input = {}, options) {
    return requestBus(ctx, 'session:create', withOwnerPlugin(ctx, { ...input }), options);
}
export function getSession(ctx, target, options) {
    return requestBus(ctx, 'session:get', normalizeSessionTarget(target), options);
}
export function listSessions(ctx, filter = {}, options) {
    return requestBus(ctx, 'session:list', filter, options);
}
export function updateSession(ctx, target, patch, options) {
    return requestBus(ctx, 'session:update', {
        ...normalizeSessionTarget(target),
        ...withOwnerPlugin(ctx, { ...patch }),
    }, options);
}
export function sendSessionMessage(ctx, target, input, options) {
    return requestBus(ctx, 'session:send', {
        ...normalizeSessionTarget(target),
        ...input,
        context: withContextMetadata(ctx, input.context),
    }, options);
}
export function subscribeSessionEvents(ctx, target, handler) {
    if (!ctx.bus || typeof ctx.bus.subscribe !== 'function') {
        throw new Error('plugin bus subscribe unavailable');
    }
    const filter = normalizeSessionTarget(target);
    const targetRef = sessionRefFromTarget(target);
    return ctx.bus.subscribe((event, scopedSessionPath) => {
        const eventSessionId = event && typeof event === 'object' ? textOrNull(event.sessionId) : null;
        const sessionId = eventSessionId || targetRef?.sessionId || null;
        const sessionPath = scopedSessionPath || targetRef?.sessionPath || null;
        const sessionRef = sessionId ? {
            sessionId,
            ...(sessionPath ? { sessionPath } : {}),
            ...(targetRef?.legacySessionPath ? { legacySessionPath: targetRef.legacySessionPath } : {}),
        } : null;
        handler(event, { sessionId, sessionPath, sessionRef });
    }, filter);
}
export function listAgents(ctx, filter = {}, options) {
    return requestBus(ctx, 'agent:list', filter, options);
}
export function getAgentProfile(ctx, agentId, options) {
    return requestBus(ctx, 'agent:profile', { agentId }, options);
}
export function createAgent(ctx, input, options) {
    return requestBus(ctx, 'agent:create', withOwnerPlugin(ctx, { ...input }), options);
}
export function updateAgent(ctx, agentId, patch, options) {
    return requestBus(ctx, 'agent:update', { agentId, ...withOwnerPlugin(ctx, { ...patch }) }, options);
}
export function sampleText(ctx, input, options) {
    return requestBus(ctx, 'model:sample-text', {
        ...input,
        ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
    }, options);
}
export function listMediaProviders(ctx, filter = {}, options) {
    return requestBus(ctx, 'provider:media-providers', filter, options);
}
export function resolveMediaModel(ctx, ref, options) {
    return requestBus(ctx, 'provider:resolve-media-model', ref, options);
}
export function generateImage(ctx, input, options) {
    return requestBus(ctx, 'media:generate-image', {
        ...input,
        ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
    }, options);
}
export function generateVideo(ctx, input, options) {
    return requestBus(ctx, 'media:generate-video', {
        ...input,
        ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
    }, options);
}
export function generateMedia(ctx, input, options) {
    return requestBus(ctx, 'media:generate', {
        ...input,
        ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
    }, options);
}
export function transcribeAudio(ctx, input, options) {
    return requestBus(ctx, 'media:transcribe-audio', {
        ...input,
        ...(pluginIdFromContext(ctx) ? { pluginId: pluginIdFromContext(ctx) } : {}),
    }, options).then(normalizeTranscribeAudioResult);
}
function normalizeTranscribeAudioResult(result) {
    if (result && typeof result === 'object' && result.ok === true
        && Object.prototype.hasOwnProperty.call(result, 'transcription')) {
        return result;
    }
    return { ok: true, transcription: result };
}
export function listUsageEntries(ctx, filter = {}, options) {
    return requestBus(ctx, 'usage:list', filter, options);
}
export function subscribeUsageEvents(ctx, handler) {
    if (!ctx.bus || typeof ctx.bus.subscribe !== 'function') {
        throw new Error('plugin bus subscribe unavailable');
    }
    return ctx.bus.subscribe((event, sessionPath) => {
        if (!event || typeof event !== 'object')
            return;
        const typed = event;
        if (typed.type !== 'llm_usage')
            return;
        const entry = typed.entry;
        const entrySessionId = textOrNull(entry?.attribution?.sessionId)
            || textOrNull(entry?.source?.actor?.sessionId)
            || textOrNull(entry?.source?.parent?.sessionId);
        const entrySessionPath = textOrNull(entry?.attribution?.sessionPath)
            || textOrNull(entry?.source?.actor?.sessionPath)
            || textOrNull(entry?.source?.parent?.sessionPath)
            || textOrNull(sessionPath);
        handler(entry, {
            ...(entrySessionId ? { sessionId: entrySessionId } : {}),
            sessionPath: entrySessionPath,
            ...(entrySessionId ? {
                sessionRef: {
                    sessionId: entrySessionId,
                    ...(entrySessionPath ? { sessionPath: entrySessionPath } : {}),
                },
            } : {}),
        });
    }, { types: ['llm_usage'] });
}
export function registerTask(ctx, input) {
    return requestBus(ctx, 'task:register', input);
}
export function updateTask(ctx, input) {
    return requestBus(ctx, 'task:update', input);
}
export function completeTask(ctx, taskId, result) {
    return requestBus(ctx, 'task:complete', { taskId, result });
}
export function failTask(ctx, taskId, error) {
    return requestBus(ctx, 'task:fail', { taskId, error });
}
export function cancelTask(ctx, taskId, reason) {
    return requestBus(ctx, 'task:cancel', { taskId, reason });
}
export function scheduleTask(ctx, input) {
    return requestBus(ctx, 'task:schedule', input);
}
export function unscheduleTask(ctx, scheduleId) {
    return requestBus(ctx, 'task:unschedule', { scheduleId });
}
export function sessionFileToMediaItem(file) {
    const fileId = firstText(file.fileId, file.id);
    if (!fileId) {
        throw new Error('SessionFile media item requires id or fileId');
    }
    const item = {
        type: 'session_file',
        fileId,
    };
    assignDefined(item, 'sessionId', file.sessionId);
    assignDefined(item, 'sessionPath', file.sessionPath);
    assignDefined(item, 'filePath', file.filePath);
    assignDefined(item, 'label', firstText(file.label, file.displayName, file.filename));
    assignDefined(item, 'mime', file.mime);
    assignDefined(item, 'size', file.size);
    assignDefined(item, 'kind', file.kind);
    return item;
}
export function createMediaDetails(items) {
    return {
        media: {
            items: items.map(normalizeMediaItem),
        },
    };
}
export function defineExtension(factory) {
    return factory;
}
export function definePlugin(lifecycle) {
    return class DefinedHanaPlugin {
        ctx;
        register;
        async onload() {
            await lifecycle.onload?.(this.ctx, { register: this.register });
        }
        async onunload() {
            await lifecycle.onunload?.(this.ctx);
        }
    };
}
function normalizeMediaItem(input) {
    if (isRecord(input) && isRecord(input.mediaItem)) {
        return normalizeSessionFileMediaItem(input.mediaItem);
    }
    if (isRecord(input) && input.type === 'session_file') {
        return normalizeSessionFileMediaItem(input);
    }
    if (isRecord(input)) {
        return sessionFileToMediaItem(input);
    }
    throw new Error('media details item must be a SessionFile, staged file, or session_file media item');
}
function normalizeSessionFileMediaItem(input) {
    if (input.type !== 'session_file') {
        throw new Error('media details item must be a session_file media item');
    }
    const fileId = firstText(input.fileId);
    if (!fileId) {
        throw new Error('SessionFile media item requires fileId');
    }
    return {
        ...input,
        type: 'session_file',
        fileId,
    };
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function firstText(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }
    return undefined;
}
function assignDefined(target, key, value) {
    if (value !== undefined && value !== null) {
        target[key] = value;
    }
}
