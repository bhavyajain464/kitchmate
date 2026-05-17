package services

import "testing"

func TestRetrieveDishesVegetarianFiltersNonVeg(t *testing.T) {
	in := DishRetrieveInput{
		Category:    "daily",
		DietaryTags: []string{"vegetarian"},
		FavCuisines: []string{"North Indian"},
		TopK:        30,
	}
	ranked := RetrieveDishes(in)
	if len(ranked) == 0 {
		t.Fatal("expected candidates")
	}
	for _, r := range ranked {
		if dishIsNonVeg(r.Dish) {
			t.Fatalf("non-veg dish in veg results: %s", r.Dish.Name)
		}
	}
}

func TestRetrieveDishesCategoryBoost(t *testing.T) {
	in := DishRetrieveInput{
		Category:    "daily",
		DietaryTags: []string{"vegetarian"},
		TopK:        5,
	}
	ranked := RetrieveDishes(in)
	for _, r := range ranked {
		if !dishHasCategory(r.Dish, "daily") {
			t.Fatalf("expected daily category dish, got %s", r.Dish.Name)
		}
	}
}
