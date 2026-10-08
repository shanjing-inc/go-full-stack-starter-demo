package auth

// 本文件覆盖新密码的字节边界，以及八字节密码在初始化、创建和 HTTP 入口中的一致性。

import (
    "context"
    "encoding/json"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httpx"
    "strings"
    "testing"
)

func TestNewPasswordByteBoundaries(t *testing.T) {
    cases := []struct {
        name, password string
        valid          bool
    }{
        {"ASCII七字节", "1234567", false},
        {"ASCII八字节", "12345678", true},
        {"ASCII一百二十八字节", strings.Repeat("a", 128), true},
        {"ASCII一百二十九字节", strings.Repeat("a", 129), false},
        {"混合七字节", "密码a", false},
        {"混合八字节", "密码ab", true},
        {"表情八字节", "😀😀", true},
    }
    for _, item := range cases {
        t.Run(item.name, func(t *testing.T) {
            hash, err := PasswordHash(item.password)
            if item.valid {
                if err != nil || !PasswordMatches(hash, item.password) {
                    t.Fatal("有效密码需要完成散列及验证", err)
                }
            } else if err == nil || err.Error() != "密码长度需要 8–128 字节" {
                t.Fatal("超出长度范围需要受控错误", err)
            }
        })
    }
}

func TestInitializationAndCreationAcceptEightBytes(t *testing.T) {
    for _, password := range []string{"12345678", "密码ab"} {
        t.Run(password, func(t *testing.T) {
            s := testService(t)
            ctx := context.Background()
            if _, err := s.Initialize(ctx, secret, "管理员", "owner@example.test", "1234567"); err == nil {
                t.Fatal("初始化需要拒绝七字节密码")
            }

            installed, err := s.Installed(ctx)
            if err != nil || installed {
                t.Fatal("密码校验失败后初始化状态保持", installed, err)
            }

            owner, err := s.Initialize(ctx, secret, "管理员", "owner@example.test", password)
            if err != nil {
                t.Fatal("初始化需要接受八字节密码", err)
            }
            if _, _, err = s.Login(ctx, owner.Email, password, "", ""); err != nil {
                t.Fatal("八字节初始化密码需要成功登录", err)
            }

            ownerCtx := WithUser(ctx, owner)
            input := CreateUserInput{
                Name:     "成员",
                Email:    "member@example.test",
                Password: "1234567",
            }
            _, err = s.CreateUser(ownerCtx, input)
            assertUserError(t, err, "BAD_USER_INPUT")
            input.Password = password
            member, err := s.CreateUser(ownerCtx, input)
            if err != nil {
                t.Fatal("创建用户需要接受八字节密码", err)
            }
            if _, _, err = s.Login(ctx, member.Email, password, "", ""); err != nil {
                t.Fatal("八字节创建密码需要成功登录", err)
            }
        })
    }
}

func TestHTTPInitializationEightBytePassword(t *testing.T) {
    for _, password := range []string{"12345678", "密码ab"} {
        t.Run(password, func(t *testing.T) {
            s := testService(t)
            e := httpx.New()
            if err := s.Register(e, testLimiter{}); err != nil {
                t.Fatal(err)
            }

            data := map[string]string{
                "bootstrapToken": secret,
                "name":           "管理员",
                "email":          "owner@example.test",
                "password":       "1234567",
            }
            payload, _ := json.Marshal(data)
            failed := request(e, "POST", "/api/auth/initialize", string(payload), "", "http://localhost", nil)
            if failed.Code != 400 {
                t.Fatal("HTTP 初始化需要拒绝七字节密码", failed.Code)
            }

            data["password"] = password
            payload, _ = json.Marshal(data)
            created := request(e, "POST", "/api/auth/initialize", string(payload), "", "http://localhost", nil)
            if created.Code != 201 {
                t.Fatal("HTTP 初始化需要接受八字节密码", created.Code, created.Body.String())
            }

            payload, _ = json.Marshal(map[string]string{"email": data["email"], "password": password})
            login := request(e, "POST", "/api/auth/sign-in/email", string(payload), "", "http://localhost", nil)
            if login.Code != 200 {
                t.Fatal("HTTP 八字节密码需要成功登录", login.Code, login.Body.String())
            }
        })
    }
}
