package database

import (
    "errors"
    "net"
    "net/url"
    "strconv"
    "strings"

    mysqldriver "github.com/go-sql-driver/mysql"
)

// ParseDSN 从统一连接 URL 推导方言，并转换为对应驱动的原生 DSN。
// 错误使用固定文案，连接 URL 中的账户与密钥始终保持私密。
func ParseDSN(raw string) (driver, dsn string, err error) {
    invalid := errors.New("DB_DSN 需要有效的 mysql://、postgres://、postgresql:// 或 sqlite:// 连接 URL")
    if raw == "" || !strings.Contains(raw, "://") || strings.ContainsAny(raw, " \t\r\n#") {
        return "", "", invalid
    }

    for _, char := range raw {
        if char < 32 || char == 127 {
            return "", "", invalid
        }
    }
    // url.Parse 保留 RawQuery，因此单独校验所有百分号编码。
    for index := 0; index < len(raw); index++ {
        if raw[index] == '%' {
            if index+2 >= len(raw) || !hexDigit(raw[index+1]) || !hexDigit(raw[index+2]) {
                return "", "", invalid
            }

            index += 2
        }
    }

    u, parseErr := url.Parse(raw)
    if parseErr != nil || u.Opaque != "" || u.Fragment != "" {
        return "", "", invalid
    }

    query, parseErr := url.ParseQuery(u.RawQuery)
    if parseErr != nil {
        return "", "", invalid
    }

    driver = strings.ToLower(u.Scheme)
    if driver == "postgresql" {
        driver = "postgres"
    }
    if driver == "sqlite" {
        if u.User != nil || strings.ContainsAny(u.Host, ":[]") || (u.Host == "" && u.Path == "") {
            return "", "", invalid
        }

        dsn = u.Host + u.Path
        if dsn == "/:memory:" {
            dsn = ":memory:"
        }
        if u.RawQuery != "" {
            dsn += "?" + u.RawQuery
        }
        return driver, dsn, nil
    }
    if driver != "mysql" && driver != "postgres" {
        return "", "", invalid
    }
    if u.Hostname() == "" || strings.HasSuffix(u.Host, ":") || !strings.HasPrefix(u.Path, "/") || len(u.Path) <= 1 || strings.Contains(strings.TrimPrefix(u.EscapedPath(), "/"), "/") {
        return "", "", invalid
    }
    if strings.Contains(u.Hostname(), ":") && !strings.HasPrefix(u.Host, "[") {
        return "", "", invalid
    }

    port := u.Port()
    if port != "" {
        number, portErr := strconv.Atoi(port)
        if portErr != nil || number < 1 || number > 65535 {
            return "", "", invalid
        }
    }
    if driver == "postgres" {
        separator := strings.IndexByte(raw, ':')
        return driver, strings.ToLower(raw[:separator]) + raw[separator:], nil
    }
    if u.User == nil || u.User.Username() == "" || strings.Contains(u.User.Username(), ":") {
        return "", "", errors.New("MySQL 连接 URL 需要有效用户名")
    }
    if port == "" {
        port = "3306"
    }

    cfg := mysqldriver.NewConfig()
    cfg.User = u.User.Username()
    cfg.Passwd, _ = u.User.Password()
    cfg.Net = "tcp"
    cfg.Addr = net.JoinHostPort(u.Hostname(), port)
    cfg.DBName = strings.TrimPrefix(u.Path, "/")
    if !query.Has("parseTime") {
        query.Set("parseTime", "true")
    }
    if !query.Has("loc") {
        query.Set("loc", "UTC")
    }

    parsed, parseErr := mysqldriver.ParseDSN(cfg.FormatDSN() + "?" + query.Encode())
    if parseErr != nil {
        return "", "", errors.New("MySQL 连接 URL 参数无效")
    }
    return driver, parsed.FormatDSN(), nil
}

func hexDigit(char byte) bool {
    return char >= '0' && char <= '9' || char >= 'a' && char <= 'f' || char >= 'A' && char <= 'F'
}
