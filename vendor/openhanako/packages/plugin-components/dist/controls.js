import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useId, useState, } from 'react';
import { cx } from './classnames';
export const Button = forwardRef(function Button({ variant = 'secondary', size = 'md', loading = false, iconLeft, iconRight, disabled, className, children, type = 'button', ...buttonProps }, ref) {
    return (_jsxs("button", { ...buttonProps, ref: ref, type: type, disabled: disabled || loading, className: cx('hana-plugin-button', `hana-plugin-button-${variant}`, `hana-plugin-button-${size}`, loading && 'hana-plugin-button-loading', className), children: [loading ? _jsx("span", { className: "hana-plugin-spinner", "aria-hidden": true }) : iconLeft, children && _jsx("span", { className: "hana-plugin-button-label", children: children }), !loading && iconRight] }));
});
export const IconButton = forwardRef(function IconButton({ label, size = 'md', variant = 'ghost', className, children, type = 'button', ...buttonProps }, ref) {
    return (_jsx("button", { ...buttonProps, ref: ref, type: type, "aria-label": label, title: buttonProps.title || label, className: cx('hana-plugin-icon-button', `hana-plugin-icon-button-${size}`, `hana-plugin-icon-button-${variant}`, className), children: children }));
});
export const TextInput = forwardRef(function TextInput({ label, hint, error, id, className, inputClassName, ...inputProps }, ref) {
    const generatedId = useId();
    const inputId = id || generatedId;
    return (_jsx(FieldShell, { label: label, hint: hint, error: error, htmlFor: inputId, className: className, children: _jsx("input", { ...inputProps, ref: ref, id: inputId, "aria-invalid": Boolean(error), className: cx('hana-plugin-input', inputClassName) }) }));
});
export const Textarea = forwardRef(function Textarea({ label, hint, error, id, className, textareaClassName, rows = 4, ...textareaProps }, ref) {
    const generatedId = useId();
    const textareaId = id || generatedId;
    return (_jsx(FieldShell, { label: label, hint: hint, error: error, htmlFor: textareaId, className: className, children: _jsx("textarea", { ...textareaProps, ref: ref, id: textareaId, rows: rows, "aria-invalid": Boolean(error), className: cx('hana-plugin-textarea', textareaClassName) }) }));
});
export const Switch = forwardRef(function Switch({ checked, onChange, label, disabled, className, onClick, type = 'button', ...buttonProps }, ref) {
    const ariaLabel = typeof label === 'string' ? label : buttonProps['aria-label'];
    return (_jsxs("span", { className: cx('hana-plugin-switch-wrap', className), children: [_jsx("button", { ...buttonProps, ref: ref, type: type, role: "switch", "aria-checked": checked, "aria-label": ariaLabel, disabled: disabled, className: cx('hana-plugin-switch', checked && 'hana-plugin-switch-on'), onClick: (event) => {
                    onClick?.(event);
                    if (!event.defaultPrevented && !disabled)
                        onChange?.(!checked);
                }, children: _jsx("span", { className: "hana-plugin-switch-thumb", "aria-hidden": true }) }), label && _jsx("span", { className: "hana-plugin-switch-label", children: label })] }));
});
export function Select({ options, value, onChange, label, hint, error, placeholder = 'Select', disabled = false, className, }) {
    const [open, setOpen] = useState(false);
    const current = options.find((option) => option.value === value);
    const displayText = current?.label || placeholder;
    const labelText = typeof label === 'string' ? label : undefined;
    const buttonLabel = [labelText, displayText].filter(Boolean).join(' ');
    return (_jsx(FieldShell, { label: label, hint: hint, error: error, className: className, children: _jsxs("div", { className: "hana-plugin-select", children: [_jsxs("button", { type: "button", "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": buttonLabel || undefined, disabled: disabled, className: cx('hana-plugin-select-trigger', !current && 'hana-plugin-select-placeholder'), onClick: () => setOpen((next) => !next), children: [_jsx("span", { className: "hana-plugin-select-value", children: displayText }), _jsx("span", { className: "hana-plugin-select-arrow", "aria-hidden": true, children: "\u25BE" })] }), open && (_jsx("div", { className: "hana-plugin-select-popover", role: "listbox", "aria-label": labelText, children: options.map((option) => (_jsx("button", { type: "button", role: "option", "aria-selected": option.value === value, disabled: option.disabled, className: cx('hana-plugin-select-option', option.value === value && 'hana-plugin-select-option-selected'), onClick: () => {
                            if (option.disabled)
                                return;
                            onChange(option.value);
                            setOpen(false);
                        }, children: option.label }, option.value))) }))] }) }));
}
function FieldShell({ label, hint, error, htmlFor, className, children }) {
    return (_jsxs("div", { className: cx('hana-plugin-field', className), children: [label && (_jsx("label", { className: "hana-plugin-field-label", htmlFor: htmlFor, children: label })), hint && _jsx("div", { className: "hana-plugin-field-hint", children: hint }), children, error && _jsx("div", { className: "hana-plugin-field-error", children: error })] }));
}
