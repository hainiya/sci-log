import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
export type HanaButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type HanaButtonSize = 'sm' | 'md' | 'lg';
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
    variant?: HanaButtonVariant;
    size?: HanaButtonSize;
    loading?: boolean;
    iconLeft?: ReactNode;
    iconRight?: ReactNode;
}
export declare const Button: any;
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
    label: string;
    size?: HanaButtonSize;
    variant?: Extract<HanaButtonVariant, 'secondary' | 'ghost' | 'danger'>;
    children: ReactNode;
}
export declare const IconButton: any;
interface FieldBaseProps {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
}
export interface TextInputProps extends FieldBaseProps, InputHTMLAttributes<HTMLInputElement> {
    inputClassName?: string;
}
export declare const TextInput: any;
export interface TextareaProps extends FieldBaseProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
    textareaClassName?: string;
}
export declare const Textarea: any;
export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    checked: boolean;
    onChange?: (checked: boolean) => void;
    label?: ReactNode;
}
export declare const Switch: any;
export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}
export interface SelectProps extends FieldBaseProps {
    options: SelectOption[];
    value: string;
    onChange: (value: string) => void;
    label?: ReactNode;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}
export declare function Select({ options, value, onChange, label, hint, error, placeholder, disabled, className, }: SelectProps): any;
export {};
