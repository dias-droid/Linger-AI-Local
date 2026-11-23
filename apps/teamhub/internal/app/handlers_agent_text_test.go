package app

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/platform/agenttemplates"
)

func TestValidAgentCreationTextCountsCharacters(t *testing.T) {
	t.Parallel()

	han := strings.Repeat("\u6c49", maxAgentNameRunes)
	if !validAgentCreationText(han, "Instructions") {
		t.Fatal("an Agent name of 120 characters must be valid")
	}
	if validAgentCreationText(han+"\u6c49", "Instructions") {
		t.Fatal("an Agent name of 121 characters must be rejected")
	}
	if !validAgentCreationText(strings.Repeat("t", 120), "Instructions") {
		t.Fatal("the ASCII bound must stay 120 characters")
	}
	if validAgentCreationText("  ", "Instructions") || validAgentCreationText("Agent", "  ") {
		t.Fatal("a blank name or instructions must be rejected")
	}

	instructions := strings.Repeat("\u4248", agenttemplates.MaxInstructionsRunes)
	if !validAgentCreationText("Agent", instructions) {
		t.Fatal("instructions of 50000 characters must be valid")
	}
	if validAgentCreationText("Agent", instructions+"\u4248") {
		t.Fatal("instructions of 50001 characters must be rejected")
	}
}

func TestValidAgentRenameCountsCharacters(t *testing.T) {
	t.Parallel()

	if !validAgentRename(strings.Repeat("\u6c49", 120)) {
		t.Fatal("a rename to 120 characters must be valid")
	}
	if validAgentRename(strings.Repeat("\u6c49", 121)) {
		t.Fatal("a rename to 121 characters must be rejected")
	}
	if !validAgentRename("  " + strings.Repeat("\u6c49", 120) + "  ") {
		t.Fatal("surrounding spaces must not count against the bound")
	}
	if validAgentRename("  ") || validAgentRename("") {
		t.Fatal("a blank rename must be rejected")
	}
}
