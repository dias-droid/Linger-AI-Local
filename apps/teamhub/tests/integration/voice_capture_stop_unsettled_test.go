package integration_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/livekit/protocol/livekit"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/voicemedia"
	"google.golang.org/protobuf/proto"
)

var errVoiceStagingUnavailable = errors.New("voice staging unavailable")

// unreadableVoiceStaging cannot inspect what a recorder left, so every
// reconciliation of a failed recorder fails.
type unreadableVoiceStaging struct{ stubVoiceMaterializer }

func (unreadableVoiceStaging) InspectSalvagePrefix(context.Context, string) (int64, error) {
	return 0, errVoiceStagingUnavailable
}

func (unreadableVoiceStaging) SegmentCount(context.Context, string, int64) (int64, error) {
	return 0, errVoiceStagingUnavailable
}

func TestVoiceCaptureStopThatNeverSettlesFailsTheCapture(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, q, capture, epoch := newVoiceRecoveryLifecycle(t)
	recorder := newVoiceRecorderRoom(t, env.pool)
	recorder.handle = func(path string, _ []byte) proto.Message {
		if strings.HasSuffix(path, "/DeleteRoom") {
			return &livekit.DeleteRoomResponse{}
		}
		return nil
	}
	recorder.report(t.Context(), epoch.StagingPrefix, "failed", time.Time{}, 0)
	service := voicemedia.New(env.pool, recorder.provider(voicemedia.LiveKitConfig{}, env.pool), unreadableVoiceStaging{})
	reconcile := func() error {
		t.Helper()
		if _, err := env.pool.Exec(t.Context(), "UPDATE voice_media_epochs SET updated_at=clock_timestamp()-interval '3 seconds' WHERE id=$1", epoch.ID); err != nil {
			t.Fatal(err)
		}
		_, err := service.RunJobStepForTest(t.Context(), voicemedia.CaptureReconcileArgs{CaptureSessionID: capture.ID})
		return err
	}
	failures := func() int32 {
		t.Helper()
		current, err := q.GetVoiceMediaEpoch(t.Context(), epoch.ID)
		if err != nil {
			t.Fatal(err)
		}
		return current.StopReconcileFailures
	}

	for range 3 {
		if err := reconcile(); !errors.Is(err, errVoiceStagingUnavailable) {
			t.Fatalf("recording reconciliation err=%v", err)
		}
	}
	if got := failures(); got != 0 {
		t.Fatalf("failures while recording spent the stop budget: %d", got)
	}

	if _, err := service.EndCapture(t.Context(), voicemedia.EndCaptureRequest{AccountID: "account_alice", CaptureSessionID: capture.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.RequestVoiceSessionClose(t.Context(), capture.VoiceSessionID.String); err != nil {
		t.Fatal(err)
	}
	steps := 0
	for ; ; steps++ {
		if steps > 1000 {
			t.Fatal("reconciliation after Stop never ended the Capture")
		}
		err := reconcile()
		current, readErr := q.GetCaptureSessionForAccount(t.Context(), aliceCapture(capture.ID))
		if readErr != nil {
			t.Fatal(readErr)
		}
		if current.Status == "failed" {
			if err != nil {
				t.Fatalf("ending the Capture failed: %v", err)
			}
			break
		}
		if !errors.Is(err, errVoiceStagingUnavailable) || current.Status != "finalizing" {
			t.Fatalf("step %d status=%s err=%v", steps, current.Status, err)
		}
		if got := failures(); got != int32(steps+1) {
			t.Fatalf("step %d counted %d failures", steps, got)
		}
	}
	if steps < 10 {
		t.Fatalf("the Capture ended after only %d failed reconciliations", steps)
	}

	ended, err := q.GetVoiceMediaEpoch(t.Context(), epoch.ID)
	if err != nil || ended.ObservedState != "failed" || ended.DesiredState != "sealed" || ended.LastFailureCode.String != "stop_unsettled" {
		t.Fatalf("unsettled epoch=%+v err=%v", ended, err)
	}
	if count := captureFailedEvents(t, env, capture.RoomID, capture.ID); count != 1 {
		t.Fatalf("capture failed events=%d", count)
	}
	requireVoiceJobQueued(t, env.pool, voicemedia.StagingCleanupArgs{CaptureSessionID: capture.ID}, "unsettled Capture failure")
	if next, err := service.RunJobStepForTest(t.Context(), voicemedia.CaptureStopArgs{CaptureSessionID: capture.ID}); next != voicemedia.JobDone || err != nil {
		t.Fatalf("stop of the ended Capture next=%v err=%v", next, err)
	}
	if next, err := service.RunJobStepForTest(t.Context(), voicemedia.CaptureReconcileArgs{CaptureSessionID: capture.ID}); next != voicemedia.JobDone || err != nil {
		t.Fatalf("reconciliation of the ended Capture next=%v err=%v", next, err)
	}

	// The closing voice session waited on the Capture; it closes now.
	if _, err = env.pool.Exec(t.Context(), "UPDATE voice_sessions SET updated_at=clock_timestamp()-interval '10 seconds' WHERE id=$1", capture.VoiceSessionID.String); err != nil {
		t.Fatal(err)
	}
	if _, err = service.RunJobStepForTest(t.Context(), voicemedia.VoiceSessionReconcileArgs{VoiceSessionID: capture.VoiceSessionID.String}); err != nil {
		t.Fatal(err)
	}
	var voiceStatus string
	if err = env.pool.QueryRow(t.Context(), "SELECT status FROM voice_sessions WHERE id=$1", capture.VoiceSessionID.String).Scan(&voiceStatus); err != nil || voiceStatus != "closed" {
		t.Fatalf("voice session status=%s err=%v", voiceStatus, err)
	}
}
