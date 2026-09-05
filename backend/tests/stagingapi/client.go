//go:build staging

package stagingapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type apiClient struct {
	base   string
	token  string
	admin  string
	client *http.Client
}

type apiResponse struct {
	Status int
	Body   []byte
	Header http.Header
}

func (c *apiClient) do(t *testing.T, method, path string, body any, headers map[string]string) apiResponse {
	t.Helper()
	res, err := c.doRequest(method, path, body, headers)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func (c *apiClient) doSilent(method, path string, body any, headers map[string]string) apiResponse {
	res, err := c.doRequest(method, path, body, headers)
	if err != nil {
		return apiResponse{Status: 0}
	}
	return res
}

func (c *apiClient) doRequest(method, path string, body any, headers map[string]string) (apiResponse, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return apiResponse{}, fmt.Errorf("marshal body for %s %s: %w", method, path, err)
		}
		reader = bytes.NewReader(b)
	}
	url := c.base + path
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		return apiResponse{}, fmt.Errorf("new request %s %s: %w", method, path, err)
	}
	req.Header.Set("X-App-Platform", "web")
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	res, err := c.client.Do(req)
	if err != nil {
		return apiResponse{}, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return apiResponse{}, fmt.Errorf("read body %s %s: %w", method, path, err)
	}
	return apiResponse{Status: res.StatusCode, Body: raw, Header: res.Header.Clone()}, nil
}

func (c *apiClient) doAdmin(t *testing.T, method, path string, body any) apiResponse {
	t.Helper()
	return c.do(t, method, path, body, map[string]string{"X-Admin-Key": c.admin})
}

func (r apiResponse) jsonMap(t *testing.T) map[string]any {
	t.Helper()
	var out map[string]any
	if len(bytes.TrimSpace(r.Body)) == 0 {
		return out
	}
	if err := json.Unmarshal(r.Body, &out); err != nil {
		t.Fatalf("json decode: %v\nbody: %s", err, truncate(r.Body, 400))
	}
	return out
}

func (r apiResponse) stringField(t *testing.T, key string) string {
	t.Helper()
	m := r.jsonMap(t)
	v, _ := m[key].(string)
	return v
}

func expectStatus(t *testing.T, name string, got int, want ...int) {
	t.Helper()
	for _, w := range want {
		if got == w {
			return
		}
	}
	t.Errorf("%s: got HTTP %d, want one of %v", name, got, want)
}

func expectStatusExact(t *testing.T, name string, got, want int, body []byte) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got HTTP %d, want %d\nbody: %s", name, got, want, truncate(body, 500))
	}
}

func truncate(b []byte, n int) string {
	s := strings.TrimSpace(string(b))
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
