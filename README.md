# Go Full Stack Starter Demo

可独立构建的多数据库示例，包含 Go 服务公共模块和 React Dashboard 源码。
当前采用源码快照交付，保留工作区结构；不依赖未发布的私有 Go/npm 包。
上游提交及文件哈希见 demo-release.json。

环境：Linux amd64、Python 3、Node 24、pnpm 11.15.1。
在本仓根目录运行 pnpm setup；工具版本由 toolchain.json 固定。
复制 projects/multi-database-demo/.env.example 为同目录 .env，并填写独立数据库、Redis 和认证密钥。
依次运行 pnpm generate、pnpm migrate、pnpm dev。
检查/测试/构建：pnpm check、pnpm test、pnpm build。
Docker：docker build -f projects/multi-database-demo/Dockerfile .
同一镜像分别运行 /web 和 /worker；迁移先由独立发布步骤执行。

该仓是演示源码同步目标，不是服务器自动部署入口。
真实 .env、凭据、依赖、缓存和运行产物不随同步提交。
少量 poc/web 快照仅用于保留上游格式回归测试，不参与 demo 构建。
目标仓的 .github、.yunxiao 和其他 CI 配置由目标仓自行维护。
