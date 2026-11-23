package integration_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentcredential"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/app"
	api "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
)

func TestAgentSkillRecovery(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, sponsor := newAgentProfileMcpEnv(t, &recordingAgentManagement{}, starting(app.JobQueue))
	status, _, body := env.request(sponsor, http.MethodPost, "/v0/tenants/"+acmeTenant+"/agents", map[string]any{
		"name": "Skill publisher", "instructions": "Publish review Skills.", "runtime": fixtureRuntime("gpt-5"),
	}, "register-skill-publisher")
	if status != http.StatusCreated {
		t.Fatalf("register: %d %s", status, body)
	}
	var agent tenantAgentUpdateView
	decode(t, body, &agent)
	roomID := createPrivateRoom(t, env, sponsor, "Review", "review-skills")
	if status, body := putRoomMember(t, env, sponsor, roomID, agent.Actor.ID, "member"); status != http.StatusOK {
		t.Fatalf("membership: %d %s", status, body)
	}
	credential, err := agentcredential.New(env.pool).IssueManaged(t.Context(), agent.AgentManagementID, "Skill recovery")
	if err != nil {
		t.Fatal(err)
	}
	cli := agentCommandCaller{t: t, env: env, token: credential.AccessToken}.in("room", roomID)
	list := func() api.AgentSkillInventory {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, env.server.URL+"/api/agent/v1/skills/bindings", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+cli.token)
		resp, err := env.server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var inventory api.AgentSkillInventory
		if err := json.NewDecoder(resp.Body).Decode(&inventory); err != nil || resp.StatusCode != http.StatusOK {
			t.Fatalf("inventory: %d %v", resp.StatusCode, err)
		}
		return inventory
	}
	initial := list()
	index := slices.IndexFunc(initial.Items, func(item api.AgentSkillInventoryItem) bool { return item.IsDefault && item.Name == "teamhub-files" })
	if index < 0 {
		t.Fatalf("missing default: %+v", initial)
	}
	reserved := initial.Items[index]
	pack := func(name string) []byte { return makeIntegrationSkillZIP(t, name, "Review code changes.", false, nil) }
	status, _, body = env.publishDirectSkillPackage(cli.token, pack(reserved.Name), "default-name")
	var conflict api.AgentApiErrorEnvelope
	decode(t, body, &conflict)
	if status != http.StatusConflict || conflict.Error.Code != api.AgentApiErrorCodeSKILLSETCONFLICT || conflict.Error.Issues == nil ||
		!slices.ContainsFunc(*conflict.Error.Issues, func(issue api.AgentApiErrorIssue) bool {
			return issue.Code == "managed_default_name" && issue.Path == "skill_bindings."+reserved.SkillId
		}) {
		t.Fatalf("conflict: %d %s", status, body)
	}
	publish := func(name string) {
		t.Helper()
		status, _, body := env.publishDirectSkillPackage(cli.token, pack(name), name)
		if status != http.StatusCreated {
			t.Fatalf("publish: %d %s", status, body)
		}
	}
	publish("review-helper")
	first := list()
	idx := slices.IndexFunc(first.Items, func(item api.AgentSkillInventoryItem) bool {
		return item.Name == "review-helper" && !item.IsDefault && item.Enabled
	})
	if idx < 0 || first.BindingVersion != initial.BindingVersion+1 {
		t.Fatalf("explicit inventory: %+v", first)
	}
	skillID := first.Items[idx].SkillId
	unbind := func(id string, version int64, key string) (int, []byte) {
		return cli.post("skills/unbind-requests", map[string]any{"invocation_id": agentInvocation(key), "skill_id": id, "expected_binding_version": version})
	}
	card := func(version int64, key string) agentChangeResult {
		t.Helper()
		status, body := unbind(skillID, version, key)
		var result agentChangeResult
		decode(t, body, &result)
		if status != http.StatusOK || result.Status != "submitted" || result.InteractionID == "" {
			t.Fatalf("request: %d %s", status, body)
		}
		return result
	}
	if status, _ := unbind(reserved.SkillId, first.BindingVersion, "remove-default"); status != http.StatusNotFound {
		t.Fatalf("default removal: %d", status)
	}
	denied := card(first.BindingVersion, "denied")
	decideAgentChange(t, env, sponsor, denied, map[string]any{"decision": "deny"}, "denied")
	if after := list(); after.BindingVersion != first.BindingVersion {
		t.Fatalf("denial changed bindings: %+v", after)
	}
	stale := card(first.BindingVersion, "stale")
	publish("second-review-helper")
	decideAgentChange(t, env, sponsor, stale, map[string]any{"decision": "approve"}, "failed")
	next := list()
	if next.BindingVersion != first.BindingVersion+1 || !slices.ContainsFunc(next.Items, func(item api.AgentSkillInventoryItem) bool { return item.SkillId == skillID }) {
		t.Fatalf("stale approval: %+v", next)
	}
	// An existing binding can become invalid. The recovery list must still
	// show the binding, and a rejected publication must be retryable after removal.
	if _, err := env.pool.Exec(t.Context(), `UPDATE skill_manifests SET state='disabled' WHERE skill_id=$1`, skillID); err != nil {
		t.Fatal(err)
	}
	resourcePath := "/v0/agents/" + agent.AgentManagementID + "/effective-resources"
	resourceStatus, _, resourceBody := agentWorkItemRequest(t, env, http.MethodGet, resourcePath, teamHubInternalToken, "", nil)
	var failure api.AgentApiErrorEnvelope
	decode(t, resourceBody, &failure)
	if resourceStatus != http.StatusConflict || failure.Error.Code != api.AgentApiErrorCodeSKILLSETCONFLICT {
		t.Fatalf("resource resolution for chat recovery: %d %s", resourceStatus, resourceBody)
	}
	failedPackage := pack("retry-after-cleanup")
	status, _, body = env.publishDirectSkillPackage(cli.token, failedPackage, "retry-after-cleanup")
	decode(t, body, &conflict)
	if status != http.StatusConflict || conflict.Error.Issues == nil ||
		!slices.ContainsFunc(*conflict.Error.Issues, func(issue api.AgentApiErrorIssue) bool {
			return issue.Code == "unavailable_binding" && issue.Path == "skill_bindings."+skillID
		}) {
		t.Fatalf("invalid binding diagnostic: %d %s", status, body)
	}
	if broken := list(); broken.Issues == nil || !slices.ContainsFunc(*broken.Issues, func(issue api.AgentApiErrorIssue) bool {
		return issue.Path == "skill_bindings."+skillID && issue.Code == "unavailable_binding"
	}) || !slices.ContainsFunc(broken.Items, func(item api.AgentSkillInventoryItem) bool { return item.SkillId == skillID }) {
		t.Fatalf("missing stale binding: %+v", broken)
	}
	approved := card(next.BindingVersion, "approved")
	if retry := card(next.BindingVersion, "approved"); retry != approved {
		t.Fatalf("pending replay: %+v", retry)
	}
	second := slices.IndexFunc(next.Items, func(item api.AgentSkillInventoryItem) bool { return item.Name == "second-review-helper" })
	if second < 0 {
		t.Fatalf("missing second binding: %+v", next)
	}
	status, body = unbind(next.Items[second].SkillId, next.BindingVersion, "approved")
	var reused api.AgentApiErrorEnvelope
	decode(t, body, &reused)
	if status != http.StatusConflict || reused.Error.Code != api.AgentApiErrorCodeIdempotencyConflict {
		t.Fatalf("reused approval for a different Skill: %d %s", status, body)
	}
	if current := list(); current.BindingVersion != next.BindingVersion {
		t.Fatalf("changed before approval: %+v", current)
	}
	decideAgentChange(t, env, sponsor, approved, map[string]any{"decision": "approve"}, "succeeded")
	var jobKind string
	if err := env.pool.QueryRow(t.Context(), `SELECT kind FROM river_job WHERE args->>'decision_id'=$1 AND kind LIKE 'decision.%' AND kind <> 'decision.expire' ORDER BY id DESC LIMIT 1`, approved.InteractionID).Scan(&jobKind); err != nil || jobKind != "decision.skill_unbind" {
		t.Fatalf("approval routed to %q: %v", jobKind, err)
	}
	final := list()
	if final.BindingVersion != next.BindingVersion+1 || slices.ContainsFunc(final.Items, func(item api.AgentSkillInventoryItem) bool { return item.SkillId == skillID }) {
		t.Fatalf("approved removal: %+v", final)
	}
	if retry := card(next.BindingVersion, "approved"); retry != approved {
		t.Fatalf("completed replay: %+v", retry)
	}
	if status, _ := unbind(skillID, next.BindingVersion, "stale-new-request"); status != http.StatusConflict {
		t.Fatalf("new stale request: %d", status)
	}
	status, _, body = env.publishDirectSkillPackage(cli.token, failedPackage, "retry-after-cleanup")
	if status != http.StatusCreated {
		t.Fatalf("retry after approval: %d %s", status, body)
	}
	if !slices.ContainsFunc(list().Items, func(item api.AgentSkillInventoryItem) bool { return item.Name == "retry-after-cleanup" && item.Enabled }) {
		t.Fatal("retried Skill is missing")
	}
	installed := list()
	idx = slices.IndexFunc(installed.Items, func(item api.AgentSkillInventoryItem) bool { return item.Name == "retry-after-cleanup" })
	skillID = installed.Items[idx].SkillId
	remove := card(installed.BindingVersion, "remove-installed")
	decideAgentChange(t, env, sponsor, remove, map[string]any{"decision": "approve"}, "succeeded")
	removed := list()
	status, _, body = env.publishDirectSkillPackage(cli.token, failedPackage, "retry-after-cleanup")
	var receipt struct {
		Replayed  bool
		Unchanged bool
		SkillID   string `json:"skill_id"`
	}
	decode(t, body, &receipt)
	if status != http.StatusCreated || !receipt.Replayed || list().BindingVersion != removed.BindingVersion {
		t.Fatalf("network retry changed a removed binding: %d %s", status, body)
	}
	status, _, body = env.publishDirectSkillPackage(cli.token, failedPackage, "new-install")
	decode(t, body, &receipt)
	restored := list()
	if status != http.StatusCreated || receipt.Replayed || receipt.SkillID != skillID || restored.BindingVersion != removed.BindingVersion+1 || !slices.ContainsFunc(restored.Items, func(item api.AgentSkillInventoryItem) bool {
		return item.SkillId == skillID && item.Enabled && item.ManifestVersion == installed.Items[idx].ManifestVersion
	}) {
		t.Fatalf("reinstall did not restore the original Skill: %d %s %+v", status, body, restored)
	}
	status, _, body = env.publishDirectSkillPackage(cli.token, failedPackage, "already-installed")
	decode(t, body, &receipt)
	if status != http.StatusCreated || !receipt.Unchanged || list().BindingVersion != restored.BindingVersion {
		t.Fatalf("identical installed package: %d %s", status, body)
	}
	resourceStatus, _, resourceBody = agentWorkItemRequest(t, env, http.MethodGet, resourcePath, teamHubInternalToken, "", nil)
	if resourceStatus != http.StatusOK {
		t.Fatalf("repaired runtime resources: %d %s", resourceStatus, resourceBody)
	}

}
