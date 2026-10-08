export interface DashboardDateTimeFormatOptions {
    locale?: Intl.LocalesArgument;
    timeZone?: string;
}

const defaultLocale = "zh-CN";

export function formatDashboardDateTime(
    value: null | number | string | undefined,
    options: DashboardDateTimeFormatOptions = {},
) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return new Intl.DateTimeFormat(options.locale ?? defaultLocale, {
        dateStyle: "medium",
        hour12: false,
        timeStyle: "medium",
        timeZone: options.timeZone,
    }).format(date);
}
