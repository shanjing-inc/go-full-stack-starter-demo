import { useTheme } from "../theme/use-theme";

export type CellProps = JSX.IntrinsicElements["t-cell"];
export type CellGroupProps = JSX.IntrinsicElements["t-cell-group"];

export function Cell({ className = "", style, ...props }: CellProps) {
    const { theme } = useTheme();
    const padding = theme.style["--td-cell-horizontal-padding"] ?? "0";
    const spacing: Record<string, string> = { "--td-cell-horizontal-padding": padding };
    return (
        <t-cell
            {...props}
            className={`block ${className}`}
            style={
                typeof style === "string"
                    ? `--td-cell-horizontal-padding:${padding};${style}`
                    : { ...spacing, ...style }
            }
        />
    );
}

export function CellGroup({ className = "", ...props }: CellGroupProps) {
    return <t-cell-group {...props} className={`block ${className}`} />;
}
