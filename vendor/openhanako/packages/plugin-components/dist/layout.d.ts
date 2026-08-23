import type { HTMLAttributes, ReactNode } from 'react';
export interface CardShellProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
    title?: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    footer?: ReactNode;
    children?: ReactNode;
}
export declare function CardShell({ title, description, actions, footer, children, className, ...sectionProps }: CardShellProps): any;
export interface SettingRowProps extends HTMLAttributes<HTMLDivElement> {
    label: ReactNode;
    hint?: ReactNode;
    control: ReactNode;
    layout?: 'inline' | 'stacked';
}
export declare function SettingRow({ label, hint, control, layout, className, ...rowProps }: SettingRowProps): any;
export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    icon?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
}
export declare function EmptyState({ icon, title, description, action, className, ...rootProps }: EmptyStateProps): any;
export interface ListItem {
    id: string;
    title: ReactNode;
    description?: ReactNode;
    meta?: ReactNode;
    icon?: ReactNode;
    action?: ReactNode;
}
export interface ListProps extends HTMLAttributes<HTMLUListElement> {
    items: ListItem[];
}
export declare function List({ items, className, ...listProps }: ListProps): any;
