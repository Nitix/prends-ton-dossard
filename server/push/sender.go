package push

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"syscall"
	"time"
)

// Options of one message.
type Options struct {
	TTL     time.Duration // at least a minute
	Urgency string        // "normal" or "high" (empty: the header is left out)
	Topic   string        // ≤ 32 characters of the base64url alphabet, or ""
}

// Outcome is what the push service said, in the terms of what to do next.
type Outcome int

const (
	Delivered Outcome = iota // 200, 201, 202
	Gone                     // 404, 410: delete the subscription
	Rejected                 // 400, 401, 403, 413
	Failed                   // 429, 5xx, timeout, network
)

// sendTimeout is the whole of a request, connection and answer.
const sendTimeout = 10 * time.Second

// Sender posts encrypted messages to the push services of the allow-list.
type Sender struct {
	keys    *Keys
	contact string
	client  *http.Client
	allowed func(endpoint string) bool
	now     func() time.Time
}

// NewSender makes a sender that signs with keys, as contact (the "sub" of the
// token), and whose client has a 10 s timeout and follows no redirect.
func NewSender(keys *Keys, contact string) *Sender {
	return &Sender{
		keys:    keys,
		contact: contact,
		client: &http.Client{
			Timeout:       sendTimeout,
			CheckRedirect: noRedirect,
			Transport:     publicOnlyTransport(),
		},
		allowed: EndpointAllowed,
		now:     time.Now,
	}
}

// noRedirect makes the client hand back a redirect as it is, with its status.
func noRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

// publicOnlyTransport is a transport that dials public addresses only, however
// a name resolves: the allow-list names the hosts, and this keeps a name that
// turns to the internal network (or is made to) from being reached. It uses no
// proxy of the environment, which would be dialled in place of the service.
func publicOnlyTransport() *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = nil
	t.DialContext = (&net.Dialer{
		Timeout:   sendTimeout,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil || !publicAddr(ap.Addr()) {
				return errors.New("push: the address is not a public one")
			}
			return nil
		},
	}).DialContext
	return t
}

// PublicOnlyTransport is the transport of the sender, for the other outgoing
// clients of the program (the weather): the same guard at dial time, no proxy.
func PublicOnlyTransport() *http.Transport { return publicOnlyTransport() }

// deniedV4 are the IPv4 ranges that are not the public internet: this network,
// private, shared (carrier-grade NAT, Tailscale), loopback, link-local (cloud
// metadata), protocol assignments, the documentation ranges, benchmarking,
// multicast and the reserved class E with the broadcast address.
var deniedV4 = mustPrefixes(
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
	"172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15",
	"198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
)

// deniedV6 are the parts of the global-unicast space 2000::/3 that are not the
// public internet: documentation, Teredo and 6to4 (which embed an IPv4 address
// that nobody checks). Everything outside 2000::/3 (loopback, unspecified,
// unique-local, link-local, site-local fec0::/10, multicast…) is refused
// already, by not being in it.
var deniedV6 = mustPrefixes("2001::/32", "2001:db8::/32", "2002::/16")

var (
	globalV6 = netip.MustParsePrefix("2000::/3")
	nat64    = netip.MustParsePrefix("64:ff9b::/96")
	v4Compat = netip.MustParsePrefix("::/96")
)

func mustPrefixes(s ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(s))
	for i, p := range s {
		out[i] = netip.MustParsePrefix(p)
	}
	return out
}

func inAny(a netip.Addr, prefixes []netip.Prefix) bool {
	for _, p := range prefixes {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// publicAddr says whether a is on the public internet. An IPv4-mapped address
// (::ffff:a.b.c.d), an IPv4-compatible one (::a.b.c.d) and a NAT64 one
// (64:ff9b::a.b.c.d, which is how an IPv6-only host reaches IPv4) are judged
// by the IPv4 address they hold.
func publicAddr(a netip.Addr) bool {
	a = a.WithZone("").Unmap()
	switch {
	case !a.IsValid():
		return false
	case a.Is4():
		return !inAny(a, deniedV4)
	case nat64.Contains(a) || v4Compat.Contains(a):
		b := a.As16()
		return publicAddr(netip.AddrFrom4([4]byte(b[12:])))
	default:
		return globalV6.Contains(a) && !inAny(a, deniedV6)
	}
}

// topicOK: at most 32 characters of the base64url alphabet (RFC 8030 § 5.4).
func topicOK(topic string) bool {
	if len(topic) > 32 {
		return false
	}
	for i := 0; i < len(topic); i++ {
		c := topic[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// Send encrypts payload for sub and posts it. The outcome says what the push
// service answered; the error is set when nothing was answered (a refusal made
// here before any request is Rejected, a network error or a timeout Failed) and
// never holds the endpoint, a key or the payload.
func (s *Sender) Send(ctx context.Context, sub Subscription, payload []byte, opts Options) (Outcome, error) {
	if !s.allowed(sub.Endpoint) {
		return Rejected, errors.New("push: the endpoint is not one of the push services allowed")
	}
	if opts.TTL < time.Minute {
		return Rejected, errors.New("push: the TTL is under a minute")
	}
	if opts.Urgency != "" && opts.Urgency != "normal" && opts.Urgency != "high" {
		return Rejected, errors.New("push: the urgency is neither normal nor high")
	}
	if !topicOK(opts.Topic) {
		return Rejected, errors.New("push: the topic is over 32 characters or outside the base64url alphabet")
	}

	ephemeral, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return Rejected, errors.New("push: the ephemeral key cannot be made")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return Rejected, errors.New("push: the salt cannot be made")
	}
	body, err := encrypt(sub, payload, ephemeral, salt)
	if err != nil {
		return Rejected, err
	}
	authorization, err := vapidAuthorization(s.keys, sub.Endpoint, s.contact, s.now())
	if err != nil {
		return Rejected, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return Rejected, errors.New("push: the request cannot be made")
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("TTL", strconv.FormatInt(int64(opts.TTL/time.Second), 10))
	if opts.Urgency != "" {
		req.Header.Set("Urgency", opts.Urgency)
	}
	if opts.Topic != "" {
		req.Header.Set("Topic", opts.Topic)
	}
	req.Header.Set("Authorization", authorization)

	resp, err := s.client.Do(req)
	if err != nil {
		return Failed, reachError(err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	return outcomeOf(resp.StatusCode), nil
}

func outcomeOf(status int) Outcome {
	switch {
	case status >= 200 && status < 300:
		return Delivered
	case status == http.StatusNotFound || status == http.StatusGone:
		return Gone
	case status == http.StatusTooManyRequests || status >= 500:
		return Failed
	default: // 400, 401, 403, 413, and what is not expected: a redirect is not followed
		return Rejected
	}
}

// reachError says why a request failed without the address: a *url.Error and a
// *net.OpError both carry it (and the endpoint is a secret), so only the kind
// and the system's cause are kept.
func reachError(err error) error {
	var ne net.Error
	switch {
	case errors.Is(err, context.Canceled):
		return errors.New("push: the request was cancelled")
	case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()):
		return errors.New("push: the push service did not answer in time")
	}
	var oe *net.OpError
	if errors.As(err, &oe) && oe.Err != nil {
		return fmt.Errorf("push: the push service could not be reached (%s: %w)", oe.Op, oe.Err)
	}
	return errors.New("push: the push service could not be reached")
}
