package native

import (
	"context"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestClaudeCatalog(t *testing.T) {
	list, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", nil))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Models) != 3 {
		t.Fatalf("models = %+v", list.Models)
	}
	first, second := list.Models[0], list.Models[1]
	if first.ID != "organization-alias" || first.Default || first.Label != "Organization" || first.Provider != "anthropic" {
		t.Fatalf("first = %+v", first)
	}
	if first.Effort == nil || first.Effort.Default != "" ||
		!reflect.DeepEqual(first.Effort.Options, []EffortOption{{Value: "high", Label: "High"}, {Value: "ultra", Label: "Ultra"}}) {
		t.Fatalf("first effort = %+v", first.Effort)
	}
	if second.ID != "quick-model" || second.Label != "quick-model" || second.Effort != nil || second.Default {
		t.Fatalf("second = %+v", second)
	}
}

// --bare makes Claude ignore the settings env a turn applies (gateway base URL,
// model mappings, gateway model discovery), so the list would name models a
// turn never runs.
func TestClaudeCatalogReadsTheSettingsATurnUses(t *testing.T) {
	if slices.Contains(claudeCatalogArgs, "--bare") {
		t.Fatalf("catalog argv %q skips the user settings a turn reads", claudeCatalogArgs)
	}
	if !slices.Contains(claudeCatalogArgs, "--safe-mode") {
		t.Fatalf("catalog argv %q must keep customizations off", claudeCatalogArgs)
	}
}

func TestClaudeCatalogRejection(t *testing.T) {
	list, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", map[string]string{"FIXTURE_MODE": "reject"}))
	if err == nil || !strings.Contains(err.Error(), "Claude rejected catalog initialization") || len(list.Models) != 0 {
		t.Fatalf("list = %+v, err = %v", list, err)
	}
}

func TestDiscoveryWithCancelledContextFailsFast(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, kind := range []string{"claude", "codex"} {
		started := time.Now()
		if _, err := DiscoverModels(ctx, kind, fixtureInvocation(t, "block", nil)); err == nil {
			t.Fatalf("%s discovery succeeded", kind)
		}
		if elapsed := time.Since(started); elapsed > time.Second {
			t.Fatalf("%s discovery took %s", kind, elapsed)
		}
	}
	if _, err := DiscoverModels(context.Background(), "hermes", Invocation{}); err == nil || !strings.Contains(err.Error(), "hermes") {
		t.Fatalf("unknown kind error = %v", err)
	}
}

func TestCatalogExchangeLimits(t *testing.T) {
	large := strings.Repeat("x", catalogBootstrapLimit)
	err := exchangeCatalog(context.Background(), fixtureInvocation(t, "block", nil), nil, []any{large}, nil)
	if err == nil || err.Error() != "catalog request exceeds bootstrap limit" {
		t.Fatalf("bootstrap error = %v", err)
	}
	err = exchangeCatalog(context.Background(), fixtureInvocation(t, "print", map[string]string{"FIXTURE_STDOUT": "{}\n"}), nil, nil,
		func([]byte, func(...any) error) (bool, error) { return false, nil })
	if err == nil || err.Error() != "catalog process closed before the expected response" {
		t.Fatalf("missing done error = %v", err)
	}
	err = exchangeCatalog(context.Background(), fixtureInvocation(t, "print", map[string]string{"FIXTURE_STDOUT": "{}\n", "FIXTURE_EXIT": "3"}), nil, nil,
		func([]byte, func(...any) error) (bool, error) { return false, nil })
	if err == nil || !strings.HasPrefix(err.Error(), "catalog process failed: ") {
		t.Fatalf("process error = %v", err)
	}
}

func TestCatalogTokenAndEffortRules(t *testing.T) {
	for token, valid := range map[string]bool{"gpt-5": true, "": false, "a b": false, "a\x7f": false, strings.Repeat("m", 160): true, strings.Repeat("m", 161): false} {
		if validCatalogToken(token) != valid {
			t.Fatalf("validCatalogToken(%q) != %v", token, valid)
		}
	}
	for value, label := range map[string]string{"xhigh": "Extra high", "off": "Off", "minimal": "Minimal", "ultra": "Ultra", "custom": "custom"} {
		if effortLabel(value) != label {
			t.Fatalf("effortLabel(%q) = %q", value, effortLabel(value))
		}
	}
}

func TestClaudeCatalogPreservesNativeChoicesAndVersions(t *testing.T) {
	list, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", map[string]string{
		"FIXTURE_MODELS": `[
   {"value":"default","resolvedModel":"claude-opus-5-5","displayName":"Default (recommended)","description":"Use the default model (currently Opus 5.5) · pricing"},
   {"value":"opus","resolvedModel":"claude-opus-5-5","displayName":"Opus","description":"Opus 5.5 · Best for everyday tasks","supportsEffort":true,"supportedEffortLevels":["low","high"]},
   {"value":"claude-fable-5-1[1m]","resolvedModel":"claude-fable-5-1","displayName":"Fable","description":"Fable 5.1 · Most capable"},
   {"value":"sonnet","resolvedModel":"claude-sonnet-5-5","displayName":"Sonnet","description":"Sonnet 5.5 · Efficient"},
   {"value":"custom-future","resolvedModel":"organization-model","displayName":"Custom","description":"Organization 42 · A future catalog entry"},
   {"value":"opus","displayName":"Duplicate"},
   {"value":"no-description","displayName":"Fallback"},
   {"resolvedModel":"resolved-only","displayName":"Resolved only"},
   {"value":"invalid token"}
  ]`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	var ids, labels []string
	for _, model := range list.Models {
		ids = append(ids, model.ID)
		labels = append(labels, model.Label)
	}
	wantIDs := []string{"default", "opus", "claude-fable-5-1[1m]", "sonnet", "custom-future", "no-description", "resolved-only",
		"claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "organization-model"}
	wantLabels := []string{"Default (recommended) · Use the default model (currently Opus 5.5)", "Opus 5.5", "Fable 5.1", "Sonnet 5.5", "Organization 42", "Fallback", "Resolved only",
		"claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "organization-model"}
	if !reflect.DeepEqual(ids, wantIDs) || !reflect.DeepEqual(labels, wantLabels) {
		t.Fatalf("models = %+v", list.Models)
	}
	for _, model := range list.Models {
		_, argv := claudeBuildArgv(claudeQuietLogger(), claudeSpec(RunSpec{Model: model.ID}))
		if !slices.Equal(claudeFlagValue(argv, "--model"), []string{model.ID}) {
			t.Fatalf("choice %q changed during launch", model.ID)
		}
	}
	if !list.Models[0].Default || list.Models[1].Default || list.Models[1].Effort == nil || len(list.Models[1].Effort.Options) != 2 {
		t.Fatalf("choice metadata = %+v", list.Models)
	}
	var resolved []string
	for _, model := range list.Models {
		resolved = append(resolved, model.Resolved)
	}
	if want := []string{"claude-opus-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "organization-model", "", "", "", "", "", ""}; !reflect.DeepEqual(resolved, want) {
		t.Fatalf("resolved = %q", resolved)
	}
	// An agent pinned to the concrete id keeps the efforts of the alias that
	// declares them, even when the default alias resolving to it does not.
	if pinned := list.Models[7]; pinned.Default || pinned.Effort == nil || len(pinned.Effort.Options) != 2 {
		t.Fatalf("concrete choice = %+v", pinned)
	}
}

func TestClaudeCatalogPreservesDistinctLabelsForGatewayModels(t *testing.T) {
	list, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", map[string]string{
		"FIXTURE_MODELS": `[
   {"value":"default","displayName":"Default (recommended)","description":"via magpie"},
   {"value":"auto/deepseek-v4.1-flash-1017[1m]","displayName":"auto/deepseek-v4.1-flash-1017[1m]","description":"via magpie"},
   {"value":"sub2api-codex/gpt-6.1-sol","displayName":"sub2api-codex/gpt-6.1-sol","description":"via magpie"},
   {"value":"sub2api-claude/claude-fable-5-2[1m]","displayName":"sub2api-claude/claude-fable-5-2[1m]","description":"via magpie"},
   {"value":"opus","displayName":"Opus","description":"via magpie"},
   {"value":"sonnet","displayName":"Sonnet","description":"via magpie"},
   {"value":"haiku","displayName":"Haiku","description":"via magpie"},
   {"value":"mistral/deepseek-v4-1-flash-1017[1m]","displayName":"","description":"via magpie"}
  ]`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	var ids, labels []string
	for _, model := range list.Models {
		ids = append(ids, model.ID)
		labels = append(labels, model.Label)
	}
	wantIDs := []string{
		"default",
		"auto/deepseek-v4.1-flash-1017[1m]",
		"sub2api-codex/gpt-6.1-sol",
		"sub2api-claude/claude-fable-5-2[1m]",
		"opus",
		"sonnet",
		"haiku",
		"mistral/deepseek-v4-1-flash-1017[1m]",
	}
	wantLabels := []string{
		"Default (recommended) · via magpie",
		"auto/deepseek-v4.1-flash-1017[1m]",
		"sub2api-codex/gpt-6.1-sol",
		"sub2api-claude/claude-fable-5-2[1m]",
		"Opus",
		"Sonnet",
		"Haiku",
		"mistral/deepseek-v4-1-flash-1017[1m]",
	}
	if !reflect.DeepEqual(ids, wantIDs) || !reflect.DeepEqual(labels, wantLabels) {
		t.Fatalf("models = %+v", list.Models)
	}
}

func TestClaudeCatalogHandlesSharedSummaryAndSinglePlainDescription(t *testing.T) {
	t.Run("shared dot summary falls back to display name or id", func(t *testing.T) {
		list, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", map[string]string{
			"FIXTURE_MODELS": `[
    {"value":"sub2api-codex/gpt-6.1-sol","displayName":"GPT 6.1 Sol","description":"via magpie · 200K context"},
    {"value":"sub2api-claude/claude-fable-5-2[1m]","displayName":"","description":"via magpie · 1M context"},
    {"value":"opus","displayName":"Opus","description":"Opus 5.5 · Best for everyday tasks"},
    {"value":"opus[1m]","displayName":"Opus (1M)","description":"Opus 5.5 · 1M context"},
    {"value":"sonnet","displayName":"Sonnet","description":"Sonnet 5.5 · Efficient"}
   ]`,
		}))
		if err != nil {
			t.Fatal(err)
		}
		var labels []string
		for _, model := range list.Models {
			labels = append(labels, model.Label)
		}
		want := []string{
			"GPT 6.1 Sol",
			"sub2api-claude/claude-fable-5-2[1m]",
			"Opus",
			"Opus (1M)",
			"Sonnet 5.5",
		}
		if !reflect.DeepEqual(labels, want) {
			t.Fatalf("labels = %q, want %q", labels, want)
		}
	})
	t.Run("single entry with plain description keeps display name or id", func(t *testing.T) {
		list, err := DiscoverModels(context.Background(), "claude", fixtureInvocation(t, "claude-catalog", map[string]string{
			"FIXTURE_MODELS": `[
    {"value":"sub2api-codex/gpt-6.1-sol","displayName":"GPT 6.1 Sol","description":"via magpie"}
   ]`,
		}))
		if err != nil {
			t.Fatal(err)
		}
		if len(list.Models) != 1 || list.Models[0].Label != "GPT 6.1 Sol" {
			t.Fatalf("models = %+v", list.Models)
		}
	})
}
