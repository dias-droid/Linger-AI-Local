package native

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/netip"
	"net/url"
	"slices"
	"strings"
)

// ErrPiLocalModelUnavailable means Pi has no verified loaded local default.
// Do not send a background prompt to an unverified endpoint.
var ErrPiLocalModelUnavailable = errors.New("Pi background calls need a loaded local model selected as Pi's default")

// InvokePiModel runs a single tool-free RPC turn with the same Pi profile and
// event handling as managed execution, but with no persistent session.
func InvokePiModel(ctx context.Context, profile Profile, dir, instructionsFile, prompt, effort string, loadedModels []string) (Outcome, string, error) {
	if len(loadedModels) == 0 {
		return Outcome{}, "", ErrPiLocalModelUnavailable
	}
	thinking, err := piThinkingLevel(effort)
	if err != nil {
		return Outcome{}, "", err
	}
	args := append([]string{"--mode", "rpc", "--no-session", "--no-tools"}, PiRPCResourceArgs()...)
	if instructionsFile != "" {
		args = append(args, "--append-system-prompt", instructionsFile)
	}
	if thinking != "" {
		args = append(args, "--thinking", thinking)
	}
	profile.Logger = slog.Default()
	procCtx, stop := context.WithCancel(context.Background())
	defer stop()
	cmd := ownedCommand(procCtx, profileInvocation(profile.Program, nil, profile.Env), args...)
	cmd.Dir, cmd.WaitDelay = dir, piChildPipeDrain
	proc, err := piLaunch(profile, cmd)
	if err != nil {
		return Outcome{}, "", err
	}
	proc.sessionDir, proc.cancel = dir, stop
	proc.res.bind(dir, profile)
	proc.run()
	defer func() {
		if proc.stop() {
			piResidents.forget(proc)
		} else {
			piResidents.hold(proc)
		}
	}()

	probeCtx, cancelProbe := context.WithTimeout(ctx, piStartupBudget)
	state, err := proc.call(probeCtx, "get_state", nil, nil)
	cancelProbe()
	if err != nil {
		return Outcome{}, "", errors.New("Pi background model state could not be read")
	}
	var catalog piCatalogState
	if json.Unmarshal(state.Data, &catalog) != nil {
		return Outcome{}, "", ErrPiLocalModelUnavailable
	}
	model := catalog.Model.Provider + "/" + catalog.Model.ID
	if !slices.Contains(loadedModels, model) || !piLoopbackURL(catalog.Model.BaseURL) {
		return Outcome{}, "", ErrPiLocalModelUnavailable
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	turn := newPiTurn(runCtx, cancel, proc, false, releaseFence{}, profile.Logger)
	turn.oneShot = true
	if err := proc.bind(turn); err != nil {
		return Outcome{}, "", err
	}
	go turn.drive(prompt)
	for range turn.events {
	}
	return <-turn.outcome, model, nil
}

func piLoopbackURL(raw string) bool {
	endpoint, err := url.Parse(raw)
	if err != nil || endpoint.User != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return false
	}
	host := endpoint.Hostname()
	ip, err := netip.ParseAddr(host)
	return (err == nil && ip.Unmap().IsLoopback()) || strings.EqualFold(host, "localhost")
}
