package push_test

import (
	"crypto/ecdh"
	"crypto/rand"
	"strings"
	"testing"

	"courses/server/push"
)

func TestEndpoints_AllowList(t *testing.T) {
	allowed := []string{
		"https://fcm.googleapis.com/fcm/send/abc:APA91b",
		"https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
		"https://web.push.apple.com/QGxyz",
		"https://api.push.apple.com/3/device/abc",
		"https://api.sandbox.push.apple.com/3/device/abc",
		"https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
		"https://FCM.googleapis.com/fcm/send/x", // the host is case-insensitive
		"https://fcm.googleapis.com",
		"https://fcm.googleapis.com:443/fcm/send/x", // the default port, written out
	}
	refused := refusedEndpoints
	for _, u := range allowed {
		if !push.EndpointAllowed(u) {
			t.Errorf("%q refused", u)
		}
	}
	for _, u := range refused {
		if push.EndpointAllowed(u) {
			t.Errorf("%q allowed", u)
		}
	}
}

func TestValidKeys(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	pub := ua.PublicKey().Bytes()
	auth := make([]byte, 16)
	if !push.ValidKeys(pub, auth) {
		t.Error("a good pair was refused")
	}
	offCurve := append([]byte{4}, make([]byte, 64)...)
	compressed := append([]byte{2}, pub[1:33]...)
	cases := map[string]struct{ p, a []byte }{
		"nil keys":            {nil, nil},
		"short point":         {pub[:64], auth},
		"long point":          {append(append([]byte{}, pub...), 0), auth},
		"point off the curve": {offCurve, auth},
		"compressed point":    {compressed, auth},
		"all zero":            {make([]byte, 65), auth},
		"auth too short":      {pub, auth[:15]},
		"auth too long":       {pub, make([]byte, 17)},
		"auth empty":          {pub, nil},
	}
	for name, c := range cases {
		if push.ValidKeys(c.p, c.a) {
			t.Errorf("%s: accepted", name)
		}
	}
}

// refusedEndpoints are the addresses that are not one of the push services.
var refusedEndpoints = []string{
	"http://fcm.googleapis.com/fcm/send/x",
	"https://fcm.googleapis.com:8443/fcm/send/x",
	"https://fcm.googleapis.com:/fcm/send/x",
	"https://127.0.0.1/x",
	"https://[::1]/x",
	"https://[::ffff:127.0.0.1]/x",
	"https://localhost/x",
	"https://fcm.googleapis.com.evil.test/x",
	"https://evilpush.apple.com.test/x",
	"https://evilfcm.googleapis.com/x",
	"https://evil-updates.push.services.mozilla.com/x",
	"https://evil.test/fcm.googleapis.com",
	"https://evil.test/?u=https://fcm.googleapis.com/",
	"https://evil.test#@fcm.googleapis.com/",
	"https://user@fcm.googleapis.com/x",
	"https://user:pass@fcm.googleapis.com/x",
	"https://fcm.googleapis.com@evil.test/x",
	"https://evil.test\\@fcm.googleapis.com/x",
	"https://push.apple.com/x",  // the bare domain is not one of the hosts
	"https://.push.apple.com/x", // no label before the suffix
	"https://notify.windows.com/x",
	"https://fcm.googleapis.com./x", // another spelling of the same host: the list is exact
	"https://fcm.googleapis.com\n.evil.test/x",
	"https://fcm.googleapis.com\r\nHost: evil.test/x",
	"https://a..push.apple.com/x",
	"https://..push.apple.com/x",
	"https://a.push.apple.com../x",
	"https://-.notify.windows.com/x",
	"https://a-.notify.windows.com/x",
	"https://a_b.notify.windows.com/x",
	"https://evil。com.push.apple.com/x",
	"https://evil%E3%80%82com.push.apple.com/x",
	"https://%ff.push.apple.com/x",
	"https://" + strings.Repeat("a", 64) + ".push.apple.com/x",
	" https://fcm.googleapis.com/x",
	"https://fcm.googleapis.com/x ",
	"https://fcm.googleapis.com\x00/x",
	"//fcm.googleapis.com/x",
	"fcm.googleapis.com/x",
	"ftp://fcm.googleapis.com/x",
	"javascript:alert(1)",
	"",
	"not a url",
	"https://",
	"https:///fcm.googleapis.com/x",
}
