package main

// 本文件覆盖逗号组合角色对应的后台演示权限。

import (
    "reflect"
    "testing"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
)

func TestDashboardCombinedRoles(t *testing.T) {
    for _, sample := range []struct {
        role  string
        write bool
    }{
        {"owner,user", true},
        {"user,admin", true},
        {"user,owner,member", true},
        {"member,user", false},
        {"superadmin", false},
        {"OWNER,user", false},
    } {
        t.Run(sample.role, func(t *testing.T) {
            expected := []string{"demo:read"}
            if sample.write {
                expected = append(expected, "demo:write")
            }
            if got := dashboardPermissions(&auth.User{Role: &sample.role}); !reflect.DeepEqual(got, expected) {
                t.Fatal(got, expected)
            }
        })
    }

    if got := dashboardPermissions(&auth.User{}); !reflect.DeepEqual(got, []string{"demo:read"}) {
        t.Fatal(got)
    }
}
