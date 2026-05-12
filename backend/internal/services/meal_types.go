package services

type CookProfileData struct {
	DishesKnown   []string `json:"dishes_known"`
	PreferredLang string   `json:"preferred_lang"`
}

type UserPrefsData struct {
	Dislikes     []string `json:"dislikes"`
	DietaryTags  []string `json:"dietary_tags"`
	FavCuisines  []string `json:"fav_cuisines"`
	Allergies    []string `json:"allergies"`
	SpiceLevel   string   `json:"spice_level"`
	CookingSkill string   `json:"cooking_skill"`
	HouseholdSize int     `json:"household_size"`
	Memories     []string `json:"memories"`
}
