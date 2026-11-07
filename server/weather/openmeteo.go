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

// forecast asks for the days from start to end (YYYY-MM-DD) at a place. ele is
// the altitude of a track, rounded to 50 m, or nil.
func (s *source) forecast(ctx context.Context, lat, lon float64, ele *float64, start, end string) ([]Day, error) {
	q := url.Values{}
	q.Set("latitude", fmt.Sprintf("%.2f", lat))
	q.Set("longitude", fmt.Sprintf("%.2f", lon))
	if ele != nil {
		q.Set("elevation", fmt.Sprintf("%d", elevation50(*ele)))
	}
	q.Set("daily", dailyFields)
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
	}
	if err := s.get(ctx, forecastURL, q, &answer); err != nil {
		return nil, err
	}
	d := answer.Daily
	n := len(d.Time)
	for _, l := range []int{len(d.Code), len(d.TMax), len(d.TMin), len(d.Chance), len(d.Rain), len(d.Wind), len(d.Gusts)} {
		if l != n {
			return nil, fmt.Errorf("%w: the lists of days differ", errService)
		}
	}
	or0 := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	days := []Day{}
	for i, date := range d.Time {
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
	return days, nil
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
