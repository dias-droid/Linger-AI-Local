//go:build !windows

package provider

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeProbeScript(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "runtime")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func captureProbeLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &output
}

func TestProtocolProbeAcceptsAnAnswerFollowedByAFailedExit(t *testing.T) {
	logged := captureProbeLog(t)
	script := writeProbeScript(t, `read request
echo '{"id":1,"result":{"userAgent":"probe"}}'
cat >/dev/null
echo 'shutting down after input closed' >&2
exit 1
`)
	environment := map[string]string{"PATH": "/usr/bin:/bin", "HOME": t.TempDir()}
	if err := probeRuntimeProtocol(context.Background(), "codex", script, environment, 5*time.Second, "codex-cli 0.171.0"); err != nil {
		t.Fatalf("an answered handshake failed: %v", err)
	}
	if !strings.Contains(logged.String(), "runner.runtime_probe.exit_after_handshake") || !strings.Contains(logged.String(), "exit_code=1") {
		t.Fatalf("exit after the handshake was not logged: %s", logged)
	}
}

func TestProtocolProbeLogsWhyAnUnansweredHandshakeFailed(t *testing.T) {
	logged := captureProbeLog(t)
	script := writeProbeScript(t, `echo "error: unexpected argument found; api_key=sk-secret-value" >&2
exit 2
`)
	environment := map[string]string{"PATH": "/usr/bin:/bin", "HOME": t.TempDir()}
	if err := probeRuntimeProtocol(context.Background(), "pi", script, environment, 5*time.Second, "1.6.0"); err == nil {
		t.Fatal("an unanswered handshake passed")
	}
	output := logged.String()
	for _, want := range []string{"runner.runtime_probe.handshake_failed", "runtime_type=pi", "exit_code=2", "unexpected argument found"} {
		if !strings.Contains(output, want) {
			t.Fatalf("log lacks %q: %s", want, output)
		}
	}
	if strings.Contains(output, "sk-secret-value") {
		t.Fatalf("log kept a credential: %s", output)
	}
}
