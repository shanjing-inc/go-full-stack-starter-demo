import { Routes, Route } from "react-router";
import { QueuePage, QueueSchedulesPage } from "@shanjing/shadcnui-dashboard";

/** 同步组合队列路由，保留列表与详情的路径参数。 */
export default function QueueRoutes() {
    return (
        <Routes>
            <Route index element={<QueuePage />} />
            <Route path="schedules" element={<QueueSchedulesPage />} />
            <Route path="jobs/:status" element={<QueuePage />} />
            <Route path="jobs/:status/:recordId" element={<QueuePage />} />
            <Route path="*" element={<h1>页面不存在</h1>} />
        </Routes>
    );
}
