package auth

import (
    "crypto/rand"
    "crypto/subtle"
    "encoding/hex"
    "errors"
    "strings"

    "golang.org/x/crypto/scrypt"
    "golang.org/x/text/unicode/norm"
)

// 旧注册允许 128 个 UTF-16 码元；512 字节覆盖其 UTF-8 输入范围。
// 登录与新密码设置分别限长，保留请求大小及 scrypt 并发门禁。
const maxLoginPasswordBytes = 512

// PasswordHash 保持 Better Auth 1.6.24 的 NFKC 和 scrypt 参数。
func PasswordHash(password string) (string, error) {
    if len(password) < 8 || len(password) > 128 {
        return "", errors.New("密码长度需要 8–128 字节")
    }

    salt := make([]byte, 16)
    if _, err := rand.Read(salt); err != nil {
        return "", err
    }

    saltText := hex.EncodeToString(salt)
    key, err := passwordKey(password, saltText)
    if err != nil {
        return "", err
    }
    return saltText + ":" + hex.EncodeToString(key), nil
}

// passwordSlots 限制同时进行的内存密集型密码派生数量。
var passwordSlots = make(chan struct{}, 4)

// errPasswordBusy 表示本进程的密码派生并发槽已满。
var errPasswordBusy = errors.New("密码验证繁忙")

// passwordKey 执行 NFKC 归一化及 scrypt 派生；四个并发槽满时立即返回繁忙错误。
func passwordKey(password, salt string) ([]byte, error) {
    select {
    case passwordSlots <- struct{}{}:
    default:
        return nil, errPasswordBusy
    }

    defer func() { <-passwordSlots }()
    return scrypt.Key([]byte(norm.NFKC.String(password)), []byte(salt), 16384, 16, 1, 64)
}

// PasswordMatches 校验兼容密码哈希，校验错误统一映射为 false；需要错误原因时由内部校验函数返回。
func PasswordMatches(hash, password string) bool {
    ok, _ := verifyPassword(hash, password)
    return ok
}

// verifyPassword 检查盐与摘要格式后执行恒定时间比较，格式无效时返回 false, nil。
func verifyPassword(hash, password string) (bool, error) {
    parts := strings.Split(hash, ":")
    if len(parts) != 2 || len(parts[0]) != 32 || len(parts[1]) != 128 || len(password) > maxLoginPasswordBytes {
        return false, nil
    }
    if _, err := hex.DecodeString(parts[0]); err != nil {
        return false, nil
    }

    want, err := hex.DecodeString(parts[1])
    if err != nil {
        return false, nil
    }

    key, err := passwordKey(password, parts[0])
    if err != nil {
        return false, err
    }
    return subtle.ConstantTimeCompare(key, want) == 1, nil
}
