package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"mapup-geofencing/internal/models"
)

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func formatElapsedNs(start time.Time) string {
	return strconv.FormatInt(time.Since(start).Nanoseconds(), 10)
}

func writeError(w http.ResponseWriter, status int, start time.Time, msg string) {
	writeJSON(w, status, models.ErrorResponse{
		Error:  msg,
		TimeNs: formatElapsedNs(start),
	})
}

func NotFoundHandler(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	writeError(w, http.StatusNotFound, start, "endpoint not found")
}

func MethodNotAllowedHandler(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	writeError(w, http.StatusMethodNotAllowed, start, "method not allowed")
}

func decodeJSONBody(r *http.Request, dst any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20)) // 1 MB max body
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func parseISO8601(raw string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999999",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, errors.New("expected ISO 8601 format (e.g. 2025-01-15T10:35:00Z)")
}

func parsePagination(r *http.Request, defaultLimit, maxLimit int) (limit int, offset int, hasLimit bool, err error) {
	q := r.URL.Query()
	limitStr := q.Get("limit")
	offsetStr := q.Get("offset")

	if limitStr != "" {
		parsed, convErr := strconv.Atoi(limitStr)
		if convErr != nil || parsed <= 0 {
			return 0, 0, false, errors.New("limit must be a positive integer")
		}
		if maxLimit > 0 && parsed > maxLimit {
			parsed = maxLimit
		}
		limit = parsed
		hasLimit = true
	} else {
		limit = defaultLimit
	}

	if offsetStr != "" {
		parsed, convErr := strconv.Atoi(offsetStr)
		if convErr != nil || parsed < 0 {
			return 0, 0, false, errors.New("offset must be a non-negative integer")
		}
		offset = parsed
	}

	return limit, offset, hasLimit, nil
}
