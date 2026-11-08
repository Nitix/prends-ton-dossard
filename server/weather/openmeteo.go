package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"courses/server/push"
)

// The addresses of Open-Meteo; export_test.go points them at an httptest server.
var (
	forecastURL  = "https://api.open-meteo.com/v1/forecast"
	geocodingURL = "https://geocoding-api.open-meteo.com/v1/search"
)

// requestTimeout is the whole of a request to Open-Meteo.
const requestTimeout = 8 * time.Second

// maxAnswer is the most that is read of an answer.
const maxAnswer = 1 << 20

const dailyFields = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max"

// hourlyFields are asked, in the same request, only when a format has a start time on a day that is asked.
const hourlyFields = "temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m"

var (
	errBudget  = errors.New("weather: the budget of calls is spent")
	errService = errors.New("weather: Open-Meteo did not answer well")
)

// newClient is the client of the program: a timeout, no redirect (a redirect is
// an answer that is not a 200, so a failure), no proxy, no cookie, and
// connections that refuse a private address, however a name resolves.
func newClient() *http.Client {
	return &http.Client{
		Timeout:       requestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport:     push.PublicOnlyTransport(),
	}
}

// client is replaced in the tests by one that reaches a test server.
var client = newClient()

// source makes the calls to Open-Meteo, counted by a budget.
type source struct {
	userAgent string
	budget    *budget
	onSpent   func() // called on the first refusal of an hour
}

// get sends a request to base with query and decodes the JSON answer into out.
// Only the two addresses of Open-Meteo are asked.
func (s *source) get(ctx context.Context, base string, query url.Values, out any) error {
	if base != forecastURL && base != geocodingURL {
		return errors.New("weather: not an address of Open-Meteo")
	}
	if ok, first := s.budget.take(); !ok {
		if first && s.onSpent != nil {
			s.onSpent()
		}
		return errBudget
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", s.userAgent)
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		return fmt.Errorf("%w: status %d", errService, res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxAnswer)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errService, err)
	}
	return nil
}

// Day is the weather of a day.
type Day struct {
	Date       string  `json:"date"`
	Code       int     `json:"code"`
	TMin       float64 `json:"tMin"`
	TMax       float64 `json:"tMax"`
	RainChance int     `json:"rainChance"`
	RainMm     float64 `json:"rainMm"`
	WindKmh    float64 `json:"windKmh"`
	GustKmh    float64 `json:"gustKmh"`
}

// Hour is the weather of an hour, as it is read for a start.
type Hour struct {
	Code       int
	Temp       float64
	RainChance int
	RainMm     float64
	WindKmh    float64
	GustKmh    float64
}

// hourKey is the key of an hour in the hours of a forecast: "2026-06-14T07".
func hourKey(date string, hour int) string { return fmt.Sprintf("%sT%02d", date, hour) }

// forecast asks for the days from start to end (YYYY-MM-DD) at a place, and, when
// hourly is set, the hours of those days in the same request (timezone=auto makes
// them the hours of the place). ele is the altitude of a track, rounded to 50 m,
// or nil. The hours are by hourKey.
func (s *source) forecast(ctx context.Context, lat, lon float64, ele *float64, start, end string, hourly bool) ([]Day, map[string]Hour, error) {
	q := url.Values{}
	q.Set("latitude", fmt.Sprintf("%.2f", lat))
	q.Set("longitude", fmt.Sprintf("%.2f", lon))
	if ele != nil {
		q.Set("elevation", fmt.Sprintf("%d", elevation50(*ele)))
	}
	q.Set("daily", dailyFields)
	if hourly {
		q.Set("hourly", hourlyFields)
	}
	q.Set("timezone", "auto")
	q.Set("start_date", start)
	q.Set("end_date", end)

	var answer struct {
		Daily struct {
			Time   []string   `json:"time"`
			Code   []*float64 `json:"weather_code"`
			TMax   []*float64 `json:"temperature_2m_max"`
			TMin   []*float64 `json:"temperature_2m_min"`
			Chance []*float64 `json:"precipitation_probability_max"`
			Rain   []*float64 `json:"precipitation_sum"`
			Wind   []*float64 `json:"wind_speed_10m_max"`
			Gusts  []*float64 `json:"wind_gusts_10m_max"`
		} `json:"daily"`
		Hourly struct {
			Time   []string   `json:"time"`
			Temp   []*float64 `json:"temperature_2m"`
			Code   []*float64 `json:"weather_code"`
			Chance []*float64 `json:"precipitation_probability"`
			Rain   []*float64 `json:"precipitation"`
			Wind   []*float64 `json:"wind_speed_10m"`
			Gusts  []*float64 `json:"wind_gusts_10m"`
		} `json:"hourly"`
	}
	if err := s.get(ctx, forecastURL, q, &answer); err != nil {
		return nil, nil, err
	}
	d := answer.Daily
	n := len(d.Time)
	for _, l := range []int{len(d.Code), len(d.TMax), len(d.TMin), len(d.Chance), len(d.Rain), len(d.Wind), len(d.Gusts)} {
		if l != n {
			return nil, nil, fmt.Errorf("%w: the lists of days differ", errService)
		}
	}
	or0 := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	days := []Day{}
	firstDay, lastDay := start, end
	for i, date := range d.Time {
		// A date that is not a day, or not one asked for, is not kept.
		if parsed, err := time.Parse(time.DateOnly, date); err != nil || parsed.Format(time.DateOnly) != date || date < firstDay || date > lastDay {
			continue
		}
		// A day without a code or a temperature says nothing worth showing.
		if d.Code[i] == nil || d.TMax[i] == nil || d.TMin[i] == nil {
			continue
		}
		days = append(days, Day{
			Date:       date,
			Code:       int(*d.Code[i]),
			TMin:       *d.TMin[i],
			TMax:       *d.TMax[i],
			RainChance: int(math.Round(or0(d.Chance[i]))),
			RainMm:     or0(d.Rain[i]),
			WindKmh:    or0(d.Wind[i]),
			GustKmh:    or0(d.Gusts[i]),
		})
	}
	if len(days) == 0 {
		return nil, nil, fmt.Errorf("%w: no usable day", errService)
	}
	if !hourly {
		return days, nil, nil
	}
	hours, err := readHours(answer.Hourly.Time, answer.Hourly.Temp, answer.Hourly.Code, answer.Hourly.Chance, answer.Hourly.Rain, answer.Hourly.Wind, answer.Hourly.Gusts, start, end)
	if err != nil {
		return nil, nil, err
	}
	return days, hours, nil
}

// readHours checks the hours of an answer as strictly as its days: the lists
// have the length of the times, and an hour that is not written
// YYYY-MM-DDTHH:00, or is not on a day asked, or has no code or temperature, is
// not kept.
func readHours(times []string, temp, code, chance, rain, wind, gusts []*float64, start, end string) (map[string]Hour, error) {
	for _, l := range []int{len(temp), len(code), len(chance), len(rain), len(wind), len(gusts)} {
		if l != len(times) {
			return nil, fmt.Errorf("%w: the lists of hours differ", errService)
		}
	}
	or0 := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	hours := map[string]Hour{}
	for i, text := range times {
		parsed, err := time.Parse("2006-01-02T15:04", text)
		if err != nil || parsed.Format("2006-01-02T15:04") != text || parsed.Minute() != 0 {
			continue
		}
		date := parsed.Format(time.DateOnly)
		if date < start || date > end || code[i] == nil || temp[i] == nil {
			continue
		}
		hours[hourKey(date, parsed.Hour())] = Hour{
			Code:       int(*code[i]),
			Temp:       *temp[i],
			RainChance: int(math.Round(or0(chance[i]))),
			RainMm:     or0(rain[i]),
			WindKmh:    or0(wind[i]),
			GustKmh:    or0(gusts[i]),
		}
	}
	return hours, nil
}

// found is a place that the geocoding gave.
type found struct {
	Lat, Lon float64
	Name     string
	Detail   string
	OK       bool // false: nothing was found
}

// geocode asks for the first place of text.
func (s *source) geocode(ctx context.Context, text string) (found, error) {
	q := url.Values{}
	q.Set("name", text)
	q.Set("count", "1")
	q.Set("language", "fr")
	q.Set("format", "json")
	var answer struct {
		Results []struct {
			Name      string  `json:"name"`
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
			Admin1    string  `json:"admin1"`
			Country   string  `json:"country"`
		} `json:"results"`
	}
	if err := s.get(ctx, geocodingURL, q, &answer); err != nil {
		return found{}, err
	}
	if len(answer.Results) == 0 {
		return found{}, nil
	}
	r := answer.Results[0]
	if r.Latitude < -90 || r.Latitude > 90 || r.Longitude < -180 || r.Longitude > 180 {
		return found{}, fmt.Errorf("%w: a place off the Earth", errService)
	}
	var detail []string
	for _, part := range []string{r.Admin1, r.Country} {
		if part != "" {
			detail = append(detail, clip(part))
		}
	}
	return found{Lat: r.Latitude, Lon: r.Longitude, Name: clip(r.Name), Detail: strings.Join(detail, ", "), OK: true}, nil
}

// clip keeps 120 characters of a text that an outside service gave.
func clip(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > 120 {
		r = r[:120]
	}
	return string(r)
}

// elevation50 is an altitude rounded to 50 m.
func elevation50(ele float64) int { return int(math.Round(ele/50) * 50) }
