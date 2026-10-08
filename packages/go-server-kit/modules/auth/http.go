package auth

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "context"
    "crypto/hmac"
    "crypto/sha256"
    "encoding/base64"
    "encoding/hex"
    "encoding/json"
    "errors"
    "github.com/labstack/echo/v5"
    "github.com/labstack/echo/v5/middleware"
    "github.com/redis/go-redis/v9"
    "io"
    "net"
    "net/http"
    "net/url"
    "strconv"
    "strings"
    "time"
)

// Limiter 按 key 和请求上限判断是否放行；认证入口使用共享实现。
// err 为 nil 时布尔返回值表示放行结果，错误交给认证入口转换为公开响应。
type Limiter interface {
    Allow(context.Context, string, int) (bool, error)
}

// RedisLimiter 使用 Redis 原子计数实现共享的 60 秒请求窗口。
// 窗口从 key 的首次请求开始，Prefix 用于隔离不同应用的限流计数。
type RedisLimiter struct {
    Client redis.UniversalClient
    Prefix string
}

// Allow 为 key 累加计数，首次计数设置 60 秒过期时间。
// Redis 成功时，累计请求数小于等于 limit 表示放行；Redis 错误原样返回。
func (l RedisLimiter) Allow(ctx context.Context, key string, limit int) (bool, error) {
    n, err := l.Client.Eval(ctx, `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`, []string{l.Prefix + ":auth:limit:" + key}).Int()
    return n <= limit, err
}

// Sign 将原始会话 token 与基于认证密钥的 HMAC-SHA256 签名用点号连接。
// 签名按标准 Base64 编码，Cookie 的 URL 转义由写入入口完成。
func (s *Service) Sign(token string) string {
    mac := hmac.New(sha256.New, []byte(s.config.Secret))
    mac.Write([]byte(token))
    return token + "." + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// unsigned 解析可带 URL 转义的签名 token，并以恒定时间比较校验签名。
// 转义、分隔或签名校验失败时返回空字符串。
func (s *Service) unsigned(value string) string {
    if strings.Contains(value, "%") {
        decoded, err := url.QueryUnescape(value)
        if err != nil {
            return ""
        }

        value = decoded
    }

    token, signature, ok := strings.Cut(value, ".")
    if !ok {
        return ""
    }

    decoded, err := base64.StdEncoding.DecodeString(signature)
    if err != nil {
        return ""
    }

    mac := hmac.New(sha256.New, []byte(s.config.Secret))
    mac.Write([]byte(token))
    if !hmac.Equal(decoded, mac.Sum(nil)) {
        return ""
    }

    return token
}

// requestToken 在 Authorization 有值时使用该来源，否则读取配置的会话 Cookie。
// Bearer 接受原始及签名 token；Cookie 使用签名校验，第二个返回值标记所选来源是否为 Cookie。
func (s *Service) requestToken(r *http.Request) (string, bool) {
    if authorization := r.Header.Get("Authorization"); authorization != "" {
        if !strings.HasPrefix(authorization, "Bearer ") {
            return "", false
        }

        token := strings.TrimPrefix(authorization, "Bearer ")
        if strings.Contains(token, ".") {
            token = s.unsigned(token)
        }
        return token, false
    }

    if cookie, err := r.Cookie(s.config.CookieName); err == nil {
        return s.unsigned(cookie.Value), true
    }
    return "", false
}

// cookie 写入带签名的 HttpOnly、SameSite=Lax 会话 Cookie，Secure 由配置控制。
// session 为 nil 时通过过期时间与负 MaxAge 清除 Cookie。
func (s *Service) cookie(c *echo.Context, session *Session) {
    cookie := &http.Cookie{
        Name:     s.config.CookieName,
        Path:     "/",
        HttpOnly: true,
        Secure:   s.config.Secure,
        SameSite: http.SameSiteLaxMode,
    }
    if session == nil {
        cookie.MaxAge = -1
        cookie.Expires = time.Unix(1, 0)
    } else {
        cookie.Value = url.QueryEscape(s.Sign(session.Token))
        cookie.Expires = session.ExpiresAt
        cookie.MaxAge = int(time.Until(session.ExpiresAt).Seconds())
    }

    c.SetCookie(cookie)
}

// originOK 拒绝 Sec-Fetch-Site 标记的跨站请求，存在 Origin 时要求精确匹配白名单。
// 缺少 Origin 时，Cookie 来源的写请求和 WebSocket 升级请求均校验失败。
func (s *Service) originOK(r *http.Request, cookie bool) bool {
    if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
        return false
    }

    origin := r.Header.Get("Origin")
    if origin != "" {
        for _, allowed := range s.config.Origins {
            if origin == allowed {
                return true
            }
        }

        return false
    }

    unsafe := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
    return !(cookie && (unsafe || strings.EqualFold(r.Header.Get("Upgrade"), "websocket")))
}

// authError 将已知认证错误映射到稳定状态码，其他错误统一返回脱敏的 503 响应。
func authError(c *echo.Context, err error) error {
    status, code, message := 503, "SERVICE_UNAVAILABLE", "认证服务暂时不可用"
    switch {
    case errors.Is(err, ErrCredentials):
        status, code, message = 401, "INVALID_CREDENTIALS", ErrCredentials.Error()
    case errors.Is(err, ErrUnauthorized):
        status, code, message = 401, "UNAUTHORIZED", ErrUnauthorized.Error()
    case errors.Is(err, ErrBanned):
        status, code, message = 403, "USER_BANNED", ErrBanned.Error()
    case errors.Is(err, ErrInstalled):
        status, code, message = 409, "ALREADY_INSTALLED", ErrInstalled.Error()
    case errors.Is(err, ErrDisabled):
        status, code, message = 403, "INSTALL_DISABLED", ErrDisabled.Error()
    }

    return c.JSON(status, map[string]string{"code": code, "message": message})
}

// userJSON 输出认证接口的用户字段，ID 转为字符串，缺省角色为 user。
// 可空头像转为空字符串，image 与 avatar 共享同一值以兼容调用方。
func userJSON(user *User) map[string]any {
    role, image := "user", ""
    if user.Role != nil {
        role = *user.Role
    }
    if user.Image != nil {
        image = *user.Image
    }

    return map[string]any{
        "id":            strconv.Itoa(user.ID),
        "name":          user.Name,
        "email":         user.Email,
        "emailVerified": user.EmailVerified,
        "image":         image,
        "avatar":        image,
        "role":          role,
    }
}

// sessionJSON 输出用户与会话元数据，会话 ID 和用户 ID 均转为字符串。
func sessionJSON(session *Session, user *User) map[string]any {
    return map[string]any{
        "user": userJSON(user),
        "session": map[string]any{
            "id":        strconv.Itoa(session.ID),
            "userId":    strconv.Itoa(user.ID),
            "expiresAt": session.ExpiresAt,
            "createdAt": session.CreatedAt,
            "updatedAt": session.UpdatedAt,
        },
    }
}

// Guard 为受保护的 /api/ 请求校验来源、会话及配置的管理端与路径权限。
// 认证路由、内部健康探针与 /api/ 之外的路径交给后续处理器。
// 成功后注入会话 ID、用户身份和长连接复核函数，Cookie 来源同时刷新会话 Cookie。
func (s *Service) Guard(next echo.HandlerFunc) echo.HandlerFunc {
    return func(c *echo.Context) error {
        r := c.Request()
        path := r.URL.Path
        if !strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/api/auth/") || path == "/api/rest/internal/health" {
            return next(c)
        }

        c.Response().Header().Set("Cache-Control", "no-store")
        token, cookie := s.requestToken(r)
        if !s.originOK(r, cookie) {
            return c.JSON(403, map[string]string{"code": "FORBIDDEN", "message": "请求来源无效"})
        }

        // 数据库会话解析使用短超时，后续处理仍继承请求自身的上下文。
        ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
        session, user, err := s.Resolve(ctx, token)
        cancel()
        if err != nil {
            return authError(c, err)
        }

        administrative := false
        for _, adminPath := range s.config.AdminPaths {
            if path == adminPath {
                administrative = true
                break
            }
        }

        if administrative && !s.Allows(user, "dashboard", "access:admin") {
            denial := &httperr.Error{Code: "FORBIDDEN", Message: "需要管理员权限"}
            s.record(WithUser(r.Context(), user), "dashboard", "access:admin", path, denial)
            return c.JSON(403, map[string]string{"code": denial.Code, "message": denial.Message})
        }

        // 优先匹配实际 URL，其次匹配 Echo 路由模板，覆盖带参数的权限配置。
        permission, exists := s.config.PathPermissions[path]
        if !exists {
            permission, exists = s.config.PathPermissions[c.Path()]
        }
        if exists && !s.Allows(user, permission.Resource, permission.Action) {
            denial := &httperr.Error{Code: "FORBIDDEN", Message: "当前账号缺少所需权限"}
            s.record(WithUser(r.Context(), user), permission.Resource, permission.Action, path, denial)
            return c.JSON(403, map[string]string{"code": denial.Code, "message": denial.Message})
        }

        c.Response().Header().Set("Cache-Control", "no-store")
        if cookie {
            s.cookie(c, session)
        }

        ctx = context.WithValue(r.Context(), sessionIDKey{}, session.ID)
        c.SetRequest(r.WithContext(s.connectionContext(ctx, token, user)))
        return next(c)
    }
}

// Register 校验共享限流器与精确 Origin 白名单，装配 CORS、Guard 和认证路由。
// 登录与初始化共用请求解码和限流；DashboardPath 配置后提供身份及权限查询。
func (s *Service) Register(e *echo.Echo, limiter Limiter) error {
    if limiter == nil {
        return errors.New("认证入口需要共享限流器")
    }
    if len(s.config.Origins) == 0 {
        return errors.New("认证 HTTP 入口需要精确 Origin 白名单")
    }

    for _, origin := range s.config.Origins {
        if strings.Contains(origin, "*") {
            return errors.New("认证 HTTP 入口采用精确 Origin 白名单")
        }
    }

    e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
        AllowOrigins:     s.config.Origins,
        AllowMethods:     []string{"GET", "HEAD", "POST", "OPTIONS"},
        AllowHeaders:     []string{"Content-Type", "Authorization"},
        AllowCredentials: true,
    }))
    e.Use(s.Guard)

    type input struct {
        Email          string `json:"email"`
        Password       string `json:"password"`
        Name           string `json:"name"`
        BootstrapToken string `json:"bootstrapToken"`
    }

    // 共享解码先校验来源和请求大小，再按 IP 与账号顺序限流。
    // 失败时写入响应并返回 false，由路由结束当前请求。
    decode := func(c *echo.Context, data *input, maxPasswordBytes int) bool {
        r := c.Request()
        c.Response().Header().Set("Cache-Control", "no-store")
        if !s.originOK(r, r.Header.Get("Cookie") != "") || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
            _ = c.JSON(403, map[string]string{"code": "FORBIDDEN", "message": "请求来源或内容类型无效"})
            return false
        }

        // 请求体上限为 4096 字节；第二次解码要求 EOF，保证只接收一个 JSON 值。
        reader := http.MaxBytesReader(c.Response(), r.Body, 4096)
        decoder := json.NewDecoder(reader)
        if decoder.Decode(data) != nil || decoder.Decode(new(any)) != io.EOF {
            _ = c.JSON(400, map[string]string{"code": "BAD_USER_INPUT", "message": "请求参数无效"})
            return false
        }
        if len(data.Email) > 255 || len(data.Password) > maxPasswordBytes || len(data.Name) > 255 || len(data.BootstrapToken) > 256 {
            _ = c.JSON(400, map[string]string{"code": "BAD_USER_INPUT", "message": "请求参数过长"})
            return false
        }

        ip, _, _ := net.SplitHostPort(r.RemoteAddr)
        // RemoteAddr 直接来自连接，代理头信任由后续部署配置显式决定。
        allow := func(key string, limit int) bool {
            // HMAC 派生限流 key，使 Redis 保存的桶标识使用带密钥摘要。
            mac := hmac.New(sha256.New, []byte(s.config.Secret))
            mac.Write([]byte(key))
            limitContext, cancel := context.WithTimeout(r.Context(), 3*time.Second)
            allowed, err := limiter.Allow(limitContext, hex.EncodeToString(mac.Sum(nil)), limit)
            cancel()
            if err != nil {
                _ = authError(c, err)
                return false
            }
            if !allowed {
                c.Response().Header().Set("Retry-After", "60")
                _ = c.JSON(429, map[string]string{"code": "RATE_LIMITED", "message": "请求频繁，请稍后重试"})
                return false
            }
            return true
        }

        // IP 桶先执行，限制账号查询开销；匹配成功的邮箱使用稳定账号 ID。
        if !allow("ip:"+ip, 20) {
            return false
        }

        lookupContext, cancel := context.WithTimeout(r.Context(), 3*time.Second)
        key, err := s.loginLimitKey(lookupContext, data.Email)
        cancel()
        if err != nil {
            _ = authError(c, err)
            return false
        }
        if !allow(key, 5) {
            return false
        }
        return true
    }

    // 安装状态与初始化入口共享安装配置，初始化另行校验 bootstrapToken。
    e.GET("/api/auth/install-status", func(c *echo.Context) error {
        c.Response().Header().Set("Cache-Control", "no-store")
        installed, err := s.Installed(c.Request().Context())
        if err != nil {
            return authError(c, err)
        }
        return c.JSON(200, map[string]bool{"installed": installed, "enabled": s.config.BootstrapToken != "" && !installed})
    })

    e.POST("/api/auth/initialize", func(c *echo.Context) error {
        var data input
        if !decode(c, &data, 128) {
            return nil
        }

        // 对字段验证提供业务错误；数据库错误统一脱敏。
        if _, err := emailValue(data.Email); err != nil || len(data.Password) < 8 || strings.TrimSpace(data.Name) == "" {
            return c.JSON(400, map[string]string{"code": "BAD_USER_INPUT", "message": "请检查名称、邮箱和密码"})
        }

        user, err := s.Initialize(c.Request().Context(), data.BootstrapToken, data.Name, data.Email, data.Password)
        if err != nil {
            return authError(c, err)
        }
        return c.JSON(201, map[string]any{"user": userJSON(user)})
    })

    // 登录接受兼容旧账号的密码输入上限，成功后设置签名会话 Cookie。
    e.POST("/api/auth/sign-in/email", func(c *echo.Context) error {
        var data input
        if !decode(c, &data, maxLoginPasswordBytes) {
            return nil
        }

        ip, _, _ := net.SplitHostPort(c.Request().RemoteAddr)
        session, user, err := s.Login(c.Request().Context(), data.Email, data.Password, ip, c.Request().UserAgent())
        if err != nil {
            return authError(c, err)
        }

        s.cookie(c, session)
        return c.JSON(200, map[string]any{
            "token":    session.Token,
            "user":     userJSON(user),
            "redirect": false,
        })
    })

    // 会话查询以 JSON null 表达未登录，Cookie 来源的有效会话回写 Cookie。
    e.GET("/api/auth/get-session", func(c *echo.Context) error {
        c.Response().Header().Set("Cache-Control", "no-store")
        token, cookie := s.requestToken(c.Request())
        if !s.originOK(c.Request(), cookie) {
            return c.JSON(403, map[string]string{"code": "FORBIDDEN", "message": "请求来源无效"})
        }

        session, user, err := s.Resolve(c.Request().Context(), token)
        if errors.Is(err, ErrUnauthorized) {
            return c.JSON(200, nil)
        }
        if err != nil {
            return authError(c, err)
        }

        if cookie {
            s.cookie(c, session)
        }
        return c.JSON(200, sessionJSON(session, user))
    })

    // 登出撤销可用 token 对应的会话，并在成功后清除浏览器 Cookie。
    e.POST("/api/auth/sign-out", func(c *echo.Context) error {
        c.Response().Header().Set("Cache-Control", "no-store")
        token, cookie := s.requestToken(c.Request())
        if !s.originOK(c.Request(), cookie) {
            return c.JSON(403, map[string]string{"code": "FORBIDDEN", "message": "请求来源无效"})
        }

        if token != "" {
            if err := s.Logout(c.Request().Context(), token); err != nil {
                return authError(c, err)
            }
        }

        s.cookie(c, nil)
        return c.JSON(200, map[string]bool{"success": true})
    })

    // 可选后台身份入口沿用 Guard 注入的用户，合并角色权限与菜单别名。
    if s.config.DashboardPath != "" {
        e.GET(s.config.DashboardPath, func(c *echo.Context) error {
            user, ok := UserFrom(c.Request().Context())
            if !ok {
                return authError(c, ErrUnauthorized)
            }

            permissions := s.DashboardPermissions(user)
            return c.JSON(200, map[string]any{
                "user":        userJSON(user),
                "permissions": permissions,
                "mode":        "authenticated",
            })
        })
    }

    return nil
}
