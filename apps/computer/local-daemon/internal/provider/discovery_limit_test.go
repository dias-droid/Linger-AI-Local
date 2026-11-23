package provider

import (
	"fmt"
	"testing"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider/native"
)

func TestNormalizeRuntimeModelsKeepsDefaultBeyondLimit(t *testing.T) {
	catalog := make([]native.ModelOption, 0, 466)
	for i := range 465 {
		catalog = append(catalog, native.ModelOption{ID: fmt.Sprintf("vendor/model-%03d", i)})
	}
	catalog = append(catalog, native.ModelOption{
		ID: "localmodels/localmodels-byok", Label: "Kimi", Default: true, ContextWindow: 1048576,
	})
	models := normalizeRuntimeModels(catalog)
	if len(models) != 100 {
		t.Fatalf("catalog length = %d, want 100", len(models))
	}
	if models[0].ID != "localmodels/localmodels-byok" || !models[0].IsDefault || models[0].ContextWindow != 1048576 {
		t.Fatalf("default gateway model was lost: first = %+v", models[0])
	}
	if models[1].ID != catalog[0].ID || catalog[0].ID != "vendor/model-000" {
		t.Fatal("non-default order or caller catalog changed")
	}
}

func TestNormalizeRuntimeModelsPreservesOrderWithoutDefault(t *testing.T) {
	catalog := make([]native.ModelOption, 125)
	for i := range catalog {
		catalog[i].ID = fmt.Sprintf("vendor/model-%03d", i)
	}
	models := normalizeRuntimeModels(catalog)
	if len(models) != 100 {
		t.Fatalf("catalog length = %d, want 100", len(models))
	}
	for i, model := range models {
		if model.ID != catalog[i].ID {
			t.Fatalf("model %d = %q, want %q", i, model.ID, catalog[i].ID)
		}
	}
}

func TestNormalizeRuntimeModelsSkipsInvalidDefaults(t *testing.T) {
	catalog := []native.ModelOption{{ID: "", Default: true}, {ID: "vendor/other"}, {ID: "vendor/default", Default: true}, {ID: "vendor/default", Default: true}}
	models := normalizeRuntimeModels(catalog)
	if len(models) != 2 || models[0].ID != "vendor/default" || models[1].ID != "vendor/other" {
		t.Fatalf("invalid or duplicate default changed the catalog: %+v", models)
	}
}
