package typedcard

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// AgentChangeView is what the sponsor reads on an Agent change decision.
type AgentChangeView struct {
	// Action is "create" or "update".
	Action        string        `json:"action"`
	TargetActorID string        `json:"target_actor_id,omitempty"`
	AgentName     string        `json:"agent_name"`
	Changes       []AgentChange `json:"changes"`
}

// AgentChange is one field's current and new value.
type AgentChange struct {
	// Field identifies a profile field.
	Field  string  `json:"field"`
	Before *string `json:"before,omitempty"`
	After  string  `json:"after"`
}

// AgentChangeRequest is the exact change an Agent change decision runs. An
// update names its target and the configuration revision the card showed.
type AgentChangeRequest struct {
	TargetActorID    string `json:"target_actor_id,omitempty"`
	ExpectedRevision int64  `json:"expected_revision,omitempty"`
	// Change is the stored profile change, in the shape the app reads.
	Change any                   `json:"change,omitempty"`
	Unbind *SkillUnbindSelection `json:"unbind,omitempty"`
}

// SkillUnbindSelection pins Sponsor approval to one Skill and inventory revision.
type SkillUnbindSelection struct {
	SkillID        string `json:"skill_id"`
	BindingVersion int64  `json:"binding_version"`
}

// AgentChangeDecision binds a decision card to the exact change it runs.
type AgentChangeDecision struct {
	Request AgentChangeRequest
	View    AgentChangeView
	// UnbindView uses the established tool confirmation shape on mixed Web and TeamHub versions.
	UnbindView *ConnectorWriteView
	// ValidateNew checks the selected binding after receipt replay and before posting the card.
	ValidateNew func(context.Context, *store.Queries) error
}

// agentChangeTitle is the card's title, the same in the Room and in the
// Agent's notice.
func agentChangeTitle(view AgentChangeView) string {
	if view.Action == "create" {
		return "Create Agent “" + view.AgentName + "”"
	}
	return "Change Agent “" + view.AgentName + "”"
}

func agentChangeNoticeText(decisionID string, view AgentChangeView, status, comment string, result decisionStoredResult) string {
	prefix := fmt.Sprintf("Agent change confirmation %s (%s): ", decisionID, agentChangeTitle(view))
	switch status {
	case "succeeded":
		if view.Action == "create" {
			var created struct {
				ActorID string `json:"actor_id"`
			}
			_ = json.Unmarshal(result.Data, &created)
			return prefix + fmt.Sprintf("the sponsor approved it and TeamHub created the Agent (actor_id %s). It joined no Room; the sponsor can talk to it in its direct chat.", created.ActorID)
		}
		return prefix + "the sponsor approved it and TeamHub applied the change."
	case "failed":
		return prefix + "the sponsor approved it, but it was not applied: " + result.Outcome
	case "denied":
		return deniedNotice(prefix+"the sponsor denied it, so nothing changed.", comment)
	default:
		return prefix + "nobody approved it within 24 hours, so nothing changed."
	}
}
