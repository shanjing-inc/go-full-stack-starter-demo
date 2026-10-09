# 店铺列表验收记录

日期：2026-10-04。工作目录：`/home/dream/wwwroot/go-starter`，分支：`feature/email-auth-migration`。本批次提交状态以 Git 历史为准。

## 实现范围

- 后台导航与页面为“店铺列表”，路由 `/admin/shops`。
- 数据库持久化列表，显示 ID／名称／唯一标识／状态／创建时间／更新时间。
- 每页 10／20／50 条、上一页／下一页、URL 状态、slug 模糊筛选及状态精确筛选。
- 加载提示、空态、错误重试、手动刷新；创建成功后回第一页、清除筛选并重新请求。
- GraphQL 沿用 `listShops` 及参考排序输入协议；支持 id／status eq、slug eq／like、六字段排序，limit 0–101、offset≥0。默认创建时间及 ID 降序。
- 页面样式沿用 Node.js 版的独立标题区、紧凑筛选栏、带边框表格及分页栏；复用 `DataTable`、`TablePagination`、`StatusBadge`、`DateTimeCell` 与 Radix `Select`。
- “创建店铺”打开右侧 `Sheet` 抽屉，移动端全宽；支持键盘关闭、焦点回归、重新打开保留表单，提交中锁定关闭。
- 保持认证与数据库迁移历史，手机号登录维持延期决定。

## 本次完整验收（2026-10-04）

`rtk pnpm verify` 完整通过 18 项流程检查，包含 289 条 Go 测试通过记录（含父子用例），耗时 172.69 秒。完整报告：`/home/dream/wwwroot/go-starter/.runtime/project-x243wasc/result.json`。

| 阶段                     | 结果                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 内嵌 SPA 浏览器          | 17／17 通过：认证 6、店铺 7、真实 Dashboard 4                                                                 |
| 宿主机 Vite 开发浏览器   | 同样 17／17 通过                                                                                              |
| 公共 Dashboard 单测      | 7／7 通过                                                                                                     |
| 公共源码 HMR             | 通过，保留窗口标记、整页刷新次数为 0                                                                          |
| Go／数据库／实时／Worker | 隔离真实 MySQL／Redis 与 SQLite、正式迁移及版本登记、双 Web 权限与撤销、GraphQL／REST、WS／SSE 和任务消费通过 |

两组浏览器均为零跳过、失败与 flaky；报告分别为 `/home/dream/wwwroot/go-starter/.runtime/project-x243wasc/browser.json` 和 `/home/dream/wwwroot/go-starter/.runtime/project-x243wasc/browser-dev.json`。四项 Dashboard 使用真实隔离后端；认证／店铺页面回归拦截 API。验收阶段仅重置临时 Redis 中合成账号与本机 IP 的限流计数，保持应用限流配置。

## 历史专项验证（店铺列表样式批次）

| 检查                   | 验证结果                                                            |
| ---------------------- | ------------------------------------------------------------------- |
| `rtk pnpm generate`    | 列表接口补齐时通过，更新 Admin GraphQL 生成产物；样式批次沿用该产物 |
| `rtk pnpm check`       | 通过，包含前端构建、四空格格式检查、Go vet 与 TypeScript 检查       |
| `rtk pnpm test`        | 通过，包含全仓 Go 测试、脚本回归与公共 Dashboard 的 7 项单测        |
| 店铺浏览器回归         | 7／7 通过                                                           |
| 认证浏览器回归         | 5／5 通过，两组共 12 项；耗时以最新报告为准                         |
| `rtk git diff --check` | 通过                                                                |

历史浏览器报告：`/home/dream/wwwroot/go-starter/.runtime/shop-list-style-browser.json`。

浏览器复验命令（先启动前端开发服务）：

```bash
rtk proxy bash -c 'LD_LIBRARY_PATH=/home/dream/wwwroot/go-starter/.tools/browser/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH} TEST_ORIGIN=http://127.0.0.1:5173 BROWSER_REPORT=/home/dream/wwwroot/go-starter/.runtime/shop-list-style-browser.json pnpm --filter multi-database-demo-dashboard exec playwright test tests/shops.spec.ts tests/authentication.spec.ts'
```

测试覆盖：

- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/service/list_test.go`：内存／隔离 SQLite 的排序、首页／中间页／末页、组合筛选、LIKE、空结果、零 limit、无效条件与取消。
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/web/shop_list_test.go`：真实 GraphQL 执行、响应结构、默认排序、优先级排序、分页、筛选及错误码；隔离 SQLite 经 HTTP 创建、关闭并重新打开数据库后查询，验证落库与重启后的列表读取。
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/web/server_test.go`：新增列表字段与排序输入对照固定参考 SDL 的参数及可空性。
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/tests/shops.spec.ts`：七项浏览器回归，覆盖 URL 刷新／历史、筛选、分页、创建后刷新／重复标识、错误／重试、旧响应隔离和移动端；新增明暗主题、Node.js 版组件结构及创建抽屉宽度／关闭／焦点回归验证。
- `/home/dream/wwwroot/go-starter/packages/shadcnui-dashboard/src/table-components.test.ts`：五项公共列表组件单测，配合已有两项权限单测，共七项。
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/tests/authentication.spec.ts`：六项认证页面回归，包含旧多字节密码完整输入与 513 字节客户端门禁。

本节历史浏览器测试拦截 API；Go 数据库测试使用临时隔离 SQLite。完整验收中的四项 Dashboard 浏览器测试连接隔离的真实 Go／MySQL／Redis 后端；六项认证页面与七项店铺页面回归拦截 API。用户 `.env`、人工开发数据库和账号保持原状。

## 人工验收

1. 启动当前开发服务，以已有管理员登录后打开 `/admin/shops`。
2. 检查已有记录，刷新页面后记录继续存在；筛选唯一标识和启停状态，重置后恢复列表。
3. 使用 10 条分页，切换下一页后刷新，页码与数据保持一致。
4. 在筛选结果或第二页点击“创建店铺”，检查右侧抽屉。提交成功后抽屉关闭、清除筛选、返回第一页并显示新记录；再次打开抽屉，使用相同标识验证重复提示。
5. 浏览器离线后点击刷新，验证错误与重试；恢复网络后重试成功。
6. 切换明暗主题，检查标题、筛选、表格边框、状态徽标、日期时间及独立分页栏。切换至移动端，检查筛选自动换行、表格内部横向滚动、创建抽屉全宽，以及取消／Escape 关闭后的焦点回归。

## 样式参考与截图

参考页面：`/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/src/dashboards/admin/pages/shop-list.tsx`。公共组件参考该仓库 `packages/astro-full-stack-starter/src/dashboard/client` 中的表格、分页、状态、时间与 Select 实现。沿用当前中文文案及 active／inactive 状态，创建操作使用参考 Dashboard 的抽屉布局。

本轮完成参考源码／组件样式对齐、当前页面截图人工检查及布局交互断言。参考页面像素级截图差分仍待执行。截图由第七项店铺浏览器测试生成，目录为：

`/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/test-results/shops-Node-js-版页面结构、明暗主题及移动端抽屉/`

- `shops-light.png`：桌面浅色主题。
- `shops-dark.png`：桌面深色主题。
- `shops-mobile-create.png`：390px 移动端创建抽屉。

WSL 浏览器截图环境通过临时 Fontconfig 配置 `/tmp/go-starter-visual-fonts.conf` 引用本机 Windows 微软雅黑字体，解决截图中文字体缺失；应用字体配置保持原状。该配置存在时，可在复验命令中补充 `FONTCONFIG_FILE=/tmp/go-starter-visual-fonts.conf`。

## 验证边界

本次审查修复已同步 `rtk pnpm verify` 的完整认证后流程：隔离真实 MySQL／Redis、固定账号真实初始化与登录、双实例 Cookie／Bearer 权限和退出撤销、完整迁移版本登记、业务与实时测试、两组浏览器及 HMR。Docker／race、真实生产 HTTPS／代理和旧库快照继续登记为环境待验收；旧库模型、详情编辑、删除、关联字段及完整过滤进入 R3 后续批次。生产模式的本地启动检查覆盖配置门禁与进程就绪，生产 TLS 与代理行为留待交付环境验证。
