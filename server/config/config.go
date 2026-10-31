// Package config reads the server configuration from environment variables.
package config

import (
	"fmt"
	"net/url"
)

// DefaultAppURL is the origin used when APP_URL is not set (Vite dev server).
const DefaultAppURL = "http://localhost:5173"

// Config holds the settings derived from the environment.
type Config struct {
	// AppURL is the public URL of the application. It always equals Origin.
	AppURL string
	// Origin is the WebAuthn origin: scheme://host[:port], without trailing slash.
	Origin string
	// RPID is the WebAuthn relying party ID: the hostname of the origin.
	RPID string
}

// Load builds a Config from the environment. getenv is typically os.Getenv.
// An empty APP_URL falls back to DefaultAppURL.
func Load(getenv func(string) string) (Config, error) {
	raw := getenv("APP_URL")
	if raw == "" {
		raw = DefaultAppURL
	}

	u, err := url.Parse(raw)
	if err != nil {
		return Config{}, fmt.Errorf("invalid APP_URL %q: %w", raw, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return Config{}, fmt.Errorf("invalid APP_URL %q: scheme must be http or https", raw)
	}
	if u.Hostname() == "" {
		return Config{}, fmt.Errorf("invalid APP_URL %q: missing host", raw)
	}
	if u.Path != "" && u.Path != "/" {
		return Config{}, fmt.Errorf("invalid APP_URL %q: path is not allowed", raw)
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return Config{}, fmt.Errorf("invalid APP_URL %q: must be a bare origin", raw)
	}

	origin := u.Scheme + "://" + u.Host
	return Config{
		AppURL: origin,
		Origin: origin,
		RPID:   u.Hostname(),
	}, nil
}
