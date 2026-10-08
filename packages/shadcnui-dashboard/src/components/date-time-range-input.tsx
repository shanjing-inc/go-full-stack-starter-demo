import { Input } from "../ui/input.js";
import { cn } from "../lib/utils.js";

export interface DateTimeRange {
    from: string;
    to: string;
}

export interface DateTimeRangeInputProps {
    value: DateTimeRange;
    onChange: (value: DateTimeRange) => void;
    className?: string;
}

export function DateTimeRangeInput({ value, onChange, className }: DateTimeRangeInputProps) {
    const inputClassName =
        "flex-none rounded-none border-0 focus-visible:ring-0 sm:flex-1 dark:bg-transparent";

    return (
        <div
            role="group"
            aria-label="时间范围"
            data-slot="date-time-range-input"
            className={cn(
                "flex min-w-0 flex-col items-center overflow-hidden rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:h-8 sm:flex-row dark:bg-input/30",
                className,
            )}
        >
            <Input
                type="datetime-local"
                aria-label="开始时间"
                className={inputClassName}
                value={value.from}
                onChange={(event) => onChange({ ...value, from: event.target.value })}
            />
            <span aria-hidden="true" className="shrink-0 text-sm text-muted-foreground">
                至
            </span>
            <Input
                type="datetime-local"
                aria-label="结束时间"
                className={inputClassName}
                value={value.to}
                onChange={(event) => onChange({ ...value, to: event.target.value })}
            />
        </div>
    );
}
