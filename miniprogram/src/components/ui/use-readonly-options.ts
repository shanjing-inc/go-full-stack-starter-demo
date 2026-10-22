import { useMemo } from "react";

/** TD 1.17.0 的组只读状态需通过 options 同步到每个原生子项。 */
export function useReadonlyOptions<T extends string | number | object>(
    options: T[] | undefined,
    readonly: boolean | undefined,
    keys?: { label?: string; value?: string },
) {
    const labelKey = keys?.label ?? "label";
    const valueKey = keys?.value ?? "value";
    return useMemo(
        () =>
            readonly
                ? options?.map((option) => {
                      if (typeof option === "object") return { ...option, readonly: true };
                      const value = typeof option === "number" ? option : String(option);
                      return {
                          label: String(option),
                          value,
                          [labelKey]: String(option),
                          [valueKey]: value,
                          readonly: true,
                      };
                  })
                : // 解除只读也要触发官方 options observer，恢复调用方原有的单项状态。
                  options?.slice(),
        [options, readonly, labelKey, valueKey],
    );
}
