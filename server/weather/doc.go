// Package weather tells the weather of the days of a race, from Open-Meteo.
//
// # What is sent, and where
//
// The calls leave from the server, never from the browser: the addresses of the
// members do not go to Open-Meteo. A forecast carries coordinates rounded to
// 0.01 degree, an altitude rounded to 50 m when a track gives one, the days
// wanted and the list of the quantities; a geocoding carries the place of the
// race as it is typed, `count=1` and `language=fr`. Never a name of a member, of
// the race or of who goes, no cookie, no Authorization header.
//
// # Why the client is guarded
//
// The text of a place is member text, and the answer of a service is outside
// text. The client (see newClient) has a timeout, follows no redirect, and its
// connections refuse a private, loopback or link-local address, as the sender
// of server/push does (it reuses its dial guard); the two addresses are
// the only ones that a request may go to.
//
// # Cache and budget
//
// Everything is in memory and bounded (see cache.go): a forecast is kept an
// hour, and a stale one is served for six hours when Open-Meteo fails; a place
// is kept 30 days (not found: one day); the first point of a track is kept for
// the life of the process. One request at a time per key. The program as a whole
// makes at most 500 calls an hour, ten times under the limit of Open-Meteo.
package weather
