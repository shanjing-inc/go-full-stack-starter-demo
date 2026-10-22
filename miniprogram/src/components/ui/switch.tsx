/** 使用 value/customValue；变化值从 event.detail.value 读取。 */
export type SwitchProps = JSX.IntrinsicElements["t-switch"];

export function Switch({ disabled, loading, onChange, ...props }: SwitchProps) {
    return (
        <t-switch
            {...props}
            disabled={disabled}
            loading={loading}
            onChange={(event) => {
                if (!disabled && !loading) onChange?.(event);
            }}
        />
    );
}
