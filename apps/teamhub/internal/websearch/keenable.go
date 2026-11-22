package websearch

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"
)

// keenableTitle names the app to Keenable, whose keyless routes require it.
const keenableTitle = "Linger"

// keenableRecency is how many days back each recency reaches; Keenable
// filters by a publish date instead of a named range.
var keenableRecency = map[string]int{"day": 1, "week": 7, "month": 30, "year": 365}

// keenableRoute is the keyed route with a key and its public twin without
// one; the key only lifts the rate limit.
func keenableRoute(route, key string) string {
	if key == "" {
		return route + "/public"
	}
	return route
}

func keenableHeader(key string) map[string]string {
	header := map[string]string{"X-Keenable-Title": keenableTitle}
	if key != "" {
		header["X-API-Key"] = key
	}
	return header
}

// keenableClassify is classify, except that without a key there is no key
// to refuse.
func keenableClassify(key, command string, a answer) error {
	err := classify(Keenable, command, a)
	if failure := (*Failure)(nil); key == "" && errors.As(err, &failure) && failure.Code == CodeKeyRejected {
		failure.Code = CodeProviderUnavailable
	}
	return err
}

// keenableSearch searches with the key, or keyless when key is empty. The
// snippet is page text, which appendResult cuts.
func (p *providers) keenableSearch(ctx context.Context, key string, request Request) (Outcome, error) {
	body := map[string]any{"query": request.Query, "max_results": request.Limit}
	if days, ok := keenableRecency[request.Recency]; ok {
		body["published_after"] = time.Now().UTC().AddDate(0, 0, -days).Format(time.DateOnly)
	}
	if len(request.Sites) == 1 {
		body["site"] = request.Sites[0]
	}
	a, err := p.call(ctx, http.MethodPost, p.endpoints.Keenable+keenableRoute("/v1/search", key), keenableHeader(key), body)
	if err != nil {
		return Outcome{}, err
	}
	if err := keenableClassify(key, CommandSearch, a); err != nil {
		return Outcome{}, err
	}
	var decoded struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Snippet string `json:"snippet"`
		} `json:"results"`
	}
	if json.Unmarshal(a.body, &decoded) != nil {
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	results := make([]Result, 0, len(decoded.Results))
	for _, item := range decoded.Results {
		results = appendResult(results, item.Title, item.URL, item.Snippet, "")
	}
	return Outcome{Results: limitResults(results, request.Limit)}, nil
}

// keenableFetch reads one page as Markdown, with the key or keyless.
func (p *providers) keenableFetch(ctx context.Context, key, pageURL string) (Outcome, error) {
	endpoint := p.endpoints.Keenable + keenableRoute("/v1/fetch", key) + "?" + url.Values{"url": {pageURL}}.Encode()
	a, err := p.call(ctx, http.MethodGet, endpoint, keenableHeader(key), nil)
	if err != nil {
		return Outcome{}, err
	}
	if err := keenableClassify(key, CommandOpen, a); err != nil {
		return Outcome{}, err
	}
	var decoded struct {
		URL     string `json:"url"`
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if json.Unmarshal(a.body, &decoded) != nil {
		return Outcome{}, &Failure{Code: CodeProviderUnavailable}
	}
	return pageOutcome(pageURL, decoded.URL, decoded.Title, decoded.Content)
}
