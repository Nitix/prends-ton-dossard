package push

import (
	"crypto/ecdh"
	"net/url"
	"strings"
)

// EndpointAllowed reports whether raw is an https URL, on the default port,
// whose host is fcm.googleapis.com, updates.push.services.mozilla.com,
// web.push.apple.com or under .push.apple.com, or under .notify.windows.com;
// never an IP, never with user info.
//
// The list is exact on purpose: the server posts to whatever address a member
// gives, so any other host would be a way to make it request an address of the
// internal network.
func EndpointAllowed(raw string) bool {
	_, ok := parseEndpoint(raw)
	return ok
}

var exactHosts = map[string]bool{
	"fcm.googleapis.com":                true,
	"updates.push.services.mozilla.com": true,
	"web.push.apple.com":                true,
}

var suffixHosts = []string{".push.apple.com", ".notify.windows.com"}

// parseEndpoint reads an endpoint for the allow-list.
func parseEndpoint(raw string) (*url.URL, bool) {
	for _, c := range raw {
		if c <= 0x20 || c == 0x7f {
			return nil, false // a space, a line break, any control character
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Opaque != "" || u.User != nil {
		return nil, false
	}
	host := strings.ToLower(u.Hostname())
	// u.Host must be the bare name, or the name with the port 443: "host:" and
	// every other port are refused. A literal IP is never in the list.
	if host == "" || (u.Host != u.Hostname() && strings.ToLower(u.Host) != host+":443") {
		return nil, false
	}
	if !hostAllowed(host) {
		return nil, false
	}
	return u, true
}

func hostAllowed(host string) bool {
	if !ldhHost(host) {
		return false
	}
	if exactHosts[host] {
		return true
	}
	for _, suffix := range suffixHosts {
		if label, ok := strings.CutSuffix(host, suffix); ok && label != "" {
			return true
		}
	}
	return false
}

// ldhHost says whether host is made of ASCII letter-digit-hyphen labels of 1 to
// 63 characters, none starting or ending with a hyphen, none empty (so no
// "a..b", no leading or trailing dot). The check then runs on the very bytes
// that net/http dials, with no IDNA mapping (a full stop of another script
// would turn into a dot there) and no underscore or other odd character.
func ldhHost(host string) bool {
	if len(host) == 0 || len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}

// ValidKeys checks a subscription's keys: p256dh a point on P-256 (65 bytes),
// auth 16 bytes.
func ValidKeys(p256dh, auth []byte) bool {
	if len(p256dh) != 65 || len(auth) != 16 {
		return false
	}
	_, err := ecdh.P256().NewPublicKey(p256dh)
	return err == nil
}
