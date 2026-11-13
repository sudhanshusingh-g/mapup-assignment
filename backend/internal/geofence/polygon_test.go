package geofence

import (
	"testing"

	"mapup-geofencing/internal/models"
)

func TestValidatePolygon(t *testing.T) {
	validSquare := [][]float64{
		{37.7749, -122.4194},
		{37.7849, -122.4194},
		{37.7849, -122.4094},
		{37.7749, -122.4094},
		{37.7749, -122.4194},
	}
	if err := ValidatePolygon(validSquare); err != nil {
		t.Fatalf("expected valid square polygon, got error: %v", err)
	}

	tests := []struct {
		name   string
		coords [][]float64
	}{
		{
			name:   "fewer than 4 points",
			coords: [][]float64{{37.77, -122.41}, {37.78, -122.41}, {37.77, -122.41}},
		},
		{
			name: "unclosed polygon",
			coords: [][]float64{
				{37.77, -122.41},
				{37.78, -122.41},
				{37.78, -122.40},
				{37.77, -122.40},
			},
		},
		{
			name: "latitude out of range",
			coords: [][]float64{
				{95.0, -122.41},
				{37.78, -122.41},
				{37.78, -122.40},
				{95.0, -122.41},
			},
		},
		{
			name: "longitude out of range",
			coords: [][]float64{
				{37.77, -181.0},
				{37.78, -122.41},
				{37.78, -122.40},
				{37.77, -181.0},
			},
		},
		{
			name: "zero area collinear points",
			coords: [][]float64{
				{37.77, -122.41},
				{37.78, -122.41},
				{37.79, -122.41},
				{37.77, -122.41},
			},
		},
		{
			name: "wrong tuple length",
			coords: [][]float64{
				{37.77},
				{37.78, -122.41},
				{37.78, -122.40},
				{37.77},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidatePolygon(tc.coords); err == nil {
				t.Fatalf("expected validation error for %s, got nil", tc.name)
			}
		})
	}
}

func TestCoordsWKTAndGeoJSONRoundTrip(t *testing.T) {
	input := [][]float64{
		{37.7749, -122.4194},
		{37.7849, -122.4194},
		{37.7849, -122.4094},
		{37.7749, -122.4094},
		{37.7749, -122.4194},
	}

	wkt := CoordsToWKT(input)
	expectedPrefix := "POLYGON((-122.4194 37.7749"
	if len(wkt) < len(expectedPrefix) || wkt[:len(expectedPrefix)] != expectedPrefix {
		t.Fatalf("expected WKT to swap lat/lon to lon/lat, got: %s", wkt)
	}

	geoJSON := []byte(`{"type":"Polygon","coordinates":[[[-122.4194,37.7749],[-122.4194,37.7849],[-122.4094,37.7849],[-122.4094,37.7749],[-122.4194,37.7749]]]}`)
	parsed, err := GeoJSONToCoords(geoJSON)
	if err != nil {
		t.Fatalf("unexpected error parsing GeoJSON: %v", err)
	}
	if len(parsed) != len(input) {
		t.Fatalf("expected %d coords, got %d", len(input), len(parsed))
	}
	for i := range input {
		if parsed[i][0] != input[i][0] || parsed[i][1] != input[i][1] {
			t.Fatalf("coord %d mismatch: got %v, want %v", i, parsed[i], input[i])
		}
	}
}

func TestContainsPointBoundaryInclusive(t *testing.T) {
	poly := [][]float64{
		{37.7749, -122.4194},
		{37.7849, -122.4194},
		{37.7849, -122.4094},
		{37.7749, -122.4094},
		{37.7749, -122.4194},
	}

	// Strictly inside
	if !ContainsPoint(poly, 37.7799, -122.4144) {
		t.Fatal("expected center point to be inside polygon")
	}
	// Exact vertex (matches brief's example [37.7849, -122.4194])
	if !ContainsPoint(poly, 37.7849, -122.4194) {
		t.Fatal("expected vertex boundary point to be treated as inside (ST_Covers semantics)")
	}
	// On horizontal/vertical edge
	if !ContainsPoint(poly, 37.7749, -122.4150) {
		t.Fatal("expected edge point to be treated as inside")
	}
	// Outside
	if ContainsPoint(poly, 37.7600, -122.4144) {
		t.Fatal("expected exterior point to be outside")
	}
}

func TestDetectTransitions(t *testing.T) {
	g1 := models.GeofenceRef{ID: "geo_1", Name: "Zone 1", Category: "delivery_zone"}
	g2 := models.GeofenceRef{ID: "geo_2", Name: "Zone 2", Category: "restricted_zone"}
	g3 := models.GeofenceRef{ID: "geo_3", Name: "Zone 3", Category: "toll_zone"}

	// First update: previously empty, now inside g1 & g2 -> 2 entries, 0 exits
	entered, exited := DetectTransitions(nil, []models.GeofenceRef{g1, g2})
	if len(entered) != 2 || len(exited) != 0 {
		t.Fatalf("expected 2 entries and 0 exits on first update, got %d entries, %d exits", len(entered), len(exited))
	}

	// Subsequent update: stays in g2, exits g1, enters g3 -> 1 entry (g3), 1 exit (g1)
	entered, exited = DetectTransitions([]models.GeofenceRef{g1, g2}, []models.GeofenceRef{g2, g3})
	if len(entered) != 1 || entered[0].ID != "geo_3" {
		t.Fatalf("expected entry into geo_3, got %+v", entered)
	}
	if len(exited) != 1 || exited[0].ID != "geo_1" {
		t.Fatalf("expected exit from geo_1, got %+v", exited)
	}

	// Stationary update inside g2 & g3 -> 0 transitions
	entered, exited = DetectTransitions([]models.GeofenceRef{g2, g3}, []models.GeofenceRef{g2, g3})
	if len(entered) != 0 || len(exited) != 0 {
		t.Fatalf("expected no transitions when remaining inside same geofences, got %d/%d", len(entered), len(exited))
	}
}
