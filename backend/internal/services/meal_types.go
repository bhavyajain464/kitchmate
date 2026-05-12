package services

type CookProfileData struct {
	DishesKnown   []string `json:"dishes_known"`
	PreferredLang string   `json:"preferred_lang"`
}

type UserPrefsData struct {
	Dislikes    []string `json:"dislikes"`
	DietaryTags []string `json:"dietary_tags"`
	FavCuisines []string `json:"fav_cuisines"`
}
