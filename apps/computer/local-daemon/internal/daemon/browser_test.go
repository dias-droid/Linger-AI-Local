package daemon

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/localtools"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
)

type browserEventStream struct{ events []protocol.Event }

func (s *browserEventStream) Receive(context.Context) (protocol.Command, error) {
	return protocol.Command{}, context.Canceled
}
func (s *browserEventStream) Send(_ context.Context, event protocol.Event) error {
	s.events = append(s.events, event)
	return nil
}
func (s *browserEventStream) Close() error { return nil }

type deadlineBrowserConnections struct{ deadline time.Time }

func (b *deadlineBrowserConnections) BrowserConnection(ctx context.Context, _, _, _, _, _ string) (localtools.BrowserStatus, error) {
	b.deadline, _ = ctx.Deadline()
	return localtools.BrowserStatus{Mode: "isolated", State: "isolated", Platform: "darwin"}, nil
}

func TestBrowserCommandStopsAtItsExpiry(t *testing.T) {
	connections := &deadlineBrowserConnections{}
	d := &Daemon{computerID: "computer", browserConnections: connections, owners: []ComputerOwner{{TenantID: "tenant", OwnerActorID: "owner"}}}
	expires := time.Now().Add(time.Minute).UTC().Truncate(time.Second)
	payload, _ := json.Marshal(map[string]any{"runner_id": "computer", "tenant_id": "tenant", "owner_actor_id": "owner", "expires_at": expires, "action": "status"})
	stream := &browserEventStream{}
	if err := d.handleBrowserCommand(t.Context(), stream, protocol.Command{Type: protocol.CommandCapabilityBrowserConnect, RunnerID: "computer", Payload: payload}); err != nil {
		t.Fatal(err)
	}
	if !connections.deadline.Equal(expires) {
		t.Fatalf("browser work may outlive the Gateway wait: deadline=%v", connections.deadline)
	}
	if len(stream.events) != 1 || stream.events[0].Type != protocol.EventCapabilityBrowserConnected {
		t.Fatalf("events=%+v", stream.events)
	}

	payload, _ = json.Marshal(map[string]any{"runner_id": "computer", "tenant_id": "tenant", "owner_actor_id": "intruder", "expires_at": expires, "action": "status"})
	if err := d.handleBrowserCommand(t.Context(), stream, protocol.Command{Type: protocol.CommandCapabilityBrowserConnect, RunnerID: "computer", Payload: payload}); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) != 2 || stream.events[1].Type != protocol.EventCapabilityBrowserFailed {
		t.Fatalf("another owner reached the browser records: %+v", stream.events)
	}
}

func TestBrowserCommandWithoutManagerReportsUnsupportedStatusAndRejectsMutations(t *testing.T) {
	d := &Daemon{computerID: "computer", owners: []ComputerOwner{{TenantID: "tenant", OwnerActorID: "owner"}}}
	expires := time.Now().Add(time.Minute).UTC().Truncate(time.Second)

	send := func(action string) (protocol.Event, map[string]any) {
		t.Helper()
		payload, _ := json.Marshal(map[string]any{
			"runner_id": "computer", "tenant_id": "tenant", "owner_actor_id": "owner",
			"expires_at": expires, "action": action,
		})
		stream := &browserEventStream{}
		if err := d.handleBrowserCommand(t.Context(), stream, protocol.Command{
			Type: protocol.CommandCapabilityBrowserConnect, RunnerID: "computer", Payload: payload,
		}); err != nil {
			t.Fatal(err)
		}
		if len(stream.events) != 1 {
			t.Fatalf("action %s events=%+v", action, stream.events)
		}
		var body map[string]any
		if err := json.Unmarshal(stream.events[0].Payload, &body); err != nil {
			t.Fatal(err)
		}
		return stream.events[0], body
	}

	event, body := send("status")
	status, _ := body["status"].(map[string]any)
	if event.Type != protocol.EventCapabilityBrowserConnected || body["outcome"] != "succeeded" ||
		status["mode"] != "isolated" || status["state"] != "unsupported" {
		t.Fatalf("status event=%s body=%+v", event.Type, body)
	}

	for _, action := range []string{"configure", "disconnect"} {
		event, body := send(action)
		errBody, _ := body["error"].(map[string]any)
		if event.Type != protocol.EventCapabilityBrowserFailed || body["outcome"] != "failed" ||
			errBody["code"] != "BROWSER_CONNECTION_UNSUPPORTED" {
			t.Fatalf("%s event=%s body=%+v", action, event.Type, body)
		}
	}
}
