-- 初始化店铺业务示例；由应用维护最终迁移。
CREATE TABLE `shop` (`id` integer PRIMARY KEY AUTOINCREMENT,`name` varchar(255) NOT NULL,`slug` varchar(255) NOT NULL,`status` varchar(32) NOT NULL DEFAULT "active",`created_at` datetime NOT NULL,`updated_at` datetime NOT NULL);
CREATE INDEX `idx_status` ON `shop`(`status`);
CREATE UNIQUE INDEX `uk_slug` ON `shop`(`slug`);
