package websearch

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestKeenableSearchesWithoutAKeyOnlyWhenNamed(t *testing.T) {
	page := strings.Repeat("page text\n\n", 200)
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch r.path {
		case "/keenable/v1/search/public":
			writeJSON(w, 200, `{"results":[{"title":"K","url":"https://k.example/a","description":"","snippet":"`+
				strings.ReplaceAll(page, "\n", `\n`)+`","acquired_at":"2026-11-20T00:00:00Z"},{"title":"bad","url":"ftp://k.example"}]}`)
		case "/ddg/html/":
			_, _ = w.Write([]byte(`<html><body></body></html>`))
		default:
			t.Errorf("unexpected %s %s", r.method, r.path)
		}
	})
	s, keys := newTestService(t, fake)
	request, err := Normalize(Request{Command: CommandSearch, Backend: Keenable, Query: "q", Limit: 4, Recency: "week",
		Sites: []string{"docs.example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := s.Run(t.Context(), request)
	if err != nil || outcome.Backend != Keenable || len(outcome.Results) != 1 || outcome.Results[0].Title != "K" ||
		outcome.Results[0].URL != "https://k.example/a" || outcome.Results[0].PublishedAt != "" {
		t.Fatalf("Run = %+v, %v", outcome, err)
	}
	if snippet := outcome.Results[0].Snippet; utf8.RuneCountInString(snippet) != maxSnippetRunes || strings.Contains(snippet, "\n") {
		t.Fatalf("snippet = %q", snippet)
	}
	got := fake.seen()[0]
	since, err := time.Parse(time.DateOnly, got.body["published_after"].(string))
	if got.method != http.MethodPost || got.title != "Linger" || got.apiKey != "" || got.body["query"] != "q" ||
		got.body["max_results"] != float64(4) || got.body["site"] != "docs.example.com" || err != nil ||
		time.Since(since) < 6*24*time.Hour || time.Since(since) > 9*24*time.Hour {
		t.Fatalf("keenable request = %+v", got)
	}
	if len(keys.rows) != 0 {
		t.Fatalf("a keyless call saved a row: %+v", keys.rows)
	}
	// Without a key Keenable is never the default: an unnamed search runs DuckDuckGo.
	outcome, err = s.Run(t.Context(), search("q"))
	if err != nil || outcome.Backend != DuckDuckGo || len(fake.seen()) != 2 || fake.seen()[1].path != "/ddg/html/" {
		t.Fatalf("unnamed search = %+v, %v", outcome, err)
	}
}

func TestKeenableUsesTheKeyedRoutesWithASavedKey(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch r.path {
		case "/keenable/v1/search":
			writeJSON(w, 200, `{"results":[{"title":"K","url":"https://k.example/a","snippet":"keyed"}]}`)
		case "/keenable/v1/fetch":
			if !strings.Contains(r.query, "url=https%3A%2F%2Fk.example%2Fpage") {
				t.Errorf("fetch query = %s", r.query)
			}
			writeJSON(w, 200, `{"url":"https://k.example/page","title":"Page","content":"# Page\n\nbody","description":""}`)
		default:
			t.Errorf("unexpected %s %s", r.method, r.path)
		}
	})
	s, keys := newTestService(t, fake)
	view, err := s.SaveKey(t.Context(), Keenable, "keenable-secret")
	if err != nil || view.KeyState != "unverified" || view.OfficialKeyCheck || view.Tier != TierKey || len(fake.seen()) != 0 {
		t.Fatalf("SaveKey = %+v, %v", view, err)
	}
	request := search("q")
	request.Backend = Keenable
	outcome, err := s.Run(t.Context(), request)
	if err != nil || len(outcome.Results) != 1 || outcome.Results[0].Snippet != "keyed" {
		t.Fatalf("search = %+v, %v", outcome, err)
	}
	open, err := Normalize(Request{Command: CommandOpen, Backend: Keenable, URL: "https://k.example/page"})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err = s.Run(t.Context(), open)
	if err != nil || outcome.Page == nil || outcome.Page.Title != "Page" || outcome.Page.Markdown != "# Page\n\nbody" || outcome.Page.Truncated {
		t.Fatalf("open = %+v, %v", outcome, err)
	}
	for _, r := range fake.seen() {
		if r.apiKey != "keenable-secret" || r.title != "Linger" {
			t.Fatalf("keyed request = %+v", r)
		}
	}
	// A successful call proves a key Keenable has no endpoint to check.
	if keys.rows[string(Keenable)].State != "verified" {
		t.Fatalf("state after a call = %q", keys.rows[string(Keenable)].State)
	}
}

func TestKeenableOpensPagesWithoutAKey(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) {
		switch {
		case r.path != "/keenable/v1/fetch/public" || r.apiKey != "" || r.title != "Linger":
			t.Errorf("unexpected %+v", r)
		case strings.Contains(r.query, "gone"):
			writeJSON(w, 404, `{"detail":"not found"}`)
		default:
			writeJSON(w, 200, `{"url":"https://k.example/final","title":"Page","content":"text"}`)
		}
	})
	s, _ := newTestService(t, fake)
	open := func(link string) (Outcome, error) {
		request, err := Normalize(Request{Command: CommandOpen, Backend: Keenable, URL: link})
		if err != nil {
			t.Fatal(err)
		}
		return s.Run(t.Context(), request)
	}
	outcome, err := open("https://k.example/page")
	if err != nil || outcome.Backend != Keenable || outcome.Page.URL != "https://k.example/final" || outcome.Page.Markdown != "text" {
		t.Fatalf("open = %+v, %v", outcome, err)
	}
	var failure *Failure
	if _, err := open("https://k.example/gone"); !errors.As(err, &failure) || failure.Code != CodePageUnreadable || failure.Backend != Keenable {
		t.Fatalf("gone page = %#v", err)
	}
}

func TestKeenableRefusals(t *testing.T) {
	cases := []struct {
		name   string
		key    string
		status int
		header map[string]string
		code   Code
		retry  time.Duration
	}{
		{"keyless 429", "", 429, map[string]string{"Retry-After": "12"}, CodeRateLimited, 12 * time.Second},
		{"keyless 401", "", 401, nil, CodeProviderUnavailable, 0},
		{"keyed 401", "keenable-secret", 401, nil, CodeKeyRejected, 0},
		{"keyed 429", "keenable-secret", 429, nil, CodeRateLimited, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeProviders(t, func(w http.ResponseWriter, _ seen) {
				for name, value := range tc.header {
					w.Header().Set(name, value)
				}
				writeJSON(w, tc.status, `{"detail":"no"}`)
			})
			s, keys := newTestService(t, fake)
			if tc.key != "" {
				saveRaw(t, s, keys, Keenable, tc.key, "verified")
			}
			request := search("private query")
			request.Backend = Keenable
			_, err := s.Run(t.Context(), request)
			var failure *Failure
			if !errors.As(err, &failure) || failure.Code != tc.code || failure.Backend != Keenable || failure.RetryAfter != tc.retry {
				t.Fatalf("Run = %#v", err)
			}
			if rejected := keys.rows[string(Keenable)].State == "rejected"; rejected != (tc.code == CodeKeyRejected) {
				t.Fatalf("state = %q", keys.rows[string(Keenable)].State)
			}
		})
	}
}

func TestListShowsKeenableFreeWithoutAKey(t *testing.T) {
	fake := newFakeProviders(t, func(w http.ResponseWriter, r seen) { t.Errorf("unexpected %s", r.path) })
	s, _ := newTestService(t, fake)
	list, err := s.List(t.Context(), true)
	if err != nil || list.DefaultSearch != DuckDuckGo {
		t.Fatalf("List = %+v, %v", list, err)
	}
	for _, v := range list.Backends {
		if v.ID != Keenable {
			continue
		}
		if v.Status != "ready" || v.Tier != TierFree || v.TierText != keenableFreeText || !v.Keyless || v.KeyState != "none" ||
			v.MaxSites != 1 || v.MaxLimit != 20 || len(v.Commands) != 2 || v.KeyURL == "" || v.Quota.Reason != "not_reported" {
			t.Fatalf("keenable = %+v", v)
		}
		return
	}
	t.Fatal("keenable is not listed")
}
