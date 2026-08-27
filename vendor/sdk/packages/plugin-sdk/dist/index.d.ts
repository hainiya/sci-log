import { type PluginResourceOpenInput, type PluginResourceOpenResult, type PluginResourcePickInput, type PluginResourcePickResult, type PluginResourceRequestAccessInput, type PluginResourceRequestAccessResult, type PluginUiError } from '@hana/plugin-protocol';
export interface HanaPluginSize {
    width?: number;
    height?: number;
}
export interface HanaPluginThemeSnapshot {
    theme?: string;
    cssUrl?: string;
}
export interface HanaPluginRequestOptions {
    timeoutMs?: number;
}
export type HanaToastType = 'success' | 'error' | 'info' | 'warning';
export interface HanaToastShowInput {
    message: string;
    type?: HanaToastType;
    duration?: number;
}
export interface HanaToastShowResult {
    shown: boolean;
}
export type HanaExternalOpenInput = string | {
    url: string;
};
export interface HanaExternalOpenResult {
    opened: boolean;
}
export type HanaClipboardWriteTextInput = string | {
    text: string;
};
export interface HanaClipboardWriteTextResult {
    written: boolean;
}
export interface HanaPluginSdkOptions {
    parentWindow?: Window;
    targetWindow?: Window;
    targetOrigin?: string;
    requestTimeoutMs?: number;
    idFactory?: () => string;
}
export interface HanaPluginSdk {
    ready(payload?: unknown): void;
    assets: {
        url(path: string): string;
    };
    api: {
        url(path: string): string;
        fetch(path: string, init?: RequestInit): Promise<Response>;
    };
    ui: {
        resize(size: HanaPluginSize): void;
    };
    theme: {
        getSnapshot(): HanaPluginThemeSnapshot;
        subscribe(callback: (theme: HanaPluginThemeSnapshot) => void): () => void;
    };
    host: {
        request<T = unknown>(type: string, payload?: unknown, options?: HanaPluginRequestOptions): Promise<T>;
    };
    toast: {
        show(input: HanaToastShowInput, options?: HanaPluginRequestOptions): Promise<HanaToastShowResult>;
    };
    external: {
        open(input: HanaExternalOpenInput, options?: HanaPluginRequestOptions): Promise<HanaExternalOpenResult>;
    };
    clipboard: {
        writeText(input: HanaClipboardWriteTextInput, options?: HanaPluginRequestOptions): Promise<HanaClipboardWriteTextResult>;
    };
    resources: {
        open(input: PluginResourceOpenInput, options?: HanaPluginRequestOptions): Promise<PluginResourceOpenResult>;
        pick(input?: PluginResourcePickInput, options?: HanaPluginRequestOptions): Promise<PluginResourcePickResult>;
        requestAccess(input: PluginResourceRequestAccessInput, options?: HanaPluginRequestOptions): Promise<PluginResourceRequestAccessResult>;
    };
}
export declare class HanaPluginError extends Error {
    name: string;
    readonly code: string;
    readonly details?: unknown;
    constructor(error: PluginUiError);
}
export declare function createHanaPluginSdk(options?: HanaPluginSdkOptions): HanaPluginSdk;
export declare const hana: HanaPluginSdk;
//# sourceMappingURL=index.d.ts.map