package geofence

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"mapup-geofencing/internal/models"
)

const (
	CategoryDeliveryZone   = "delivery_zone"
	CategoryRestrictedZone = "restricted_zone"
	CategoryTollZone       = "toll_zone"
	CategoryCustomerArea   = "customer_area"
)

var AllowedCategories = map[string]bool{
	CategoryDeliveryZone:   true,
	CategoryRestrictedZone: true,
	CategoryTollZone:       true,
	CategoryCustomerArea:   true,
}

const eps = 1e-9

// ValidateCategory checks that category is one of the 4 allowed geofence categories.
func ValidateCategory(category string) error {
	if !AllowedCategories[category] {
		return fmt.Errorf("invalid category %q: must be one of delivery_zone, restricted_zone, toll_zone, customer_area", category)
	}
	return nil
}

// ValidateCoordinates checks a single [latitude, longitude] coordinate pair.
func ValidateCoordinates(lat, lon float64) error {
	if math.IsNaN(lat) || math.IsInf(lat, 0) || lat < -90 || lat > 90 {
		return fmt.Errorf("invalid latitude %v: must be between -90 and 90", lat)
	}
	if math.IsNaN(lon) || math.IsInf(lon, 0) || lon < -180 || lon > 180 {
		return fmt.Errorf("invalid longitude %v: must be between -180 and 180", lon)
	}
	return nil
}

// ValidatePolygon validates a closed geofence polygon defined in [latitude, longitude] order.
// Rules enforced:
// 1. Minimum 4 points (3 unique vertices + 1 closing point).
// 2. Every point is a valid [lat, lon] pair within [-90,90] and [-180,180].
// 3. Closed ring: first and last coordinates must be identical.
// 4. At least 3 distinct vertices and non-zero area (prevents degenerate line/point polygons).
func ValidatePolygon(coords [][]float64) error {
	if len(coords) < 4 {
		return errors.New("polygon must contain at least 4 coordinate pairs (3 unique points + closing point)")
	}

	for i, pt := range coords {
		if len(pt) != 2 {
			return fmt.Errorf("coordinate at index %d must be a [latitude, longitude] pair of length 2", i)
		}
		if err := ValidateCoordinates(pt[0], pt[1]); err != nil {
			return fmt.Errorf("coordinate at index %d: %w", i, err)
		}
	}

	first := coords[0]
	last := coords[len(coords)-1]
	if first[0] != last[0] || first[1] != last[1] {
		return errors.New("polygon must be closed: first and last coordinates must be identical")
	}

	type pointKey struct{ lat, lon float64 }
	unique := make(map[pointKey]struct{}, len(coords)-1)
	for _, pt := range coords[:len(coords)-1] {
		unique[pointKey{lat: pt[0], lon: pt[1]}] = struct{}{}
	}
	if len(unique) < 3 {
		return errors.New("polygon must contain at least 3 distinct vertices")
	}

	if polygonShoelaceArea2(coords) < 1e-15 {
		return errors.New("polygon vertices are collinear or form zero area")
	}

	return nil
}

// polygonShoelaceArea2 computes twice the planar signed area magnitude to detect collinear/zero-area rings.
func polygonShoelaceArea2(coords [][]float64) float64 {
	var sum float64
	for i := 0; i < len(coords)-1; i++ {
		lat1, lon1 := coords[i][0], coords[i][1]
		lat2, lon2 := coords[i+1][0], coords[i+1][1]
		sum += (lon1 * lat2) - (lon2 * lat1)
	}
	return math.Abs(sum)
}

// CoordsToWKT converts [latitude, longitude] coordinates into PostGIS WKT POLYGON((lon lat, ...)).
// Brief uses [lat, lon]; PostGIS and GeoJSON require [lon, lat].
func CoordsToWKT(coords [][]float64) string {
	parts := make([]string, len(coords))
	for i, pt := range coords {
		lon := strconv.FormatFloat(pt[1], 'f', -1, 64)
		lat := strconv.FormatFloat(pt[0], 'f', -1, 64)
		parts[i] = lon + " " + lat
	}
	return fmt.Sprintf("POLYGON((%s))", strings.Join(parts, ", "))
}

type geoJSONPolygon struct {
	Type        string        `json:"type"`
	Coordinates [][][]float64 `json:"coordinates"`
}

// GeoJSONToCoords parses PostGIS ST_AsGeoJSON output and swaps [lon, lat] back to [lat, lon].
func GeoJSONToCoords(raw []byte) ([][]float64, error) {
	var gj geoJSONPolygon
	if err := json.Unmarshal(raw, &gj); err != nil {
		return nil, fmt.Errorf("parse geojson polygon: %w", err)
	}
	if len(gj.Coordinates) == 0 || len(gj.Coordinates[0]) == 0 {
		return nil, errors.New("empty geojson polygon ring")
	}
	outer := gj.Coordinates[0]
	result := make([][]float64, len(outer))
	for i, pt := range outer {
		if len(pt) < 2 {
			return nil, fmt.Errorf("invalid geojson coordinate at index %d", i)
		}
		// Swap [lon, lat] -> [lat, lon]
		result[i] = []float64{pt[1], pt[0]}
	}
	return result, nil
}

// ContainsPoint implements pure-Go ray-casting point-in-polygon with boundary-inclusive semantics
// matching PostGIS ST_Covers: a point lying exactly on a vertex or edge is treated as inside.
func ContainsPoint(coords [][]float64, lat, lon float64) bool {
	if len(coords) < 4 {
		return false
	}

	inside := false
	for i := 0; i < len(coords)-1; i++ {
		y1, x1 := coords[i][0], coords[i][1]
		y2, x2 := coords[i+1][0], coords[i+1][1]

		if pointOnSegment(lon, lat, x1, y1, x2, y2) {
			return true
		}

		// Ray cast horizontally to +infinity along x (longitude)
		intersectsY := (y1 > lat) != (y2 > lat)
		if intersectsY {
			intersectX := x1 + (lat-y1)*(x2-x1)/(y2-y1)
			if lon < intersectX {
				inside = !inside
			}
		}
	}
	return inside
}

func pointOnSegment(px, py, x1, y1, x2, y2 float64) bool {
	cross := (py-y1)*(x2-x1) - (px-x1)*(y2-y1)
	if math.Abs(cross) > eps {
		return false
	}
	minX, maxX := math.Min(x1, x2)-eps, math.Max(x1, x2)+eps
	minY, maxY := math.Min(y1, y2)-eps, math.Max(y1, y2)+eps
	return px >= minX && px <= maxX && py >= minY && py <= maxY
}

// DetectTransitions compares the previous and current sets of geofences a vehicle is inside.
// New geofences in current are "entry" transitions; geofences missing from current are "exit" transitions.
// Geofences present in both sets produce no transition events.
func DetectTransitions(previous, current []models.GeofenceRef) (entered, exited []models.GeofenceRef) {
	prevMap := make(map[string]models.GeofenceRef, len(previous))
	for _, g := range previous {
		prevMap[g.ID] = g
	}

	currMap := make(map[string]models.GeofenceRef, len(current))
	for _, g := range current {
		currMap[g.ID] = g
		if _, wasInside := prevMap[g.ID]; !wasInside {
			entered = append(entered, g)
		}
	}

	for _, g := range previous {
		if _, stillInside := currMap[g.ID]; !stillInside {
			exited = append(exited, g)
		}
	}

	return entered, exited
}
