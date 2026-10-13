package web

import "net/http"

// noStoreResponseWriter 在静态资源提交响应时覆盖缓存头，保留下游状态码和正文。
type noStoreResponseWriter struct {
    http.ResponseWriter
    wroteHeader bool
}

func (w *noStoreResponseWriter) WriteHeader(status int) {
    w.Header().Set("Cache-Control", "no-store")
    if status >= http.StatusOK {
        w.wroteHeader = true
    }
    w.ResponseWriter.WriteHeader(status)
}

func (w *noStoreResponseWriter) Write(body []byte) (int, error) {
    w.Header().Set("Cache-Control", "no-store")
    w.wroteHeader = true
    return w.ResponseWriter.Write(body)
}

// Unwrap 允许标准 ResponseController 访问原始响应 writer。
func (w *noStoreResponseWriter) Unwrap() http.ResponseWriter {
    return w.ResponseWriter
}
