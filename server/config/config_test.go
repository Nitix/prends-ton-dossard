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

// The demo is off unless DEMO_LOGIN_EMAIL names an account: the real site
// never sets it. Spaces around the value are what a .env file or a shell
// leaves by mistake, and would make the lookup of the account fail.
func TestLoad_DemoLoginEmail(t *testing.T) {
	for _, tc := range []struct{ name, value, want string }{
		{name: "unset", value: "", want: ""},
		{name: "set", value: "alice@example.test", want: "alice@example.test"},
		{name: "spaces trimmed", value: "  alice@example.test \t", want: "alice@example.test"},
		{name: "only spaces", value: "   ", want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load(func(key string) string {
				if key == "DEMO_LOGIN_EMAIL" {
					return tc.value
				}
				return ""
			})
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.DemoLoginEmail != tc.want {
				t.Errorf("DemoLoginEmail = %q, want %q", cfg.DemoLoginEmail, tc.want)
			}
		})
	}
}

// The demo is the site with an account that anybody can sign in to: it is what
// DEMO_LOGIN_EMAIL turns on, and the parts of the site that a shared account
// must not have (the tokens of the assistants) ask Demo.
func TestLoad_Demo(t *testing.T) {
	for _, tc := range []struct {
		name, value string
		want        bool
	}{
		{name: "without the variable", value: "", want: false},
		{name: "with only spaces", value: "  ", want: false},
		{name: "with the variable", value: "alice@example.test", want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load(func(key string) string {
				if key == "DEMO_LOGIN_EMAIL" {
					return tc.value
				}
				return ""
			})
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := cfg.Demo(); got != tc.want {
				t.Errorf("Demo() = %v, want %v", got, tc.want)
			}
		})
	}
}

// The "sub" of the VAPID token: PUSH_CONTACT when set, else the https APP_URL,
// else a placeholder (a local site has no address worth giving a push service).
func TestConfig_PushContact(t *testing.T) {
	cases := []struct {
		name, appURL, contact, want string
		wantErr                     bool
	}{
		{name: "set, a mailto", appURL: "https://courses.example.fr", contact: "mailto:admin@example.fr", want: "mailto:admin@example.fr"},
		{name: "set, an https URL", appURL: "http://localhost:8090", contact: "https://example.fr/contact", want: "https://example.fr/contact"},
		{name: "set, with spaces around", appURL: "", contact: "  mailto:admin@example.fr \n", want: "mailto:admin@example.fr"},
		{name: "https APP_URL", appURL: "https://courses.example.fr", want: "https://courses.example.fr"},
		{name: "http APP_URL", appURL: "http://localhost:8090", want: "mailto:push@example.invalid"},
		{name: "default APP_URL", appURL: "", want: "mailto:push@example.invalid"},
		{name: "set, but not a mailto or https", appURL: "https://courses.example.fr", contact: "http://example.fr", wantErr: true},
		{name: "set, a bare address", appURL: "https://courses.example.fr", contact: "admin@example.fr", wantErr: true},
		{name: "set, an empty mailto", appURL: "https://courses.example.fr", contact: "mailto:", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load(func(key string) string {
				switch key {
				case "APP_URL":
					return tc.appURL
				case "PUSH_CONTACT":
					return tc.contact
				}
				return ""
			})
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Load = %+v, want an error", cfg)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if cfg.PushContact != tc.want {
				t.Errorf("PushContact = %q, want %q", cfg.PushContact, tc.want)
			}
		})
	}
}
