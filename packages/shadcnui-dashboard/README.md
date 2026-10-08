# @shanjing/shadcnui-dashboard

团队复用的 React Dashboard 框架，提供侧栏、导航、会话展示、退出入口、主题、字号与基础 UI。应用维护路由、业务页面、菜单和 API adapter。

## 接入

使用 React 19、React Router 8 与 Tailwind CSS v4。CSS 由应用的 Tailwind 编译链处理；同时扫描包的组件产物：

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@shanjing/shadcnui-dashboard/styles.css";
@source "../node_modules/@shanjing/shadcnui-dashboard/dist";
```

`@source` 路径以应用 CSS 文件所在位置为基准调整。工作区 demo 同时扫描公共源码，支持 Vite HMR。

```tsx
import { BrowserRouter } from "react-router";
import { LayoutDashboardIcon } from "lucide-react";
import { Dashboard, type DashboardAdapter } from "@shanjing/shadcnui-dashboard";

const adapter: DashboardAdapter = {
    async getSession(signal) {
        const response = await fetch("/api/session", { signal, credentials: "include" });
        if (!response.ok) throw new Error("会话读取失败");
        return response.json();
    },
    async getSystemData<T>(resource: string, signal: AbortSignal): Promise<T> {
        const response = await fetch(`/api/system/${encodeURIComponent(resource)}`, { signal });
        if (!response.ok) throw new Error("系统数据读取失败");
        return response.json();
    },
    async signOut() {
        const response = await fetch("/api/sign-out", { method: "POST", credentials: "include" });
        if (!response.ok) throw new Error("退出失败");
        location.assign("/admin/login");
    },
};

export function App() {
    return (
        <BrowserRouter basename="/admin">
            <Dashboard
                adapter={adapter}
                title="团队后台"
                storageKey="my-app"
                navItems={[
                    { id: "home", title: "概览", url: "/", icon: LayoutDashboardIcon, items: [] },
                ]}
            >
                <h1>业务页面</h1>
            </Dashboard>
        </BrowserRouter>
    );
}
```

## 接口

- `DashboardAdapter`：`getSession(signal)`、`getSystemData<T>(resource, signal)`、`signOut()`，以及可选的 `getUsers(query, signal)`。
- `DashboardSession`：`user`、`permissions`，以及可选 `mode`；`development` 展示开发提示。
- `DashboardNavItem`：唯一 `id`、标题、图标、应用内 URL、子项和可选权限标识。
- `useDashboardAdapter`／`useDashboardSession`：业务页面读取当前接入器与会话。
- `useDashboardPreferences`：主题与 16／17／18 字号；localStorage key 用 `storageKey` 隔离应用。
- `Button`、`Card`、`Table`、`Input`、`Select`、`Sheet`、`Avatar` 与对应组合组件。
- `DataTable`／`DataTableColumn`：带边框、横向滚动的列表表格，支持自定义列和加载／空态内容。
- `TablePagination`：10／20／50 条分页选择、翻页与数量说明；`hasNext` 支持应用通过额外读取一条判断下一页，`totalCount` 支持已有总数接口，`pageSizeOptions` 支持应用配置其他分页数量。
- `StatusBadge`：状态配色及可选展示标签；`DateTimeCell`／`formatDashboardDateTime`：统一日期时间展示，formatter 支持语言与时区配置。

列表组件及 `Select` 沿用 Node.js 版 Dashboard 的实现与样式，创建表单可复用 `Sheet` 抽屉。查询、筛选、URL 状态、请求取消与创建流程由应用页面维护。

导航权限用于菜单可见性；服务端处理身份校验、授权与数据隔离。应用 adapter 负责会话过期、退出与后续身份策略。

## 侧栏与页面标题

侧栏沿用 Node.js 参考后台的工作空间切换器、图标折叠、边轨和 Ctrl／Command+B 快捷键。默认宽度为 `16rem`，折叠宽度为 `3rem`；1024–1279px 自动收窄为图标栏，窄于 1024px 使用移动抽屉。底部用户区显示头像、名称和邮箱，折叠后保留头像入口；用户菜单支持退出、等待锁定、失败提示与重试。移动端导航后关闭抽屉。

顶栏使用 `h-14`、竖分隔线和“应用名 / 当前页面”面包屑，应用名称通过 SPA 链接返回首页；移动端保留当前页面标题。标题从当前可见导航的顶级项／子项解析，查询参数、锚点和尾部斜杠保持同一标题，未知路径回落为“页面不存在”。展开／折叠与用户菜单交互保持本地状态处理，会话和业务请求继续由应用适配器维护。

## 主题与字号偏好

右上角字号入口沿用 Node.js 参考后台：字形图标按钮、当前字号 Tooltip、右对齐单选菜单，提供紧凑 16px／标准 17px／舒展 18px，默认标准。按钮可访问名称包含当前选项，菜单支持键盘导航、选中状态及关闭后焦点恢复；与主题按钮保持 `gap-2`。

字号应用于根元素，字号与 rem 布局同步缩放。偏好继续使用 localStorage 的 `${storageKey}:font-size` 数字值，`storageKey` 默认 `dashboard`；`useDashboardPreferences()` 保持数字类型接口。旧版 14px 自动迁移为紧凑 16px，已有 16px／18px 设置继续保留，缺失或异常值恢复标准 17px。存储受限时当前页面仍可调整，刷新使用默认设置。字号操作保持本地处理，追加数据请求为零。

## 构建与发布边界

`pnpm build:dashboard` 清理旧产物并输出 ESM、类型声明、声明映射和 CSS。npm 包只包含 `dist` 与使用文档，开发源码 alias 限于工作区联调。私有 registry 配置在 `publishConfig`；发布授权、凭据、版本号与发布后 demo 组合验收进入发布专项。

组件文件与上下文 Hook 分文件维护，demo 启动文件与 App 分离，保持 React Fast Refresh 组件边界。单测覆盖权限菜单过滤、表格空态与边框、状态标签、日期时间格式以及分页锁定；demo Playwright 覆盖真实 API、主题／字号、退出、深链与移动侧栏。完整验收通过公共 Dashboard 源码变更与窗口标记验证 HMR。

## 公共用户列表与管理（R2 第一／二批）

`UserList` 提供用户列表与权限控制的管理操作，放在应用 React Router 的 `/users` 路由；应用菜单配置 `permission: "user:list"`。组件通过 `useDashboardAdapter()` 调用可选 `getUsers(query, signal)`，应用负责 GraphQL／REST 传输、错误转换及服务端权限。

查询接口使用 `DashboardUserListQuery` 和 `DashboardUserItem`；页面展示用户头像／姓名／邮箱、角色、验证、封禁与时间字段，复用参考列表的独立筛选区域、表格与分页样式。邮箱包含、角色精确匹配、封禁／邮箱验证、页码与页大小保存到 URL；每页 10／20／50 条，通过额外读取一条判定下一页。

缺少 `user:list` 时展示 403，用户查询保持零调用。URL 异常参数回落安全值，AbortController 隔离过期响应，错误显示“重试”，刷新及浏览器历史保留筛选。可选 `createUser`／`updateUser`／`revokeUserSessions` 适配器接入创建、名称／角色编辑、封禁／解封和全部会话撤销。入口同时检查适配器能力与字段权限，只读接入保持原行为；删除、完整密码管理和所有权转移按后续批次实施。

## 应用控制共享会话

应用完成身份校验后，可传入 `session={session}`：

```tsx
<Dashboard adapter={adapter} navItems={navItems} session={session}>
    {children}
</Dashboard>
```

传入 `session` 时，Dashboard 直接使用该状态计算菜单并提供 `useDashboardSession()`；传入 `null` 表示身份加载中。省略此属性时，壳层保持调用 `adapter.getSession(signal)` 的原有接入方式，微任务与 AbortSignal 合作处理 StrictMode effect 重放。应用负责登录失效导航、刷新与注销后的受控状态更新，具体 REST／GraphQL 传输由 adapter 维护。

### 管理动作与身份刷新

`UserList` 可传入 `onCurrentUserChange`，管理当前账号后由应用刷新共享身份；其他账号管理成功只刷新列表一次，保持身份缓存。默认角色选择提供 member／admin／user，已有组合角色显示原值，服务端复核最终授权范围。密码使用 UTF-8 字节校验，封禁时间按浏览器本地时间输入并转换 UTC。

管理弹窗承载字段、错误和确认，提交期间锁定字段，失败保留输入；关闭弹窗及切页会取消等待并忽略迟到回调。已完成的服务端写入保持生效。默认 admin 隐藏 owner 操作，自身隐藏角色与封禁入口，撤销自身会话后应用重新验证身份。样式沿用参考标题工具栏、紧凑按钮、带边框表格和公共 Dialog。标题与筛选／表格／分页之间保持 `gap-6`，创建入口位于刷新前；角色徽标使用 admin 靛蓝、member 天蓝及其他角色中性色。行操作集中于三点下拉菜单，按权限展示编辑、封禁／解封和撤销会话；菜单与弹窗支持键盘导航。创建弹窗使用窄版布局，短屏弹窗可滚动，移动端确认按钮纵向排列。

### 会话列表与单会话撤销（R2 第三批）

适配器可提供 `getUserSessions(userId, { limit, offset }, signal)` 与 `revokeUserSession(userId, sessionId, signal)`。前者返回 `DashboardUserSessionItem[]`，包含会话及用户 ID、IP、User-Agent、三个时间字段和 `current`，认证令牌保留在服务端。

“查看会话”要求 `session:list`，单条撤销要求 `session:revoke`；目标 owner 入口沿用现有管理保护。只接入查询方法即可提供只读会话弹窗。列表每页 10／20／50 条，多读一条判断下一页，撤销末页最后一条后返回前页。

撤销前二次确认，成功刷新当前会话列表；撤销 `current` 会话后调用 `onCurrentUserChange` 重新读取共享身份，应用处理登录跳转。关闭／卸载取消等待，列表与操作错误留在弹窗，键盘关闭后返回行菜单；服务端继续负责最终授权与会话有效性。

## 队列页面

`QueuePage` 为公共队列管理页面；应用接入可选 adapter `getQueueDashboard`、`getQueueRecords`、`getQueueRecord`、`retryQueueRecord` 后配置路由和 `queue:read` 菜单权限。`queue:retry` 控制重试入口，服务端负责最终授权与去重。

应用配置 `/queues`、`/queues/jobs/:status`、`/queues/jobs/:status/:recordId` 三类路由。控制台展示队列数量／在线 Worker／等待／失败四张概览卡、Worker 进程表、队列负载表和最近 24 小时执行次数。列表按 recent／active／completed／failed／waiting 分页展示；recent 汇总所有状态，waiting 包含待执行与延迟记录。延迟状态通过最近任务的 `?status=delayed` 单独筛选。在线能力尚待接入时显示“待接入”与“—”。

列表以 `updatedAt`／`desc` 请求，列包含任务名称链接、入队时间、结束时间、耗时及任务 ID／执行序号，recent 额外显示执行状态。支持队列／类型／状态／时间筛选、20／50／100 条服务端分页、URL 条件与记录深链。详情为独立页面，展示任务信息与参数／结果／选项／堆栈／操作信息，只请求该条详情。返回优先恢复来源列表的筛选与分页；人工重试以 replace 跳转新记录所属状态路径，并保存来源列表。菜单子项可声明 `match`（例如 `/queues/jobs/failed/:recordId`）共享详情标题与活跃状态。每 10 秒刷新；请求取消、错误反馈、重复点击保护和返回来源任务链接或深链列表标题的焦点恢复共用公共交互。详情仅消费服务端脱敏投影。

队列页面聚焦概览、执行记录、详情与计划任务业务信息。平台差异、指标口径与后续范围统一记录于 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`；人工重试保持每次安排一次执行。

`QueueSchedulesPage` 为公共计划任务只读页，应用通过可选 adapter `getQueueSchedules` 接入，路由示例为 `/admin/queues/schedules`，菜单继承 `queue:read`。页面展示注册计划、在线调度器和 Leader 概览、计划定义与启用状态、下次执行、最近派发结果及心跳表，提供刷新、空态、加载、错误恢复和移动端表格滚动。停用计划的下次执行为空。

### Worker 进程信息

Go 控制台按 namespace 展示 `shared` 进程组，三个队列共享每实例的并发池。新增可选 `workerProcesses.concurrency` 展示在线实例一致的共享并发配置；不同配置保持空值，离线展示当前配置。`instances` 支持空值，界面显示“部署管理”；`maxMemory` 为空时采用相同文案。`memoryBytes` 为在线进程 RSS 合计，任一进程缺少有效采样时显示“—”。在线数量、消费者数量和在线状态分别来自公共适配器返回的原生观测。旧适配器保留能力为 false 的待接入展示。
