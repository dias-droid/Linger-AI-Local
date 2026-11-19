package provider

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider/native"
	localworkspace "github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/workspace"
)

func invokePiModel(ctx context.Context, request ModelInvokeRequest, installed ModelInvokeRuntime, work, scratch string) ModelInvokeResult {
	if request.Mode == ModelInvokeWorkspace {
		return ModelInvokeResult{Outcome: ModelInvokeRuntimeUnavailable, Reason: "Pi background calls do not run file tools"}
	}
	environment := modelInvokeEnvironment(installed.Environment, scratch)
	// The verified loopback endpoint must not be routed through a user proxy.
	for key := range environment {
		switch strings.ToUpper(key) {
		case "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY":
			delete(environment, key)
		}
	}
	environment, err := localworkspace.PiSourceEnvironment(environment)
	if err != nil {
		return ModelInvokeResult{Outcome: ModelInvokeRuntimeUnavailable, Reason: "Pi background profile is unavailable"}
	}
	instructions := request.Instructions
	if request.Mode == ModelInvokeStructured {
		instructions += "\n\nReturn only a JSON object matching this schema:\n" + string(request.OutputSchema)
	}
	instructionsFile := ""
	if instructions != "" {
		instructionsFile = filepath.Join(scratch, "instructions.md")
		if err := os.WriteFile(instructionsFile, []byte(instructions), 0o600); err != nil {
			return ModelInvokeResult{Outcome: ModelInvokeFailed, Reason: "Could not prepare Pi background instructions"}
		}
	}
	invokeCtx, cancel := context.WithTimeout(ctx, modelInvokeTimeout(request.Timeout))
	defer cancel()
	answer, model, err := native.InvokePiModel(
		invokeCtx, native.Profile{Program: installed.ExecutablePath, Env: environment},
		work, instructionsFile, request.Input, request.ReasoningEffort, installed.LoadedPiModels,
	)
	switch {
	case invokeCtx.Err() != nil:
		return classifyModelInvokeFailure(ctx, invokeCtx, err, "", "")
	case errors.Is(err, native.ErrPiLocalModelUnavailable):
		return ModelInvokeResult{Outcome: ModelInvokeRuntimeUnavailable, Reason: err.Error()}
	case err != nil || answer.Status != "completed" || !answer.ExitConfirmed:
		// Pi errors may include provider URLs or credentials.
		return ModelInvokeResult{Outcome: ModelInvokeFailed, Reason: "Pi background call did not complete"}
	case len(answer.Output) > ModelInvokeMaxTextBytes:
		return ModelInvokeResult{Outcome: ModelInvokeOutputLimited, Reason: "Pi background reply exceeds 1 MiB"}
	}
	result := ModelInvokeResult{Outcome: ModelInvokeCompleted, Text: answer.Output, Model: model}
	for _, count := range answer.Usage {
		if result.Usage == nil {
			result.Usage = &ModelInvokeUsage{}
		}
		result.Usage.InputTokens += count.Input
		result.Usage.OutputTokens += count.Output
		result.Usage.CachedInputTokens += count.CacheRead
	}
	return result
}
