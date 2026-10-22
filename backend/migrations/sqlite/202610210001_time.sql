-- 由 Atlas 按文件事务执行；先备份并移除子表，再重建父表，避免触发 ON DELETE CASCADE。

-- 历史无时区字面值按 UTC 解释；带 offset 的 RFC3339 / Go time.String 保留绝对时间。

-- 保留 datetime 声明供驱动解码，实际存储为 INTEGER epoch seconds。

CREATE TEMP TABLE __time_value (table_name text NOT NULL, row_id integer NOT NULL, column_name text NOT NULL, value, instant integer, PRIMARY KEY(table_name,row_id,column_name));

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'user',id,'ban_expires',`ban_expires` FROM `user`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'user',id,'created_at',`created_at` FROM `user`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'user',id,'updated_at',`updated_at` FROM `user`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'session',id,'expires_at',`expires_at` FROM `session`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'session',id,'created_at',`created_at` FROM `session`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'session',id,'updated_at',`updated_at` FROM `session`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'account',id,'access_token_expires_at',`access_token_expires_at` FROM `account`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'account',id,'refresh_token_expires_at',`refresh_token_expires_at` FROM `account`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'account',id,'created_at',`created_at` FROM `account`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'account',id,'updated_at',`updated_at` FROM `account`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'verification',id,'expires_at',`expires_at` FROM `verification`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'verification',id,'created_at',`created_at` FROM `verification`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'verification',id,'updated_at',`updated_at` FROM `verification`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'shop',id,'created_at',`created_at` FROM `shop`;

INSERT INTO __time_value (table_name,row_id,column_name,value) SELECT 'shop',id,'updated_at',`updated_at` FROM `shop`;

-- 旧驱动允许单数字小时；先补零，后续固定位置校验仍拒绝非法时钟值。
UPDATE __time_value SET value = substr(value,1,11) || '0' || substr(value,12)
WHERE typeof(value) = 'text' AND substr(value,11,1) IN (' ','T') AND substr(value,12,2) GLOB '[0-9]:';

-- 旧驱动先移除末尾 Z 再解析数字 offset；Z 不应覆盖已给定的 offset。
UPDATE __time_value SET value = substr(value,1,length(value)-1)
WHERE typeof(value) = 'text' AND substr(value,-1) IN ('Z','z') AND substr(value,-7,1) IN ('+','-') AND substr(value,-6,5) GLOB '[0-9][0-9]:[0-9][0-9]';

-- 旧驱动的 time.Parse 同时支持点与逗号小数秒；仅归一秒后且紧接数字的分隔符。
-- 以下日历／时钟检查及 unixepoch 校验仍须通过，不能将其他逗号或非法小数转换为有效值。
UPDATE __time_value SET value = substr(value,1,19) || '.' || substr(value,21)
WHERE typeof(value) = 'text' AND substr(value,20,1) = ',' AND substr(value,21,1) GLOB '[0-9]';

UPDATE __time_value SET instant = CASE
    WHEN typeof(value) = 'integer' THEN value
    -- unixepoch 会归一化非法日历日期；先按墙上时间校验，避免 offset 跨日掩盖错误。
    WHEN typeof(value) <> 'text' OR substr(value,1,10) NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date(substr(value,1,10), '+0 days') IS NULL OR date(substr(value,1,10), '+0 days') <> substr(value,1,10) THEN NULL
    WHEN length(value) > 11 AND (substr(value,11,1) NOT IN (' ','T') OR substr(value,12,5) NOT GLOB '[0-2][0-9]:[0-5][0-9]' OR substr(value,12,2) > '23') THEN NULL
    WHEN length(value) > 17 AND substr(value,17,3) NOT GLOB ':[0-5][0-9]' THEN NULL
    WHEN length(value) IN (10,16) THEN unixepoch(value)
    WHEN length(value) IN (11,17) AND substr(value,-1) IN ('Z','z') THEN unixepoch(substr(value,1,length(value)-1))
    WHEN instr(value, ' +') > 0 AND unixepoch(substr(value,1,instr(value, ' +')-1) || substr(value,instr(value, ' +')+1,3) || ':' || substr(value,instr(value, ' +')+4,2)) IS NOT NULL THEN unixepoch(substr(value,1,19) || substr(value,instr(value, ' +')+1,3) || ':' || substr(value,instr(value, ' +')+4,2))
    WHEN instr(value, ' -') > 0 AND unixepoch(substr(value,1,instr(value, ' -')-1) || substr(value,instr(value, ' -')+1,3) || ':' || substr(value,instr(value, ' -')+4,2)) IS NOT NULL THEN unixepoch(substr(value,1,19) || substr(value,instr(value, ' -')+1,3) || ':' || substr(value,instr(value, ' -')+4,2))
    WHEN substr(value,-1) IN ('Z','z') AND unixepoch(value) IS NOT NULL THEN unixepoch(substr(value,1,19) || 'Z')
    WHEN substr(value,-6,1) IN ('+','-') AND unixepoch(value) IS NOT NULL THEN unixepoch(substr(value,1,19) || substr(value,-6))
    WHEN substr(value,-5,1) IN ('+','-') AND unixepoch(substr(value,1,length(value)-5) || substr(value,-5,3) || ':' || substr(value,-2)) IS NOT NULL THEN unixepoch(substr(value,1,19) || substr(value,-5,3) || ':' || substr(value,-2))
    WHEN length(value) = 19 OR (substr(value,20,1) = '.' AND ltrim(substr(value,21),'0123456789') = '') THEN unixepoch(substr(value,1,19))
    ELSE NULL END;

CREATE TEMP TABLE __time_valid (valid integer NOT NULL CHECK(valid = 1));

INSERT INTO __time_valid SELECT CASE WHEN EXISTS (SELECT 1 FROM __time_value WHERE value IS NOT NULL AND instant IS NULL) THEN 0 ELSE 1 END;

UPDATE `user` SET `ban_expires` = (SELECT instant FROM __time_value WHERE table_name='user' AND row_id=`user`.id AND column_name='ban_expires'),
`created_at` = (SELECT instant FROM __time_value WHERE table_name='user' AND row_id=`user`.id AND column_name='created_at'),
`updated_at` = (SELECT instant FROM __time_value WHERE table_name='user' AND row_id=`user`.id AND column_name='updated_at');

UPDATE `session` SET `expires_at` = (SELECT instant FROM __time_value WHERE table_name='session' AND row_id=`session`.id AND column_name='expires_at'),
`created_at` = (SELECT instant FROM __time_value WHERE table_name='session' AND row_id=`session`.id AND column_name='created_at'),
`updated_at` = (SELECT instant FROM __time_value WHERE table_name='session' AND row_id=`session`.id AND column_name='updated_at');

UPDATE `account` SET `access_token_expires_at` = (SELECT instant FROM __time_value WHERE table_name='account' AND row_id=`account`.id AND column_name='access_token_expires_at'),
`refresh_token_expires_at` = (SELECT instant FROM __time_value WHERE table_name='account' AND row_id=`account`.id AND column_name='refresh_token_expires_at'),
`created_at` = (SELECT instant FROM __time_value WHERE table_name='account' AND row_id=`account`.id AND column_name='created_at'),
`updated_at` = (SELECT instant FROM __time_value WHERE table_name='account' AND row_id=`account`.id AND column_name='updated_at');

UPDATE `verification` SET `expires_at` = (SELECT instant FROM __time_value WHERE table_name='verification' AND row_id=`verification`.id AND column_name='expires_at'),
`created_at` = (SELECT instant FROM __time_value WHERE table_name='verification' AND row_id=`verification`.id AND column_name='created_at'),
`updated_at` = (SELECT instant FROM __time_value WHERE table_name='verification' AND row_id=`verification`.id AND column_name='updated_at');

UPDATE `shop` SET `created_at` = (SELECT instant FROM __time_value WHERE table_name='shop' AND row_id=`shop`.id AND column_name='created_at'),
`updated_at` = (SELECT instant FROM __time_value WHERE table_name='shop' AND row_id=`shop`.id AND column_name='updated_at');

CREATE TEMP TABLE __time_sequence AS SELECT name,seq FROM sqlite_sequence;

CREATE TEMP TABLE `__time_user` AS SELECT `id`,`name`,`email`,`email_verified`,`image`,`role`,`banned`,`ban_reason`,`ban_expires`,`created_at`,`updated_at` FROM `user`;

CREATE TEMP TABLE `__time_session` AS SELECT `id`,`expires_at`,`token`,`ip_address`,`user_agent`,`user_id`,`impersonated_by`,`created_at`,`updated_at` FROM `session`;

CREATE TEMP TABLE `__time_account` AS SELECT `id`,`account_id`,`provider_id`,`user_id`,`access_token`,`refresh_token`,`id_token`,`access_token_expires_at`,`refresh_token_expires_at`,`scope`,`password`,`created_at`,`updated_at` FROM `account`;

CREATE TEMP TABLE `__time_verification` AS SELECT `id`,`identifier`,`value`,`expires_at`,`created_at`,`updated_at` FROM `verification`;

DROP TABLE `session`;

DROP TABLE `account`;

DROP TABLE `user`;

DROP TABLE `verification`;

CREATE TABLE `user` (`id` integer PRIMARY KEY AUTOINCREMENT,`name` varchar(255) NOT NULL,`email` varchar(255) NOT NULL,`email_verified` boolean NOT NULL DEFAULT false,`image` text,`role` varchar(255),`banned` boolean DEFAULT false,`ban_reason` text,`ban_expires` datetime,`created_at` datetime NOT NULL DEFAULT (unixepoch()),`updated_at` datetime NOT NULL DEFAULT (unixepoch()));

INSERT INTO `user` (`id`,`name`,`email`,`email_verified`,`image`,`role`,`banned`,`ban_reason`,`ban_expires`,`created_at`,`updated_at`) SELECT `id`,`name`,`email`,`email_verified`,`image`,`role`,`banned`,`ban_reason`,`ban_expires`,`created_at`,`updated_at` FROM `__time_user`;

CREATE INDEX `user_role_idx` ON `user`(`role`);

CREATE UNIQUE INDEX `user_email_unique` ON `user`(`email`);

DROP TABLE `__time_user`;

CREATE TABLE `session` (`id` integer PRIMARY KEY AUTOINCREMENT,`expires_at` datetime NOT NULL,`token` varchar(255) NOT NULL,`ip_address` varchar(255),`user_agent` text,`user_id` integer NOT NULL,`impersonated_by` varchar(255),`created_at` datetime NOT NULL DEFAULT (unixepoch()),`updated_at` datetime NOT NULL DEFAULT (unixepoch()),CONSTRAINT `session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE);

INSERT INTO `session` (`id`,`expires_at`,`token`,`ip_address`,`user_agent`,`user_id`,`impersonated_by`,`created_at`,`updated_at`) SELECT `id`,`expires_at`,`token`,`ip_address`,`user_agent`,`user_id`,`impersonated_by`,`created_at`,`updated_at` FROM `__time_session`;

CREATE INDEX `session_user_id_idx` ON `session`(`user_id`);

CREATE UNIQUE INDEX `session_token_unique` ON `session`(`token`);

DROP TABLE `__time_session`;

CREATE TABLE `account` (`id` integer PRIMARY KEY AUTOINCREMENT,`account_id` varchar(255) NOT NULL,`provider_id` varchar(255) NOT NULL,`user_id` integer NOT NULL,`access_token` text,`refresh_token` text,`id_token` text,`access_token_expires_at` datetime,`refresh_token_expires_at` datetime,`scope` text,`password` text,`created_at` datetime NOT NULL DEFAULT (unixepoch()),`updated_at` datetime NOT NULL DEFAULT (unixepoch()),CONSTRAINT `account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE);

INSERT INTO `account` (`id`,`account_id`,`provider_id`,`user_id`,`access_token`,`refresh_token`,`id_token`,`access_token_expires_at`,`refresh_token_expires_at`,`scope`,`password`,`created_at`,`updated_at`) SELECT `id`,`account_id`,`provider_id`,`user_id`,`access_token`,`refresh_token`,`id_token`,`access_token_expires_at`,`refresh_token_expires_at`,`scope`,`password`,`created_at`,`updated_at` FROM `__time_account`;

CREATE INDEX `account_user_id_idx` ON `account`(`user_id`);

CREATE UNIQUE INDEX `account_provider_account_unique` ON `account`(`provider_id`,`account_id`);

DROP TABLE `__time_account`;

CREATE TABLE `verification` (`id` integer PRIMARY KEY AUTOINCREMENT,`identifier` varchar(255) NOT NULL,`value` text NOT NULL,`expires_at` datetime NOT NULL,`created_at` datetime NOT NULL DEFAULT (unixepoch()),`updated_at` datetime NOT NULL DEFAULT (unixepoch()));

INSERT INTO `verification` (`id`,`identifier`,`value`,`expires_at`,`created_at`,`updated_at`) SELECT `id`,`identifier`,`value`,`expires_at`,`created_at`,`updated_at` FROM `__time_verification`;

CREATE INDEX `verification_identifier_idx` ON `verification`(`identifier`);

DROP TABLE `__time_verification`;

UPDATE sqlite_sequence SET seq = max(seq,coalesce((SELECT seq FROM __time_sequence WHERE name = sqlite_sequence.name),0));

DROP TABLE __time_sequence;

DROP TABLE __time_valid;

DROP TABLE __time_value;
