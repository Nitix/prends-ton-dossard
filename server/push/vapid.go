package push

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"
)

// vapidHeader is the JWT header of RFC 8292 § 2: ES256, typ JWT, in this order.
const vapidHeader = `{"typ":"JWT","alg":"ES256"}`

// vapidLife is the life of a token: the longest that the services all take
// (RFC 8292 caps it at a day; Apple's refuse more).
const vapidLife = time.Hour

// vapidAuthorization is the Authorization header of RFC 8292 § 3:
// "vapid t=<JWT>, k=<public key>". The audience is the origin of the push
// service, the subject the contact of the site (a mailto: or https: URL).
func vapidAuthorization(keys *Keys, endpoint, contact string, now time.Time) (string, error) {
	if !validContact(contact) {
		return "", errors.New("push: the VAPID contact is not a mailto: or https: URL")
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return "", errors.New("push: the endpoint has no origin for the VAPID audience")
	}
	// The origin of the service: the scheme and the host, in lowercase, without
	// the default port. No path: it names the endpoint.
	if !asciiOnly(u.Hostname()) {
		return "", errors.New("push: the endpoint host is not ASCII")
	}
	host := strings.ToLower(u.Hostname())
	if p := u.Port(); p != "" && p != "443" {
		host += ":" + p
	}
	claims, err := json.Marshal(struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}{"https://" + host, now.Add(vapidLife).Unix(), contact})
	if err != nil {
		return "", err
	}
	signingInput := b64url.EncodeToString([]byte(vapidHeader)) + "." + b64url.EncodeToString(claims)
	sig, err := keys.sign([]byte(signingInput))
	if err != nil {
		return "", errors.New("push: the VAPID token cannot be signed")
	}
	return "vapid t=" + signingInput + "." + b64url.EncodeToString(sig) + ", k=" + keys.PublicKey(), nil
}

func validContact(contact string) bool {
	u, err := url.Parse(contact)
	if err != nil {
		return false
	}
	return (u.Scheme == "mailto" && u.Opaque != "") || (u.Scheme == "https" && u.Hostname() != "")
}
