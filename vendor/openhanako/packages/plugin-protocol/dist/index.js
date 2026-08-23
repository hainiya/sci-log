export const PLUGIN_UI_PROTOCOL = 'hana.plugin.ui';
export const PLUGIN_UI_PROTOCOL_VERSION = 1;
/**
 * Plugin surface session 的线协议名（#1629）：宿主把会话凭证以
 * `PLUGIN_SURFACE_SESSION_QUERY` 追加在 iframe src 上；iframe 页面调用本插件
 * route handler 时通过 `PLUGIN_SURFACE_SESSION_HEADER`（或同名 query）回传。
 * 服务端、桌面宿主与 iframe SDK 共用这一份定义。
 */
export const PLUGIN_SURFACE_SESSION_HEADER = 'X-Hana-Plugin-Surface-Session';
export const PLUGIN_SURFACE_SESSION_QUERY = 'pluginSurfaceSession';
export const PLUGIN_UI_ERROR_CODE = {
    BAD_MESSAGE: 'BAD_MESSAGE',
    UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
    UNKNOWN_TYPE: 'UNKNOWN_TYPE',
    CAPABILITY_DENIED: 'CAPABILITY_DENIED',
    SLOT_DENIED: 'SLOT_DENIED',
    TIMEOUT: 'TIMEOUT',
    HOST_ERROR: 'HOST_ERROR',
};
export const PLUGIN_UI_CAPABILITY = {
    TOAST_SHOW: 'toast.show',
    EXTERNAL_OPEN: 'external.open',
    SESSION_FILE_OPEN: 'sessionFile.open',
    RESOURCE_OPEN: 'resource.open',
    RESOURCE_PICK: 'resource.pick',
    RESOURCE_REQUEST_ACCESS: 'resource.requestAccess',
    UI_RESIZE: 'ui.resize',
    CLIPBOARD_WRITE_TEXT: 'clipboard.writeText',
};
export const PLUGIN_RESOURCE_CAPABILITY = {
    READ: 'resource.read',
    SEARCH: 'resource.search',
    WRITE: 'resource.write',
    MATERIALIZE: 'resource.materialize',
    WATCH: 'resource.watch',
};
const MESSAGE_KINDS = new Set([
    'event',
    'request',
    'response',
    'error',
]);
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function badMessage(message) {
    return {
        ok: false,
        error: {
            code: PLUGIN_UI_ERROR_CODE.BAD_MESSAGE,
            message,
        },
    };
}
export function parsePluginUiMessage(value) {
    if (!isObject(value)) {
        return badMessage('Plugin UI messages must be objects.');
    }
    if (value.protocol !== PLUGIN_UI_PROTOCOL) {
        return badMessage('Plugin UI message protocol is missing or invalid.');
    }
    if (value.version !== PLUGIN_UI_PROTOCOL_VERSION) {
        return {
            ok: false,
            error: {
                code: PLUGIN_UI_ERROR_CODE.UNSUPPORTED_VERSION,
                message: `Unsupported Plugin UI protocol version: ${String(value.version)}.`,
            },
        };
    }
    if (typeof value.kind !== 'string' || !MESSAGE_KINDS.has(value.kind)) {
        return badMessage('Plugin UI message kind is missing or invalid.');
    }
    if (typeof value.type !== 'string' || value.type.trim() === '') {
        return badMessage('Plugin UI message type must be a non-empty string.');
    }
    const kind = value.kind;
    if (kind !== 'event' && (typeof value.id !== 'string' || value.id.trim() === '')) {
        return badMessage(`Plugin UI ${kind} messages must include a non-empty id.`);
    }
    if (kind === 'error') {
        if (!isObject(value.error)) {
            return badMessage('Plugin UI error messages must include an error object.');
        }
        if (typeof value.error.code !== 'string' || value.error.code.trim() === '') {
            return badMessage('Plugin UI error code must be a non-empty string.');
        }
        if (typeof value.error.message !== 'string' || value.error.message.trim() === '') {
            return badMessage('Plugin UI error message must be a non-empty string.');
        }
    }
    return {
        ok: true,
        value: value,
    };
}
export function isPluginUiMessage(value) {
    return parsePluginUiMessage(value).ok;
}
//# sourceMappingURL=index.js.map