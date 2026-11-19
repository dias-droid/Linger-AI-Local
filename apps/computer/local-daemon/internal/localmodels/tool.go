// Package localmodels runs the installer's localmodels tool for the Daemon.
// It reads `library status`, starts the library actions a Computer owner
// chose, supervises the long ones (download, load), and maps the tool's
// localmodels.library-status/v1 into the Runner Gateway LocalModelsSnapshot.
// It never chooses a model: every action names the model the owner picked.
package localmodels

import (
	"os"
	"os/exec"
	"strings"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/workspace"
)

// Tool is where the installer put the localmodels tool and its state, as
// the Computer config records it.
type Tool struct {
	Python          string
	ModuleDirectory string
	StateDirectory  string
	BaseDirectory   string
}

// Action is one owner-chosen library action. Model is empty only for
// refresh; UnloadFirst is only for load.
type Action struct {
	Name        string
	Model       string
	UnloadFirst []string
}

// Action names, as the Runner Gateway sends them.
const (
	ActionDownload = "download"
	ActionCancel   = "cancel"
	ActionLoad     = "load"
	ActionUnload   = "unload"
	ActionRemove   = "remove"
	ActionRefresh  = "refresh"
)

// arguments are the `library` arguments of one call. Model ids are validated
// by the caller, so none starts with "-".
func (t Tool) arguments(action Action) []string {
	args := []string{"-P", "-s", "-m", "localmodels", "library"}
	switch action.Name {
	case ActionRefresh:
		return append(args, "status", "--base-dir", t.BaseDirectory, "--json")
	case ActionDownload:
		return append(args, "download", action.Model, "--base-dir", t.BaseDirectory, "--jsonl")
	case ActionLoad:
		args = append(args, "load", action.Model)
		for _, other := range action.UnloadFirst {
			args = append(args, "--unload", other)
		}
		return append(args, "--base-dir", t.BaseDirectory, "--jsonl")
	default:
		return append(args, action.Name, action.Model, "--base-dir", t.BaseDirectory, "--json")
	}
}

// command builds one library invocation for the tool.
func (t Tool) command(environment map[string]string, action Action) *exec.Cmd {
	return t.commandArgs(environment, t.arguments(action))
}

// commandArgs builds one tool invocation the way the installer runs it: the
// sealed kit on PYTHONPATH and as the working directory, no user site
// packages, no bytecode writes into the sealed kit, and PI_CODING_AGENT_DIR
// aligned with OverlayEnvironment (local mode) and workspace.PiSourceEnvironment
// so models written by localmodels reach the same Pi agent profile that the
// Daemon probes and runs.
func (t Tool) commandArgs(environment map[string]string, args []string) *exec.Cmd {
	cmd := exec.Command(t.Python, args...)
	cmd.Dir = t.ModuleDirectory
	values := make(map[string]string, len(environment)+5)
	var explicitPiDir string
	for key, value := range environment {
		upper := strings.ToUpper(key)
		switch upper {
		case "PYTHONHOME", "PYTHONSTARTUP", "PYTHONINSPECT", "PYTHONPATH", "LOCALMODELS_STATE":
			continue
		case "PI_CODING_AGENT_DIR":
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				explicitPiDir = trimmed
			}
			continue
		}
		values[key] = value
	}
	if explicitPiDir != "" {
		values["PI_CODING_AGENT_DIR"] = explicitPiDir
	} else if overlay := ReadOverlay(t.StateDirectory); overlay != nil && overlay.Mode == "local" {
		if overlaid := OverlayEnvironment(values, t.StateDirectory); overlaid["PI_CODING_AGENT_DIR"] != "" {
			values["PI_CODING_AGENT_DIR"] = overlaid["PI_CODING_AGENT_DIR"]
		}
	}
	if values["PI_CODING_AGENT_DIR"] == "" {
		if piEnv, err := workspace.PiSourceEnvironment(values); err == nil && piEnv["PI_CODING_AGENT_DIR"] != "" {
			values["PI_CODING_AGENT_DIR"] = piEnv["PI_CODING_AGENT_DIR"]
		}
	}
	values["PYTHONPATH"] = t.ModuleDirectory
	values["LOCALMODELS_STATE"] = t.StateDirectory
	values["PYTHONNOUSERSITE"] = "1"
	values["PYTHONDONTWRITEBYTECODE"] = "1"
	cmd.Env = make([]string, 0, len(values))
	for key, value := range values {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	return cmd
}

// installed reports whether the configured interpreter still exists.
func (t Tool) installed() bool {
	info, err := os.Stat(t.Python)
	return err == nil && info.Mode().IsRegular()
}
