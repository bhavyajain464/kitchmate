//go:build staging

package stagingapi

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func loadBillFixtureBase64(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join("testdata", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	if len(raw) == 0 {
		t.Fatalf("fixture %s is empty", path)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

func assertBillScanParsed(t *testing.T, label string, res apiResponse) {
	t.Helper()
	expectStatusExact(t, label, res.Status, http.StatusOK, res.Body)
	m := res.jsonMap(t)
	if success, _ := m["success"].(bool); !success {
		t.Fatalf("%s success=false body=%s", label, truncate(res.Body, 500))
	}
	items, _ := m["items"].([]any)
	if len(items) == 0 {
		t.Fatalf("%s returned no items\nbody: %s", label, truncate(res.Body, 600))
	}
	t.Logf("%s parsed %d items (skipped=%v)", label, len(items), m["skipped"])
}
