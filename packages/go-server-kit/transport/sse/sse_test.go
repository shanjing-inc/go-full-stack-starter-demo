package stream_test

// 本文件覆盖SSE 事件格式、心跳和慢客户端写期限。

import (
    "bufio"
    "bytes"
    subject "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/sse"
    "errors"
    "fmt"
    "net"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    "time"
)

type output struct {
    bytes.Buffer
    headers   http.Header
    deadlines []time.Time
    flushes   int
    failure   bool
}

func (w *output) Header() http.Header {
    if w.headers == nil {
        w.headers = http.Header{}
    }
    return w.headers
}

func (w *output) WriteHeader(status int) {}

func (w *output) SetWriteDeadline(value time.Time) error {
    w.deadlines = append(w.deadlines, value)
    return nil
}

func (w *output) FlushError() error {
    w.flushes++
    if w.failure {
        return errors.New("写入超时")
    }
    return nil
}

func TestSSEWriter(t *testing.T) {
    t.Run("framing-newline-and-deadlines", func(t *testing.T) {
        out := &output{}
        writer, err := subject.New(out, time.Second)
        if err != nil {
            t.Fatal(err)
        }
        if err = writer.Event("result", map[string]string{"content": "第一行\n第二行\r\nevent: evil"}); err != nil {
            t.Fatal(err)
        }
        if err = writer.Heartbeat(); err != nil {
            t.Fatal(err)
        }
        if out.String() != `event: result
`+`data: {"content":"第一行\n第二行\r\nevent: evil"}`+"\n\n: ping\n\n" {
            t.Fatal(out.String())
        }
        if out.flushes != 2 || len(out.deadlines) != 5 || !out.deadlines[2].IsZero() || !out.deadlines[4].IsZero() {
            t.Fatal(out.flushes, out.deadlines)
        }
        if err = writer.Event("x\nevent: evil", nil); err == nil {
            t.Fatal("事件名换行通过")
        }
    })
    t.Run("flush-failure", func(t *testing.T) {
        out := &output{failure: true}
        writer, err := subject.New(out, time.Second)
        if err != nil {
            t.Fatal(err)
        }
        if err = writer.Heartbeat(); err == nil || !strings.Contains(err.Error(), "超时") {
            t.Fatal(err)
        }
    })
    t.Run("unsupported-responsewriter", func(t *testing.T) {
        if _, err := subject.New(&bareWriter{}, time.Second); err == nil {
            t.Fatal("写期限能力校验缺失")
        }
    })
}

type bareWriter struct{}

func (*bareWriter) Header() http.Header { return http.Header{} }

func (*bareWriter) Write(value []byte) (int, error) { return len(value), nil }

func (*bareWriter) WriteHeader(status int) {}

func TestSSESlowClientWriteDeadline(t *testing.T) {
    done := make(chan error, 1)
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        writer, err := subject.New(w, 40*time.Millisecond)
        if err != nil {
            done <- err
            return
        }

        for i := 0; i < 256; i++ {
            if err = writer.Event("result", strings.Repeat("x", 65536)); err != nil {
                done <- err
                return
            }
        }

        done <- nil
    }))
    defer server.Close()
    address := strings.TrimPrefix(server.URL, "http://")
    connection, err := net.Dial("tcp", address)
    if err != nil {
        t.Fatal(err)
    }
    defer connection.Close()
    _ = connection.(*net.TCPConn).SetReadBuffer(1024)
    _, _ = fmt.Fprintf(connection, "GET / HTTP/1.1\r\nHost: %s\r\n\r\n", address)
    _ = connection.SetReadDeadline(time.Now().Add(time.Second))
    reader := bufio.NewReader(connection)
    for {
        line, err := reader.ReadString('\n')
        if err != nil {
            t.Fatal(err)
        }
        if line == "\r\n" {
            break
        }
    }

    select {
    case err := <-done:
        if err == nil {
            t.Fatal("慢客户端未触发写入超时")
        }
    case <-time.After(2 * time.Second):
        t.Fatal("慢客户端写入期限失效")
    }
}
