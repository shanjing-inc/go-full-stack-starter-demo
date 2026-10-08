import * as React from "react";

const MOBILE_BREAKPOINT_QUERY = "(width < 64rem)";

export function useIsMobile() {
    const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

    React.useEffect(() => {
        const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
        const onChange = () => {
            setIsMobile(mql.matches);
        };
        mql.addEventListener("change", onChange);
        setIsMobile(mql.matches);
        return () => mql.removeEventListener("change", onChange);
    }, []);

    return !!isMobile;
}
