package app

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomcreation"
)

func TestValidRoomTextCountsCharacters(t *testing.T) {
	t.Parallel()

	han := strings.Repeat("\u6c49", roomcreation.MaxNameRunes)
	if !validRoomText(han, nil) {
		t.Fatal("a Room name of 120 characters must be valid")
	}
	if validRoomText(han+"\u6c49", nil) {
		t.Fatal("a Room name of 121 characters must be rejected")
	}
	if !validRoomText(strings.Repeat("t", 120), nil) || validRoomText(strings.Repeat("t", 121), nil) {
		t.Fatal("the ASCII bound must stay 120 characters")
	}
	if validRoomText("   ", nil) {
		t.Fatal("a blank Room name must be rejected")
	}

	description := strings.Repeat("\u4248", roomcreation.MaxDescriptionRunes)
	if !validRoomText("Room", &description) {
		t.Fatal("a description of 2000 characters must be valid")
	}
	description += "\u4248"
	if validRoomText("Room", &description) {
		t.Fatal("a description of 2001 characters must be rejected")
	}
}

func TestValidRoomUpdateCountsCharacters(t *testing.T) {
	t.Parallel()

	han := strings.Repeat("\u6c49", roomcreation.MaxNameRunes) + "\u6c49"
	if name := han; validRoomUpdate(&name, nil) {
		t.Fatal("a renamed Room of 121 characters must be rejected")
	}
	if name := strings.Repeat("\u6c49", 120); !validRoomUpdate(&name, nil) {
		t.Fatal("a renamed Room of 120 characters must be valid")
	}
	if validRoomUpdate(nil, nil) {
		t.Fatal("an empty update must be rejected")
	}
	blank := "   "
	if validRoomUpdate(&blank, nil) {
		t.Fatal("a blank renamed Room must be rejected")
	}
	description := strings.Repeat("\u4248", roomcreation.MaxDescriptionRunes+1)
	if validRoomUpdate(nil, &description) {
		t.Fatal("a description of 2001 characters must be rejected")
	}
	description = strings.Repeat("\u4248", roomcreation.MaxDescriptionRunes)
	if !validRoomUpdate(nil, &description) {
		t.Fatal("a description of 2000 characters must be valid")
	}
}
