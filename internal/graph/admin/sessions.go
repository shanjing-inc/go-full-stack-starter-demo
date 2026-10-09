package admin

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "strconv"
)

// sessionManagementID 将 GraphQL 字符串 ID 转为数据库 int 正整数，限制在有符号 32 位范围内。
func sessionManagementID(value string) (int, error) {
    id, err := strconv.Atoi(value)
    if err != nil || id <= 0 || id > 2147483647 {
        return 0, &httperr.Error{Code: "BAD_USER_INPUT", Message: "用户及会话 ID 需要有效的正整数"}
    }
    return id, nil
}
