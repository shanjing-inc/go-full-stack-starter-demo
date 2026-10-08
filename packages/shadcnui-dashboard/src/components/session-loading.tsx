import { LoaderCircleIcon } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Skeleton } from "../ui/skeleton.js";

export function SessionLoading({ fullPage = false }: { fullPage?: boolean }) {
    return (
        <div
            data-slot="session-loading"
            className={cn(
                "flex w-full items-center justify-center bg-background p-4 sm:p-6",
                fullPage ? "min-h-svh" : "min-h-72",
            )}
        >
            <div className="w-full max-w-sm px-6 py-8 text-center">
                <div className="flex flex-col items-center gap-3">
                    <div
                        aria-hidden="true"
                        className="flex size-11 shrink-0 items-center justify-center text-muted-foreground"
                    >
                        <LoaderCircleIcon className="size-5 motion-safe:animate-spin" />
                    </div>
                    <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0">
                        <p className="text-sm font-medium">会话加载中</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            正在确认登录状态与访问权限，请稍候。
                        </p>
                    </div>
                </div>
                <div
                    aria-hidden="true"
                    className="mx-auto mt-6 flex w-full max-w-64 flex-col items-center gap-3"
                >
                    <Skeleton className="h-3 w-3/4 motion-reduce:animate-none" />
                    <Skeleton className="h-3 w-full motion-reduce:animate-none" />
                    <Skeleton className="h-3 w-1/2 motion-reduce:animate-none" />
                </div>
            </div>
        </div>
    );
}
