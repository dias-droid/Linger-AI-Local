package agentregistry

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentauth"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/skill"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
	api "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
)

// OwnSkillInventory reads defaults and explicit bindings at the same revision, even if the effective set is invalid.
func (s *Service) OwnSkillInventory(ctx context.Context, authorizer agentauth.Authorizer, token string) (api.AgentSkillInventory, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return api.AgentSkillInventory{}, err
	}
	defer tx.Rollback(ctx)
	auth, err := authorizer.AuthorizeInTx(ctx, tx, token, "list_skill_bindings")
	if err != nil {
		return api.AgentSkillInventory{}, err
	}
	q := store.New(tx)
	revision, err := q.GetAgentSkillBindingVersion(ctx, auth.AgentActorID)
	if err != nil {
		return api.AgentSkillInventory{}, err
	}
	defaults, err := q.ListAllowedRequiredPlatformSkillSnapshotPackagesForAgent(ctx, auth.AgentActorID)
	if err != nil {
		return api.AgentSkillInventory{}, err
	}
	bindings, err := q.ListExplicitSkillInventory(ctx, store.ListExplicitSkillInventoryParams{TenantID: auth.TenantID, AgentActorID: auth.AgentActorID})
	if err != nil {
		return api.AgentSkillInventory{}, err
	}
	items := make([]api.AgentSkillInventoryItem, 0, len(defaults)+len(bindings))
	for _, row := range defaults {
		items = append(items, api.AgentSkillInventoryItem{SkillId: row.SkillID, Name: row.Name, ManifestVersion: row.ManifestVersion, IsDefault: true, Enabled: true})
	}
	for _, row := range bindings {
		items = append(items, api.AgentSkillInventoryItem{SkillId: row.SkillID, Name: row.Name, ManifestVersion: row.ManifestVersion, Enabled: row.Enabled})
	}
	inventory := api.AgentSkillInventory{BindingVersion: revision, Items: items}
	if err := skill.ValidateEffectiveInTx(ctx, tx, skill.Identity{TenantID: auth.TenantID, AgentActorID: auth.AgentActorID, AgentType: auth.AgentType}); err != nil {
		issues := SkillBindingIssues(err)
		if len(issues) == 0 {
			return api.AgentSkillInventory{}, err
		}
		inventory.Issues = &issues
	}
	return inventory, tx.Commit(ctx)
}

// PrepareOwnSkillUnbind builds a Sponsor decision bound to the caller, Skill ID and observed revision.
func (s *Service) PrepareOwnSkillUnbind(ctx context.Context, authorizer agentauth.Authorizer, token string, request api.AgentSkillUnbindRequest) (AgentChange, error) {
	auth, err := authorizer.Authorize(ctx, token, "request_skill_unbind")
	if err != nil {
		return AgentChange{}, err
	}
	labels, err := s.queries.GetSkillUnbindCardLabels(ctx, store.GetSkillUnbindCardLabelsParams{TenantID: auth.TenantID, AgentActorID: auth.AgentActorID, SkillID: request.SkillId})
	if err != nil {
		return AgentChange{}, err
	}
	selection := typedcard.SkillUnbindSelection{SkillID: request.SkillId, BindingVersion: request.ExpectedBindingVersion}
	input, err := json.Marshal(selection)
	if err != nil {
		return AgentChange{}, err
	}
	return AgentChange{Auth: auth, Confirm: &typedcard.AgentChangeDecision{
		Request: typedcard.AgentChangeRequest{TargetActorID: auth.AgentActorID, Unbind: &selection},
		UnbindView: &typedcard.ConnectorWriteView{
			Kind: "change", App: "teamhub", Title: "Remove Skill " + labels.SkillName, Account: labels.AgentName,
			Tool: "teamhub skill unbind", Input: string(input),
			Fields: []typedcard.ConnectorWriteField{{Label: "Agent", Value: labels.AgentName}, {Label: "Skill to remove", Value: labels.SkillName + " (" + selection.SkillID + ")"}},
		},
		ValidateNew: func(ctx context.Context, q *store.Queries) error {
			current, err := q.HasExplicitSkillBindingAtVersion(ctx, store.HasExplicitSkillBindingAtVersionParams{
				TenantID: auth.TenantID, AgentActorID: auth.AgentActorID,
				SkillID: selection.SkillID, ExpectedBindingVersion: selection.BindingVersion,
			})
			if err != nil {
				return err
			}
			if !current {
				return ErrAgentSkillBindingConflict
			}
			return nil
		},
	}}, nil
}

// SkillBindingIssues describes a Skill policy conflict without exposing binding configuration.
func SkillBindingIssues(err error) []api.AgentApiErrorIssue {
	var conflict *skill.PolicyConflict
	if !errors.As(err, &conflict) {
		return nil
	}
	if len(conflict.References) == 0 {
		return []api.AgentApiErrorIssue{{Path: "skill_bindings", Code: conflict.Code, Message: conflict.Reason}}
	}
	issues := make([]api.AgentApiErrorIssue, 0, len(conflict.References))
	for _, id := range conflict.References {
		issues = append(issues, api.AgentApiErrorIssue{Path: "skill_bindings." + id, Code: conflict.Code, Message: conflict.Reason})
	}
	return issues
}
