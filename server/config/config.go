// Package config reads the server configuration from environment variables.
package config

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// DefaultAppURL is the origin used when APP_URL is not set (Vite dev server).
const DefaultAppURL = "http://localhost:5173"

// Config holds the settings derived from the environment.
type Config struct {
	// AppURL is the public URL of the application. It always equals Origin.
	AppURL string
	// Origin is the WebAuthn origin: scheme://host[:port], without trailing
	// slash, in lowercase and without the default port of the scheme.
	Origin string
	// RPID is the WebAuthn relying party ID: the hostname of the origin.
	RPID string
	// DemoLoginEmail is the email of the account that anybody can sign in to
	// with one click (see the demo package), from DEMO_LOGIN_EMAIL. Empty, the
	// default, means no demo: the real site never sets it.
	DemoLoginEmail string
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

	// WebAuthn compares the origin and the RP ID that the browser reports with
	// these as strings, so they take the browser's form: a lowercase host and
	// no default port. url.Parse already lowercases the scheme. An IP address
	// is kept as it is, although WebAuthn refuses one as an RP ID.
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == defaultPorts[u.Scheme] {
		port = ""
	}
	hostPort := host
	if port != "" {
		hostPort = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		hostPort = "[" + host + "]" // IPv6
	}

	origin := u.Scheme + "://" + hostPort
	return Config{
		AppURL: origin,
		Origin: origin,
		RPID:   host,

		DemoLoginEmail: strings.TrimSpace(getenv("DEMO_LOGIN_EMAIL")),
	}, nil
}

// defaultPorts is the port that each scheme implies, which an origin omits.
var defaultPorts = map[string]string{"http": "80", "https": "443"}
