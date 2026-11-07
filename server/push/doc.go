// Package push sends Web Push notifications: the VAPID key pair of the site,
// the encryption of a message for a browser's subscription, and the sender that
// posts it to the push service.
//
// # Why the standard library
//
// RFC 8291 (the encryption) is a hundred lines over crypto/ecdh, crypto/hkdf,
// crypto/aes and crypto/cipher, and RFC 8292 (VAPID) a signature of crypto/ecdsa
// over a small JSON. A library would add a dependency that sees the private key
// and every message for what these lines do; instead the encryption is checked
// byte for byte against the example of appendix A of RFC 8291 (see the tests).
//
// # Why an allow-list
//
// A subscription's endpoint is an address that a browser chose, and so that a
// member of the site chose, since the route that stores it takes it from the
// request. Posting to it unchecked would let anyone make the server request any
// address, the internal network included. The sender therefore posts only to
// the push services of the four vendors (see EndpointAllowed), over https and the
// default port, never follows a redirect, and its connections refuse a private,
// loopback or link-local address whatever a name resolves to.
//
// # Why a file, and never a regeneration
//
// Every subscription is tied to the public key of the site that it was made
// with (the applicationServerKey): a new pair would silently cut every device
// off. The pair is made once, kept in the data directory (so it is backed up
// with the data and restored with the subscriptions that go with it), and a file
// that is there but unreadable is an error that LoadOrCreateKeys reports and
// leaves alone, never a pair to replace. Changing the keys is a deliberate act:
// delete the file.
//
// # Secrets
//
// The private key, a subscription's auth secret and an endpoint (which is
// itself the capability to write to a device) are never in an error, a log or
// a printed value of this package: Keys prints as its public key only.
package push
