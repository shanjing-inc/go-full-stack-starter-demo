package database

import (
    "errors"
    "gorm.io/gorm"
    sqlite "modernc.org/sqlite"
)

// IsDuplicate 覆盖 GORM 的 MySQL／PostgreSQL 转译和纯 Go SQLite 驱动错误码。
func IsDuplicate(err error) bool {
    if errors.Is(err, gorm.ErrDuplicatedKey) {
        return true
    }

    var value *sqlite.Error
    return errors.As(err, &value) && (value.Code() == 2067 || value.Code() == 1555)
}
