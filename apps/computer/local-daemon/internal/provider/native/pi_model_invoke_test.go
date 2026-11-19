package native

import "testing"

func TestPiBackgroundEndpointMustBeLoopback(t *testing.T) {
	for _, endpoint := range []string{"http://127.0.0.1:8080/v1", "http://[::1]:8080", "http://localhost:8080"} {
		if !piLoopbackURL(endpoint) {
			t.Errorf("refused loopback endpoint %s", endpoint)
		}
	}
	for _, endpoint := range []string{"", "http://localhost.example.test", "https://example.test/v1", "http://localhost@example.test", "file://localhost/model"} {
		if piLoopbackURL(endpoint) {
			t.Errorf("accepted non-loopback endpoint %s", endpoint)
		}
	}
}
