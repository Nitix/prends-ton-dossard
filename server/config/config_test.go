package config

import "testing"

func TestLoad(t *testing.T) {
	cases := []struct {
		name       string
		appURL     string
		wantOrigin string
		wantRPID   string
		wantErr    bool
	}{
		{name: "empty uses default", appURL: "", wantOrigin: "http://localhost:5173", wantRPID: "localhost"},
		{name: "https host", appURL: "https://courses.example.fr", wantOrigin: "https://courses.example.fr", wantRPID: "courses.example.fr"},
		{name: "trailing slash accepted", appURL: "https://courses.example.fr/", wantOrigin: "https://courses.example.fr", wantRPID: "courses.example.fr"},
		{name: "localhost with port", appURL: "http://localhost:8091", wantOrigin: "http://localhost:8091", wantRPID: "localhost"},
		// WebAuthn compares the origin and the RP ID as strings: they take the
		// form a browser reports, lowercase and without the default port.
		{name: "host lowercased", appURL: "https://Courses.Example.FR", wantOrigin: "https://courses.example.fr", wantRPID: "courses.example.fr"},
		{name: "scheme lowercased", appURL: "HTTPS://courses.example.fr", wantOrigin: "https://courses.example.fr", wantRPID: "courses.example.fr"},
		{name: "default https port dropped", appURL: "https://courses.example.fr:443", wantOrigin: "https://courses.example.fr", wantRPID: "courses.example.fr"},
		{name: "default http port dropped", appURL: "http://localhost:80/", wantOrigin: "http://localhost", wantRPID: "localhost"},
		{name: "other port kept", appURL: "https://courses.example.fr:8443", wantOrigin: "https://courses.example.fr:8443", wantRPID: "courses.example.fr"},
		{name: "https port kept on http", appURL: "http://localhost:443", wantOrigin: "http://localhost:443", wantRPID: "localhost"},
		{name: "empty port dropped", appURL: "https://courses.example.fr:", wantOrigin: "https://courses.example.fr", wantRPID: "courses.example.fr"},
		// An IP address is kept as it is, although WebAuthn refuses it as an RP
		// ID: the passkeys then refuse to start (see passkeys.NewWebAuthn).
		{name: "IPv4 kept", appURL: "http://127.0.0.1:8090", wantOrigin: "http://127.0.0.1:8090", wantRPID: "127.0.0.1"},
		{name: "IPv6 without default port", appURL: "http://[::1]:80", wantOrigin: "http://[::1]", wantRPID: "::1"},
		{name: "IPv6 with port", appURL: "http://[::1]:8090", wantOrigin: "http://[::1]:8090", wantRPID: "::1"},
		{name: "unsupported scheme", appURL: "ftp://x.fr", wantErr: true},
		{name: "path not allowed", appURL: "https://x.fr/app", wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := func(key string) string {
				if key == "APP_URL" {
					return tc.appURL
				}
				return ""
			}

			cfg, err := Load(getenv)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Load(%q) = %+v, want error", tc.appURL, cfg)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load(%q) unexpected error: %v", tc.appURL, err)
			}
			if cfg.Origin != tc.wantOrigin {
				t.Errorf("Origin = %q, want %q", cfg.Origin, tc.wantOrigin)
			}
			if cfg.AppURL != tc.wantOrigin {
				t.Errorf("AppURL = %q, want %q", cfg.AppURL, tc.wantOrigin)
			}
			if cfg.RPID != tc.wantRPID {
				t.Errorf("RPID = %q, want %q", cfg.RPID, tc.wantRPID)
			}
		})
	}
}
