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
