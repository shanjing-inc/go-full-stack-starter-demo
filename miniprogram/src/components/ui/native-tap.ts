import type { CommonEvent, ITouchEvent } from "@tarojs/components";

/** TD Button/Tag 将原始 tap 整体放入自定义事件的 detail。 */
export type NativeTapEvent = CommonEvent<
    Pick<ITouchEvent, "detail" | "touches" | "changedTouches">
>;

export function toTouchEvent(event: NativeTapEvent): ITouchEvent {
    const tap = event?.detail;
    return {
        ...event,
        detail: tap?.detail,
        touches: tap?.touches ?? [],
        changedTouches: tap?.changedTouches ?? [],
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
    };
}
