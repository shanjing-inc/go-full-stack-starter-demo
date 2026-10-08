import { formatDashboardDateTime } from "../date-time.js";

export function DateTimeCell({ value }: { value: null | number | string | undefined }) {
    const formattedValue = formatDashboardDateTime(value);

    if (formattedValue === "-" && value) {
        return <span>{value}</span>;
    }

    if (formattedValue === "-") {
        return <span className="text-muted-foreground">-</span>;
    }

    return <span>{formattedValue}</span>;
}
