package localtools

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestWindowsInputRefusal(t *testing.T) {
	chromium := func() bool { return true }
	native := func() bool { return false }
	cases := []struct {
		name      string
		tool      string
		arguments map[string]any
		chromium  func() bool
		refused   bool
	}{
		{"background scroll", "scroll", map[string]any{"pid": 1.0, "direction": "down"}, chromium, false},
		{"explicit background", "click", map[string]any{"pid": 1.0, "delivery_mode": "background"}, chromium, false},
		{"foreground scroll", "scroll", map[string]any{"pid": 1.0, "delivery_mode": "foreground"}, native, true},
		{"foreground keys", "type_text", map[string]any{"pid": 1.0, "delivery_mode": "foreground"}, native, true},
		{"desktop point", "scroll", map[string]any{"x": 1.0, "y": 1.0, "scope": "desktop"}, native, true},
		{"window scope", "click", map[string]any{"pid": 1.0, "scope": "window"}, native, false},
		{"chromium double click", "double_click", map[string]any{"pid": 1.0}, chromium, true},
		{"chromium right click", "right_click", map[string]any{"pid": 1.0}, chromium, true},
		{"native right click", "right_click", map[string]any{"pid": 1.0}, native, false},
		{"chromium click", "click", map[string]any{"pid": 1.0}, chromium, false},
		{"bring to front", "bring_to_front", map[string]any{"pid": 1.0}, native, true},
		{"move cursor", "move_cursor", map[string]any{"x": 1.0, "y": 1.0}, native, true},
		{"read", "get_window_state", map[string]any{"pid": 1.0, "scope": "desktop"}, native, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := windowsInputRefusal(tc.tool, tc.arguments, tc.chromium)
			if tc.refused != (err != nil) {
				t.Fatalf("refused = %v, want %v (%v)", err != nil, tc.refused, err)
			}
			if err != nil && (!errors.Is(err, errNotSent) || !strings.HasPrefix(err.Error(), "COMPUTER_INPUT_NOT_SENT")) {
				t.Fatalf("refusal is not a not-sent error: %v", err)
			}
		})
	}
}

func TestWindowsRefusedResult(t *testing.T) {
	refusal := func(code string) json.RawMessage {
		return json.RawMessage(`{"isError":true,"content":[{"type":"text","text":"Retry this action with delivery_mode:\"foreground\""}],"structuredContent":{"code":"` + code + `"}}`)
	}
	text := func(result json.RawMessage) string {
		var reply struct {
			Content []struct{ Text string } `json:"content"`
		}
		if err := json.Unmarshal(result, &reply); err != nil || len(reply.Content) != 1 {
			t.Fatalf("result content: %s", result)
		}
		return reply.Content[0].Text
	}
	if got := text(windowsRefusedResult("scroll", refusal("background_unavailable"))); strings.Contains(got, "foreground\"") || !strings.Contains(got, "element_token") {
		t.Fatalf("scroll refusal text = %q", got)
	}
	if got := text(windowsRefusedResult("click", refusal("window_minimized"))); !strings.Contains(got, "restore") {
		t.Fatalf("minimized refusal text = %q", got)
	}
	other := refusal("element_not_found")
	if got := windowsRefusedResult("click", other); string(got) != string(other) {
		t.Fatalf("other refusal changed: %s", got)
	}
	success := json.RawMessage(`{"content":[{"type":"text","text":"ok"}],"structuredContent":{"code":"background_unavailable"}}`)
	if got := windowsRefusedResult("click", success); string(got) != string(success) {
		t.Fatalf("success changed: %s", got)
	}
}

func TestWindowsSchemaHidesForegroundFields(t *testing.T) {
	input := map[string]any{"properties": map[string]any{"pid": map[string]any{}, "delivery_mode": map[string]any{}, "scope": map[string]any{}}}
	windowsSchema(input)
	props := input["properties"].(map[string]any)
	if _, ok := props["delivery_mode"]; ok {
		t.Fatal("delivery_mode kept")
	}
	if _, ok := props["scope"]; ok {
		t.Fatal("scope kept")
	}
	if _, ok := props["pid"]; !ok {
		t.Fatal("pid dropped")
	}
}
