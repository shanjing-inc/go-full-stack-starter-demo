export type DividerProps = JSX.IntrinsicElements["t-divider"];

export function Divider({ className = "", ...props }: DividerProps) {
    return <t-divider {...props} className={className} />;
}
