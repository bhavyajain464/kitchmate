package services

import (
	"testing"
	"time"
)

func TestPreviousCompleteWeekBoundsMonday(t *testing.T) {
	loc := dietDigestLocation()
	// Monday 6 Jul 2026 01:30 IST — previous week Mon 29 Jun through Sun 5 Jul
	now := time.Date(2026, 7, 6, 1, 30, 0, 0, loc)
	start, end := previousCompleteWeekBounds(now)
	if start != "2026-06-29" || end != "2026-07-05" {
		t.Fatalf("expected 2026-06-29..2026-07-05, got %s..%s", start, end)
	}
}

func TestWeekBoundsContainingWednesday(t *testing.T) {
	start, end, err := weekBoundsContaining("2026-07-02")
	if err != nil {
		t.Fatal(err)
	}
	if start != "2026-06-29" || end != "2026-07-05" {
		t.Fatalf("expected 2026-06-29..2026-07-05, got %s..%s", start, end)
	}
}

func TestFormatDietPeriodLabel(t *testing.T) {
	got := formatDietPeriodLabel("2026-06-30", "2026-07-06")
	if got == "" || got == "2026-06-30 to 2026-07-06" {
		t.Fatalf("expected friendly label, got %q", got)
	}
}
