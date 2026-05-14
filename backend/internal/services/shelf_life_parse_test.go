package services

import "testing"

func TestParseShelfLifeJSON_Strict(t *testing.T) {
	in := `[{"name":"tomato","shelf_life_days":5},{"name":"rice","shelf_life_days":90}]`
	got, err := parseShelfLifeJSON(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 || got[0].Name != "tomato" || got[0].ShelfLifeDays != 5 || got[1].ShelfLifeDays != 90 {
		t.Fatalf("unexpected parse: %#v", got)
	}
}

func TestParseShelfLifeJSON_FencedMarkdown(t *testing.T) {
	in := "```json\n[{\"name\":\"tomato\",\"shelf_life_days\":5}]\n```"
	got, err := parseShelfLifeJSON(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "tomato" {
		t.Fatalf("unexpected parse: %#v", got)
	}
}

// LLM intermixes prose between objects. Strict parse fails; salvage should
// still recover the well-formed object instead of dropping the whole batch.
func TestParseShelfLifeJSON_SalvageMixedProse(t *testing.T) {
	in := `[{"name":"tomato","shelf_life_days":5} but "kafka-test" is not a valid item]`
	got, err := parseShelfLifeJSON(in)
	if err != nil {
		t.Fatalf("expected salvage to succeed, got: %v", err)
	}
	if len(got) != 1 || got[0].Name != "tomato" || got[0].ShelfLifeDays != 5 {
		t.Fatalf("unexpected salvaged result: %#v", got)
	}
}

// The exact shape that caused the production error: a sentence inside `[...]`
// with no JSON object at all. Should return an error (not panic, not crash).
func TestParseShelfLifeJSON_AllProse(t *testing.T) {
	in := `["kafka-test-no-expiry" is not a valid item, please provide a valid item name]`
	if _, err := parseShelfLifeJSON(in); err == nil {
		t.Fatalf("expected error for all-prose response")
	}
}

func TestParseShelfLifeJSON_ObjectsAmongJunk(t *testing.T) {
	in := `here are the estimates: {"name":"milk","shelf_life_days":3}, {"name":"bread","shelf_life_days":4}; hope that helps!`
	got, err := parseShelfLifeJSON(in)
	if err != nil {
		t.Fatalf("expected salvage success, got: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 salvaged, got %d: %#v", len(got), got)
	}
}
