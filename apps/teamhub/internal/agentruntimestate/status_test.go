package agentruntimestate

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestResolveRuntimeStatusRoomTreatsDocumentInboxesAsNonPublishable(t *testing.T) {
	docContext := contextRecord{
		ContextKind:  "document",
		AgentActorID: "actor_agent",
		DocumentID:   pgtype.Text{String: "document_1234567890abcdef", Valid: true},
	}
	for _, sources := range [][]string{
		{"document:document_1234567890abcdef"},
		{"document:doc-1.v2:alpha_9"},
		{"document:" + strings.Repeat("a", 255)},
		{"room:room_1", "document:document_1234567890abcdef"},
	} {
		roomID, memberRoomID, publishable, err := resolveRuntimeStatusRoom(context.Background(), nil, docContext, sources)
		if err != nil || publishable || roomID != "" || memberRoomID != "" {
			t.Fatalf("sources=%v got=(%q,%q,%t,%v) want non-publishable nil error",
				sources, roomID, memberRoomID, publishable, err)
		}
	}
}

func TestResolveRuntimeStatusRoomRejectsMalformedDocumentAndUnknownInboxes(t *testing.T) {
	docContext := contextRecord{
		ContextKind:  "document",
		AgentActorID: "actor_agent",
	}
	for _, inboxID := range []string{
		"document:",
		"document:-leading-dash",
		"document:bad/slash",
		"document:has space",
		"document:" + strings.Repeat("a", 256),
		"unknown:123",
	} {
		_, _, publishable, err := resolveRuntimeStatusRoom(context.Background(), nil, docContext, []string{inboxID})
		if !errors.Is(err, ErrInvalid) || publishable {
			t.Fatalf("inbox=%q got=(publishable=%t, err=%v) want ErrInvalid", inboxID, publishable, err)
		}
	}
}

func TestResolveRuntimeStatusRoomPreservesRoomAndPrivateMetaInboxes(t *testing.T) {
	metaContext := contextRecord{
		ContextKind:  "meta",
		AgentActorID: "actor_agent",
	}
	roomID, memberRoomID, publishable, err := resolveRuntimeStatusRoom(context.Background(), nil, metaContext, []string{"room:room_1"})
	if err != nil || !publishable || roomID != "room_1" || memberRoomID != "room_1" {
		t.Fatalf("room inbox got=(%q,%q,%t,%v) want room_1 publishable", roomID, memberRoomID, publishable, err)
	}
	for _, sources := range [][]string{
		{"meta:actor_agent:task_1"},
		{"taskmeta:task_1"},
	} {
		roomID, memberRoomID, publishable, err := resolveRuntimeStatusRoom(context.Background(), nil, metaContext, sources)
		if err != nil || publishable || roomID != "" || memberRoomID != "" {
			t.Fatalf("sources=%v got=(%q,%q,%t,%v) want non-publishable nil error",
				sources, roomID, memberRoomID, publishable, err)
		}
	}
}
