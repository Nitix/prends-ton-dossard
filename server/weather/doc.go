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
// # The days
//
// The answer has the days of the race from today on: a race of several days that
// has begun does not list the days that are gone, so days[0] is not always the
// first day of the race, and a page labels each day by its own date. At most 16
// days (the horizon of Open-Meteo); each date is checked and kept only inside
// the range asked, and an answer with no usable day is a failure.
//
// # The starts
//
// A format may have a start time (HH:MM, the time at the place of the race: Paris time for a race in France). When one has it on a day
// that is asked, the same forecast request also asks for the hours (`hourly`;
// `timezone=auto` makes them the hours of the place), so there is no extra call
// and no extra budget, and the answer has a `starts` entry for it: the weather
// at the hour that holds the time (07:30 reads 07:00). The hours are checked as
// the days are: lists of the same length, an hour written YYYY-MM-DDTHH:00 on a
// day that is asked. A start whose hour is missing has no entry. The start times
// are part of the key of the forecast.
//
// # Cache and budget
//
// Everything is in memory and bounded (see cache.go): a forecast is kept an
// hour, and a stale one is served for six hours when Open-Meteo fails; a place
// is kept 30 days (not found: one day); the first point of a track is kept for
// the life of the process. One request at a time per key. The program as a whole
// makes at most 500 calls an hour, ten times under the limit of Open-Meteo.
package weather
