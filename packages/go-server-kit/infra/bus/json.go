package bus

import (
    "bytes"
    "encoding/json"
    "math"
    "strconv"
    "unicode/utf8"
)

// validJSON 保留参考信封对 Unicode、有限数值和对象属性的约束。
func validJSON(raw []byte) bool {
    if !utf8.Valid(raw) || !json.Valid(raw) {
        return false
    }

    for i := 0; i < len(raw); i++ {
        if raw[i] != '\\' {
            continue
        }
        if raw[i+1] != 'u' {
            i++
            continue
        }

        code, err := strconv.ParseUint(string(raw[i+2:i+6]), 16, 16)
        if err != nil {
            return false
        }
        if code >= 0xd800 && code <= 0xdbff {
            if i+12 > len(raw) || raw[i+6] != '\\' || raw[i+7] != 'u' {
                return false
            }

            low, err := strconv.ParseUint(string(raw[i+8:i+12]), 16, 16)
            if err != nil || low < 0xdc00 || low > 0xdfff {
                return false
            }

            i += 11
        } else {
            if code >= 0xdc00 && code <= 0xdfff {
                return false
            }

            i += 5
        }
    }

    decoder := json.NewDecoder(bytes.NewReader(raw))
    decoder.UseNumber()
    var value any
    if decoder.Decode(&value) != nil {
        return false
    }

    var valid func(any) bool
    valid = func(value any) bool {
        switch v := value.(type) {
        case json.Number:
            number, err := strconv.ParseFloat(string(v), 64)
            return err == nil && !math.IsInf(number, 0) && !math.IsNaN(number)
        case map[string]any:
            for key, child := range v {
                if key == "__proto__" || key == "prototype" || key == "constructor" || !valid(child) {
                    return false
                }
            }
        case []any:
            for _, child := range v {
                if !valid(child) {
                    return false
                }
            }
        }

        return true
    }
    return valid(value)
}
