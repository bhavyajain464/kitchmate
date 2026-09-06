package services

import "testing"

func TestParseBillItemsCompactTuples(t *testing.T) {
	items, err := ParseBillItems(`[["Potato",1,"kg",14],["Onion",0.5,"kg",14],["Milk",1,"L",4]]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatalf("got %d items: %+v", len(items), items)
	}
	if items[0].Name != "Potato" || items[0].Quantity != 1 || items[0].Unit != "kg" || items[0].ShelfLifeDays != 14 {
		t.Fatalf("potato: %+v", items[0])
	}
	if items[1].Quantity != 0.5 || items[1].ShelfLifeDays != 14 {
		t.Fatalf("onion: %+v", items[1])
	}
	if items[2].ShelfLifeDays != 4 {
		t.Fatalf("milk: %+v", items[2])
	}
}

func TestParseBillItemsShortKeys(t *testing.T) {
	items, err := ParseBillItems(`[{"n":"Tomato","q":2,"u":"kg","s":7}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "Tomato" || items[0].Quantity != 2 || items[0].ShelfLifeDays != 7 {
		t.Fatalf("got %+v", items)
	}
}

func TestParseBillItemsLegacyObjects(t *testing.T) {
	items, err := ParseBillItems(`[{"name":"Jeera","quantity":1,"unit":"g","price_per_unit":0,"total_price":55,"shelf_life_days":180,"food_group":"spices"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "Jeera" || items[0].ShelfLifeDays != 180 {
		t.Fatalf("got %+v", items)
	}
}

func TestParseBillItemsRejectsObjectAsTuple(t *testing.T) {
	items, err := ParseBillItems(`[{"name":"Rice","quantity":1,"unit":"kg","shelf_life_days":90}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "Rice" || items[0].ShelfLifeDays != 90 {
		t.Fatalf("expected legacy object parse, got %+v err=%v", items, err)
	}
}
