package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"kitchenai-backend/internal/services"
	"kitchenai-backend/pkg/config"
)

var (
	mealPlanLastRunDate string
	mealPlanRunMu       sync.Mutex
	mealPlanGenMu       sync.Mutex
	mealPlanGenInFlight = map[string]struct{}{}
)

// WeekPlanDayResponse is one day in GET /meals/week-plan.
type WeekPlanDayResponse struct {
	Date       string         `json:"date"`
	Categories []MealCategory `json:"categories"`
}

// WeekPlanResponse is returned by GET /meals/week-plan.
type WeekPlanResponse struct {
	KitchenID      string                `json:"kitchen_id"`
	AnchorDate     string                `json:"anchor_date"`
	Days           []WeekPlanDayResponse `json:"days"`
	GeneratedAt    string                `json:"generated_at"`
	Source         string                `json:"source"`
	CacheAvailable bool                  `json:"cache_available"`
	CacheStale     bool                  `json:"cache_stale,omitempty"`
}

func GetWeekPlan(
	cache *services.MealPlanCache,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		userID := getUserID(r)
		w.Header().Set("Content-Type", "application/json")
		if cache == nil || !cache.Enabled() {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   "week_plan_unavailable",
				"message": "Meal planning cache is not available. Try again later.",
			})
			return
		}
		kitchen, err := resolveKitchenForUser(db, userID)
		if err != nil || kitchen == nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   "kitchen_not_found",
				"message": "Join or create a kitchen to see your meal plan.",
			})
			return
		}
		today := services.TodayDateKey(time.Now())
		tRedis := time.Now()
		entry, ok, err := cache.Get(r.Context(), kitchen.KitchenID)
		redisMs := time.Since(tRedis).Milliseconds()
		logWeekPlan := func(path string) {
			log.Printf("[meal-plan] GET kitchen=%s path=%s redis_ms=%d ms=%d", kitchen.KitchenID, path, redisMs, time.Since(start).Milliseconds())
		}
		if err != nil {
			log.Printf("[meal-plan] cache read kitchen=%s: %v", kitchen.KitchenID, err)
			http.Error(w, "Failed to load meal plan", http.StatusInternalServerError)
			return
		}
		var normalized *services.WeekPlanEntry
		needsFill := false
		if ok && entry != nil {
			var normErr error
			normalized, needsFill, normErr = services.NormalizeWeekPlan(entry, today)
			if normErr != nil {
				http.Error(w, "Failed to normalize meal plan", http.StatusInternalServerError)
				return
			}
		}
		complete := normalized != nil && !needsFill && len(normalized.Days) >= services.MealPlanDaysCount()
		if complete {
			resp := weekPlanResponseFromEntry(normalized, userID, db, today)
			json.NewEncoder(w).Encode(resp)
			logWeekPlan("redis-hit")
			return
		}
		if normalized != nil && len(normalized.Days) > 0 {
			primaryUser, pErr := primaryUserForKitchen(db, kitchen.KitchenID)
			if pErr != nil || primaryUser == "" {
				primaryUser = userID
			}
			scheduleWeekPlanFill(db, cfg, cookedLog, cache, kitchen.KitchenID, primaryUser, today)
			resp := weekPlanResponseFromEntry(normalized, userID, db, today)
			resp.CacheStale = true
			json.NewEncoder(w).Encode(resp)
			logWeekPlan("redis-partial")
			return
		}
		primaryUser, pErr := primaryUserForKitchen(db, kitchen.KitchenID)
		if pErr != nil || primaryUser == "" {
			primaryUser = userID
		}
		if err := GenerateAndCacheWeekPlanForKitchen(r.Context(), db, cfg, cookedLog, cache, kitchen.KitchenID, primaryUser, today); err != nil {
			log.Printf("[meal-plan] on-demand generate kitchen=%s: %v", kitchen.KitchenID, err)
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   "week_plan_not_ready",
				"message": "Could not prepare your meal plan. Try again in a moment.",
				"date":    today,
			})
			return
		}
		entry, ok, err = cache.Get(r.Context(), kitchen.KitchenID)
		if err != nil || !ok || entry == nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   "week_plan_not_ready",
				"message": "Your meal plan is prepared at midnight. Check back soon.",
				"date":    today,
			})
			return
		}
		resp := weekPlanResponseFromEntry(entry, userID, db, today)
		json.NewEncoder(w).Encode(resp)
		logWeekPlan("generated")
	}
}

func weekPlanResponseFromEntry(entry *services.WeekPlanEntry, userID string, db *sql.DB, today string) WeekPlanResponse {
	t0 := time.Now()
	globalStars, _ := services.LoadGlobalStarCounts(db)
	starsLoadMs := time.Since(t0).Milliseconds()
	t1 := time.Now()
	userStarred, _ := services.LoadUserStarredDishes(db, userID)
	userStarsLoadMs := time.Since(t1).Milliseconds()
	t2 := time.Now()
	days := make([]WeekPlanDayResponse, 0, len(entry.Days))
	for _, d := range entry.Days {
		cat := mealCategoryFromCachedReadOnly(d.Category)
		applyUserStarsToCategoryWithMaps(&cat, globalStars, userStarred)
		days = append(days, WeekPlanDayResponse{
			Date:       d.Date,
			Categories: []MealCategory{cat},
		})
	}
	enrichMs := time.Since(t2).Milliseconds()
	if starsLoadMs+userStarsLoadMs+enrichMs > 500 {
		log.Printf("[meal-plan] response build stars_ms=%d user_stars_ms=%d enrich_ms=%d days=%d",
			starsLoadMs, userStarsLoadMs, enrichMs, len(entry.Days))
	}
	return WeekPlanResponse{
		KitchenID:      entry.KitchenID,
		AnchorDate:     entry.AnchorDate,
		Days:           days,
		GeneratedAt:    entry.GeneratedAt,
		Source:         entry.Source,
		CacheAvailable: true,
		CacheStale:     entry.AnchorDate != today,
	}
}

func scheduleWeekPlanFill(
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
	cache *services.MealPlanCache,
	kitchenID string,
	primaryUserID string,
	anchorDate string,
) {
	kitchenID = strings.TrimSpace(kitchenID)
	if kitchenID == "" {
		return
	}
	mealPlanGenMu.Lock()
	if _, busy := mealPlanGenInFlight[kitchenID]; busy {
		mealPlanGenMu.Unlock()
		return
	}
	mealPlanGenInFlight[kitchenID] = struct{}{}
	mealPlanGenMu.Unlock()

	go func() {
		defer func() {
			mealPlanGenMu.Lock()
			delete(mealPlanGenInFlight, kitchenID)
			mealPlanGenMu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
		defer cancel()
		if err := GenerateAndCacheWeekPlanForKitchen(ctx, db, cfg, cookedLog, cache, kitchenID, primaryUserID, anchorDate); err != nil {
			log.Printf("[meal-plan] background fill kitchen=%s: %v", kitchenID, err)
		}
	}()
}

func primaryUserForKitchen(db *sql.DB, kitchenID string) (string, error) {
	var userID string
	err := db.QueryRow(`
		SELECT user_id::text FROM kitchen_members
		WHERE kitchen_id = $1
		ORDER BY joined_at ASC NULLS LAST, user_id
		LIMIT 1
	`, kitchenID).Scan(&userID)
	return userID, err
}

func listHouseholdKitchenIDs(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT kitchen_id::text FROM kitchen_members
		WHERE kitchen_kind = 'household'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// LoadKitchenWeekPlanEntry returns the normalized kitchen week plan, generating on demand when needed.
func LoadKitchenWeekPlanEntry(
	ctx context.Context,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
	cache *services.MealPlanCache,
	kitchenID string,
	userID string,
) (*services.WeekPlanEntry, error) {
	if cache == nil || !cache.Enabled() {
		return nil, services.ErrOrderSuggestNoPlan
	}
	today := services.TodayDateKey(time.Now())
	entry, ok, err := cache.Get(ctx, kitchenID)
	if err != nil {
		return nil, err
	}
	if ok && entry != nil {
		normalized, needsFill, normErr := services.NormalizeWeekPlan(entry, today)
		if normErr != nil {
			return nil, normErr
		}
		if !needsFill && len(normalized.Days) >= services.MealPlanDaysCount() {
			return normalized, nil
		}
		entry = normalized
	}
	if !ok || entry == nil || len(entry.Days) < services.MealPlanDaysCount() {
		primaryUser, pErr := primaryUserForKitchen(db, kitchenID)
		if pErr != nil || primaryUser == "" {
			primaryUser = userID
		}
		if err := GenerateAndCacheWeekPlanForKitchen(ctx, db, cfg, cookedLog, cache, kitchenID, primaryUser, today); err != nil {
			return nil, err
		}
		entry, ok, err = cache.Get(ctx, kitchenID)
		if err != nil {
			return nil, err
		}
		if !ok || entry == nil {
			return nil, services.ErrOrderSuggestNoPlan
		}
	}
	normalized, _, normErr := services.NormalizeWeekPlan(entry, today)
	if normErr != nil {
		return nil, normErr
	}
	return normalized, nil
}

// GenerateAndCacheWeekPlanForKitchen builds 7 days × 3 slots for a kitchen.
func GenerateAndCacheWeekPlanForKitchen(
	ctx context.Context,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
	cache *services.MealPlanCache,
	kitchenID string,
	primaryUserID string,
	anchorDate string,
) error {
	if cache == nil || !cache.Enabled() {
		return fmt.Errorf("redis not configured")
	}
	kitchenID = strings.TrimSpace(kitchenID)
	primaryUserID = strings.TrimSpace(primaryUserID)
	if kitchenID == "" || primaryUserID == "" {
		return fmt.Errorf("kitchen_id and user_id are required")
	}
	if anchorDate == "" {
		anchorDate = services.TodayDateKey(time.Now())
	}
	dates, err := services.WeekPlanDateRange(anchorDate)
	if err != nil {
		return err
	}

	existing, hasExisting, _ := cache.Get(ctx, kitchenID)
	existingByDate := map[string]services.WeekPlanDay{}
	if hasExisting && existing != nil {
		for _, d := range existing.Days {
			if len(d.Category.Meals) >= len(mealOfDaySlots) {
				existingByDate[d.Date] = d
			}
		}
	}

	meta := categoryMeta[services.MealOfDayCategoryID]
	var days []services.WeekPlanDay
	var exclude []string
	source := "ai"
	generatedAt := time.Now().Format(time.RFC3339)
	inventoryUsed := 0

	for _, dateKey := range dates {
		if day, ok := existingByDate[dateKey]; ok {
			days = append(days, day)
			for _, m := range day.Category.Meals {
				exclude = append(exclude, m.Name)
			}
			continue
		}
		planDate, err := services.ParseDateKey(dateKey)
		if err != nil {
			return err
		}
		var meals []SmartMeal
		for _, slot := range mealOfDaySlots {
			resp, err := generateSmartMeals(ctx, db, cfg, cookedLog, smartMealsGenerateInput{
				UserID:           primaryUserID,
				Category:         services.MealOfDayCategoryID,
				MealType:         slot.MealType,
				MealOfDayForUser: true,
				Exclude:          services.ExpandExcludeByDishFamilies(append([]string(nil), exclude...)),
				PlanDate:         planDate,
				SeedKey:          kitchenID,
			})
			if err != nil {
				return fmt.Errorf("generate %s %s: %w", dateKey, slot.Slot, err)
			}
			if resp.InventoryUsed > inventoryUsed {
				inventoryUsed = resp.InventoryUsed
			}
			if resp.Source == "fallback" {
				source = "fallback"
			}
			if resp.GeneratedAt != "" {
				generatedAt = resp.GeneratedAt
			}
			cat := pickMealOfDayCategory(resp.Categories)
			if cat == nil || len(cat.Meals) == 0 {
				log.Printf("[meal-plan] no dish kitchen=%s date=%s slot=%s", kitchenID, dateKey, slot.Slot)
				continue
			}
			m := cat.Meals[0]
			m.MealSlot = slot.Slot
			if m.WhyThisMeal == "" {
				m.WhyThisMeal = fmt.Sprintf("Planned for %s (%s).", dateKey, slotLabel(slot.Slot))
			}
			meals = append(meals, m)
			exclude = append(exclude, m.Name)
		}
		if len(meals) == 0 {
			return fmt.Errorf("no meals for %s", dateKey)
		}
		cat := MealCategory{
			ID:          services.MealOfDayCategoryID,
			Title:       meta.Title,
			Description: meta.Desc,
			Meals:       meals,
		}
		days = append(days, services.WeekPlanDay{
			Date:     dateKey,
			Category: cachedCategoryFromMeal(cat),
		})
	}

	if len(days) == 0 {
		return fmt.Errorf("no days generated")
	}
	return cache.Set(ctx, kitchenID, services.WeekPlanEntry{
		KitchenID:     kitchenID,
		AnchorDate:    anchorDate,
		Days:          days,
		GeneratedAt:   generatedAt,
		Source:        source,
		InventoryUsed: inventoryUsed,
	})
}

// RunMidnightWeekPlanRollover advances kitchen plans at 00:00 IST.
func RunMidnightWeekPlanRollover(
	ctx context.Context,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
	cache *services.MealPlanCache,
) {
	if cache == nil || !cache.Enabled() {
		return
	}
	loc, _ := time.LoadLocation(services.MealOfDayTimezone)
	if loc == nil {
		loc = time.FixedZone("IST", 5*3600+30*60)
	}
	now := time.Now().In(loc)
	if now.Hour() != 0 {
		return
	}
	dateKey := services.TodayDateKey(now)
	mealPlanRunMu.Lock()
	if mealPlanLastRunDate == dateKey {
		mealPlanRunMu.Unlock()
		return
	}
	mealPlanLastRunDate = dateKey
	mealPlanRunMu.Unlock()

	kitchenIDs, err := listHouseholdKitchenIDs(ctx, db)
	if err != nil {
		log.Printf("[meal-plan] midnight list kitchens: %v", err)
		return
	}
	log.Printf("[meal-plan] midnight rollover (date=%s kitchens=%d)", dateKey, len(kitchenIDs))
	ok, fail := 0, 0
	for _, kitchenID := range kitchenIDs {
		primaryUser, err := primaryUserForKitchen(db, kitchenID)
		if err != nil || primaryUser == "" {
			fail++
			continue
		}
		if err := GenerateAndCacheWeekPlanForKitchen(ctx, db, cfg, cookedLog, cache, kitchenID, primaryUser, dateKey); err != nil {
			log.Printf("[meal-plan] rollover kitchen=%s: %v", kitchenID, err)
			fail++
			continue
		}
		ok++
	}
	log.Printf("[meal-plan] midnight rollover done: ok=%d failed=%d", ok, fail)
}

// StartWeekPlanScheduler runs the 12:00 AM IST kitchen plan rollover.
func StartWeekPlanScheduler(
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
	cache *services.MealPlanCache,
) {
	if cache == nil || !cache.Enabled() {
		log.Printf("[meal-plan] scheduler disabled (REDIS_URL empty or Redis unavailable)")
		return
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			RunMidnightWeekPlanRollover(context.Background(), db, cfg, cookedLog, cache)
		}
	}()
	log.Printf("[meal-plan] scheduler started (00:00 %s daily, per-kitchen Redis cache, TTL=%s)", services.MealOfDayTimezone, cache.TTL())
}

// WeekPlanRefreshRequest is the body for POST /meals/week-plan/refresh.
type WeekPlanRefreshRequest struct {
	Date       string `json:"date"`
	MealSlot   string `json:"meal_slot,omitempty"`   // breakfast|lunch|dinner; empty = whole day
	Category   string `json:"category,omitempty"`    // daily|rescue_meal|most_healthy|…
	UserPrompt string `json:"user_prompt,omitempty"`
	MealType   string `json:"meal_type,omitempty"`
}

func normalizeWeekPlanRefreshCategory(category string) string {
	category = strings.TrimSpace(category)
	if category == "" || category == "today_plan" {
		return services.MealOfDayCategoryID
	}
	if category == "meal_of_day" {
		return services.MealOfDayCategoryID
	}
	return category
}

func mealTypeForSlot(slot struct {
	Slot     string
	MealType string
}, override string) string {
	if override != "" {
		return override
	}
	return slot.MealType
}

// RefreshWeekPlanDay regenerates one day (or one slot) in the kitchen week plan.
func RefreshWeekPlanDay(
	ctx context.Context,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
	cache *services.MealPlanCache,
	kitchenID string,
	primaryUserID string,
	dateKey string,
	mealSlot string,
	category string,
	userPrompt string,
	mealTypeOverride string,
) (*services.WeekPlanDay, error) {
	if cache == nil || !cache.Enabled() {
		return nil, fmt.Errorf("redis not configured")
	}
	dateKey = strings.TrimSpace(dateKey)
	if dateKey == "" {
		return nil, fmt.Errorf("date is required")
	}
	mealSlot = strings.ToLower(strings.TrimSpace(mealSlot))

	entry, ok, err := cache.Get(ctx, kitchenID)
	if err != nil {
		return nil, err
	}
	if !ok || entry == nil {
		today := services.TodayDateKey(time.Now())
		if err := GenerateAndCacheWeekPlanForKitchen(ctx, db, cfg, cookedLog, cache, kitchenID, primaryUserID, today); err != nil {
			return nil, err
		}
		entry, ok, err = cache.Get(ctx, kitchenID)
		if err != nil || !ok || entry == nil {
			return nil, fmt.Errorf("week plan not found")
		}
	}

	var existingDay *services.WeekPlanDay
	exclude := []string{}
	for i := range entry.Days {
		d := &entry.Days[i]
		if d.Date == dateKey {
			existingDay = d
			continue
		}
		for _, m := range d.Category.Meals {
			exclude = append(exclude, m.Name)
		}
	}
	if existingDay != nil && mealSlot != "" {
		for _, m := range existingDay.Category.Meals {
			if strings.ToLower(strings.TrimSpace(m.MealSlot)) != mealSlot {
				exclude = append(exclude, m.Name)
			}
		}
	}

	planDate, err := services.ParseDateKey(dateKey)
	if err != nil {
		return nil, err
	}
	nonce := fmt.Sprintf("%d", time.Now().UnixNano())
	genCategory := normalizeWeekPlanRefreshCategory(category)
	meta := categoryMeta[services.MealOfDayCategoryID]
	if m, ok := categoryMeta[genCategory]; ok && genCategory != services.MealOfDayCategoryID {
		meta = m
	}
	useMealOfDayForUser := genCategory == services.MealOfDayCategoryID
	userPrompt = strings.TrimSpace(userPrompt)
	mealTypeOverride = strings.TrimSpace(mealTypeOverride)

	slotsToGen := mealOfDaySlots
	if mealSlot != "" {
		slotsToGen = nil
		for _, s := range mealOfDaySlots {
			if s.Slot == mealSlot {
				slotsToGen = append(slotsToGen, s)
				break
			}
		}
		if len(slotsToGen) == 0 {
			return nil, fmt.Errorf("invalid meal_slot")
		}
	}

	existingBySlot := map[string]services.CachedSmartMeal{}
	if existingDay != nil {
		for _, m := range existingDay.Category.Meals {
			existingBySlot[strings.ToLower(strings.TrimSpace(m.MealSlot))] = m
		}
	}

	var meals []SmartMeal
	for _, slot := range slotsToGen {
		slotExclude := append([]string(nil), exclude...)
		if mealSlot != "" && existingDay != nil {
			for _, m := range existingDay.Category.Meals {
				if strings.ToLower(strings.TrimSpace(m.MealSlot)) != mealSlot {
					slotExclude = append(slotExclude, m.Name)
				}
			}
		}
		resp, err := generateSmartMeals(ctx, db, cfg, cookedLog, smartMealsGenerateInput{
			UserID:           primaryUserID,
			Category:         genCategory,
			MealType:         mealTypeForSlot(slot, mealTypeOverride),
			UserPrompt:       userPrompt,
			MealOfDayForUser: useMealOfDayForUser,
			Exclude:          services.ExpandExcludeByDishFamilies(slotExclude),
			PlanDate:         planDate,
			SeedKey:          kitchenID,
			RefreshNonce:     nonce + "|" + slot.Slot,
		})
		if err != nil {
			return nil, fmt.Errorf("generate %s: %w", slot.Slot, err)
		}
		cat := pickMealOfDayCategory(resp.Categories)
		if cat == nil || len(cat.Meals) == 0 {
			continue
		}
		m := cat.Meals[0]
		m.MealSlot = slot.Slot
		if m.WhyThisMeal == "" {
			m.WhyThisMeal = fmt.Sprintf("Planned for %s (%s).", dateKey, slotLabel(slot.Slot))
		}
		meals = append(meals, m)
		exclude = append(exclude, m.Name)
	}

	if mealSlot != "" && existingDay != nil {
		for _, m := range existingDay.Category.Meals {
			if strings.ToLower(strings.TrimSpace(m.MealSlot)) == mealSlot {
				continue
			}
			meals = append(meals, SmartMeal{
				MealSlot:       m.MealSlot,
				Name:           m.Name,
				Description:    m.Description,
				Ingredients:    m.Ingredients,
				ItemsToOrder:   m.ItemsToOrder,
				CookingTime:    m.CookingTime,
				Difficulty:     m.Difficulty,
				WhyThisMeal:    m.WhyThisMeal,
				PairsWith:       m.PairsWith,
				PairIngredients: m.PairIngredients,
				NutritionNotes:  m.NutritionNotes,
			})
		}
	}

	if len(meals) == 0 {
		return nil, fmt.Errorf("no meals generated")
	}

	// Sort meals breakfast, lunch, dinner
	slotOrder := map[string]int{"breakfast": 0, "lunch": 1, "dinner": 2}
	for i := 0; i < len(meals); i++ {
		for j := i + 1; j < len(meals); j++ {
			a := slotOrder[strings.ToLower(meals[i].MealSlot)]
			b := slotOrder[strings.ToLower(meals[j].MealSlot)]
			if b < a {
				meals[i], meals[j] = meals[j], meals[i]
			}
		}
	}

	newDay := services.WeekPlanDay{
		Date: dateKey,
		Category: cachedCategoryFromMeal(MealCategory{
			ID:          services.MealOfDayCategoryID,
			Title:       meta.Title,
			Description: meta.Desc,
			Meals:       meals,
		}),
	}

	updated := false
	for i := range entry.Days {
		if entry.Days[i].Date == dateKey {
			entry.Days[i] = newDay
			updated = true
			break
		}
	}
	if !updated {
		entry.Days = append(entry.Days, newDay)
	}
	entry.GeneratedAt = time.Now().Format(time.RFC3339)
	if err := cache.Set(ctx, kitchenID, *entry); err != nil {
		return nil, err
	}
	return &newDay, nil
}

// WeekPlanSetDishRequest is the body for POST /meals/week-plan/set-dish.
type WeekPlanSetDishRequest struct {
	Date     string `json:"date"`
	MealSlot string `json:"meal_slot"`
	DishID   string `json:"dish_id"`
}

// SetWeekPlanCatalogDish replaces one slot in the kitchen week plan with a catalog dish.
func SetWeekPlanCatalogDish(
	ctx context.Context,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
	cache *services.MealPlanCache,
	kitchenID string,
	primaryUserID string,
	dateKey string,
	mealSlot string,
	dishID string,
) (*services.WeekPlanDay, error) {
	if cache == nil || !cache.Enabled() {
		return nil, fmt.Errorf("redis not configured")
	}
	dateKey = strings.TrimSpace(dateKey)
	mealSlot = strings.ToLower(strings.TrimSpace(mealSlot))
	dishID = strings.TrimSpace(dishID)
	if dateKey == "" {
		return nil, fmt.Errorf("date is required")
	}
	if mealSlot == "" {
		return nil, fmt.Errorf("meal_slot is required")
	}
	if dishID == "" {
		return nil, fmt.Errorf("dish_id is required")
	}
	validSlot := false
	for _, s := range mealOfDaySlots {
		if s.Slot == mealSlot {
			validSlot = true
			break
		}
	}
	if !validSlot {
		return nil, fmt.Errorf("invalid meal_slot")
	}

	dish, ok := services.FindCatalogDishByID(dishID)
	if !ok {
		return nil, fmt.Errorf("dish not found")
	}

	entry, ok, err := cache.Get(ctx, kitchenID)
	if err != nil {
		return nil, err
	}
	if !ok || entry == nil {
		today := services.TodayDateKey(time.Now())
		if err := GenerateAndCacheWeekPlanForKitchen(ctx, db, cfg, cookedLog, cache, kitchenID, primaryUserID, today); err != nil {
			return nil, err
		}
		entry, ok, err = cache.Get(ctx, kitchenID)
		if err != nil || !ok || entry == nil {
			return nil, fmt.Errorf("week plan not found")
		}
	}

	var existingDay *services.WeekPlanDay
	for i := range entry.Days {
		if entry.Days[i].Date == dateKey {
			existingDay = &entry.Days[i]
			break
		}
	}

	inventory := fetchUserInventory(db, primaryUserID)
	expiringNames := expiringInventoryNames(inventory, time.Now())
	globalStars, _ := services.LoadGlobalStarCounts(db)
	userStarred, _ := services.LoadUserStarredDishes(db, primaryUserID)

	meal := smartMealFromCatalog(dish, inventory, expiringNames, services.MealOfDayCategoryID, globalStars, userStarred)
	meal.MealSlot = mealSlot
	meal.WhyThisMeal = fmt.Sprintf("You chose this for %s (%s).", dateKey, slotLabel(mealSlot))

	var meals []SmartMeal
	if existingDay != nil {
		for _, m := range existingDay.Category.Meals {
			if strings.ToLower(strings.TrimSpace(m.MealSlot)) == mealSlot {
				continue
			}
			meals = append(meals, SmartMeal{
				MealSlot:       m.MealSlot,
				DishID:         m.DishID,
				Name:           m.Name,
				Description:    m.Description,
				Ingredients:    m.Ingredients,
				ItemsToOrder:   m.ItemsToOrder,
				CookingTime:    m.CookingTime,
				Difficulty:     m.Difficulty,
				WhyThisMeal:    m.WhyThisMeal,
				PairsWith:       m.PairsWith,
				PairIngredients: m.PairIngredients,
				NutritionNotes:  m.NutritionNotes,
				StarCount:       m.StarCount,
				UserStarred:     m.UserStarred,
			})
		}
	}
	meals = append(meals, meal)

	slotOrder := map[string]int{"breakfast": 0, "lunch": 1, "dinner": 2}
	for i := 0; i < len(meals); i++ {
		for j := i + 1; j < len(meals); j++ {
			a := slotOrder[strings.ToLower(meals[i].MealSlot)]
			b := slotOrder[strings.ToLower(meals[j].MealSlot)]
			if b < a {
				meals[i], meals[j] = meals[j], meals[i]
			}
		}
	}

	meta := categoryMeta[services.MealOfDayCategoryID]
	newDay := services.WeekPlanDay{
		Date: dateKey,
		Category: cachedCategoryFromMeal(MealCategory{
			ID:          services.MealOfDayCategoryID,
			Title:       meta.Title,
			Description: meta.Desc,
			Meals:       meals,
		}),
	}

	updated := false
	for i := range entry.Days {
		if entry.Days[i].Date == dateKey {
			entry.Days[i] = newDay
			updated = true
			break
		}
	}
	if !updated {
		entry.Days = append(entry.Days, newDay)
	}
	entry.GeneratedAt = time.Now().Format(time.RFC3339)
	if err := cache.Set(ctx, kitchenID, *entry); err != nil {
		return nil, err
	}
	return &newDay, nil
}

func PostSetWeekPlanDish(
	cache *services.MealPlanCache,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		w.Header().Set("Content-Type", "application/json")
		if cache == nil || !cache.Enabled() {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "week_plan_unavailable"})
			return
		}
		var req WeekPlanSetDishRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		kitchen, err := resolveKitchenForUser(db, userID)
		if err != nil || kitchen == nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "kitchen_not_found"})
			return
		}
		primaryUser, pErr := primaryUserForKitchen(db, kitchen.KitchenID)
		if pErr != nil || primaryUser == "" {
			primaryUser = userID
		}
		day, err := SetWeekPlanCatalogDish(r.Context(), db, cfg, cookedLog, cache, kitchen.KitchenID, primaryUser, req.Date, req.MealSlot, req.DishID)
		if err != nil {
			log.Printf("[meal-plan] set-dish kitchen=%s date=%s slot=%s dish=%s: %v", kitchen.KitchenID, req.Date, req.MealSlot, req.DishID, err)
			status := http.StatusInternalServerError
			if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "required") {
				status = http.StatusBadRequest
			}
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		cat := mealCategoryFromCachedReadOnly(day.Category)
		applyUserStarsToCategory(db, userID, &cat)
		json.NewEncoder(w).Encode(WeekPlanDayResponse{
			Date:       day.Date,
			Categories: []MealCategory{cat},
		})
	}
}

func PostRefreshWeekPlan(
	cache *services.MealPlanCache,
	db *sql.DB,
	cfg *config.Config,
	cookedLog *services.CookedLogService,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := getUserID(r)
		w.Header().Set("Content-Type", "application/json")
		if cache == nil || !cache.Enabled() {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "week_plan_unavailable"})
			return
		}
		var req WeekPlanRefreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		kitchen, err := resolveKitchenForUser(db, userID)
		if err != nil || kitchen == nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "kitchen_not_found"})
			return
		}
		primaryUser, pErr := primaryUserForKitchen(db, kitchen.KitchenID)
		if pErr != nil || primaryUser == "" {
			primaryUser = userID
		}
		day, err := RefreshWeekPlanDay(
			r.Context(), db, cfg, cookedLog, cache, kitchen.KitchenID, primaryUser,
			req.Date, req.MealSlot, req.Category, req.UserPrompt, req.MealType,
		)
		if err != nil {
			log.Printf("[meal-plan] refresh kitchen=%s date=%s slot=%s: %v", kitchen.KitchenID, req.Date, req.MealSlot, err)
			status := http.StatusInternalServerError
			if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "required") {
				status = http.StatusBadRequest
			}
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		cat := mealCategoryFromCachedReadOnly(day.Category)
		applyUserStarsToCategory(db, userID, &cat)
		json.NewEncoder(w).Encode(WeekPlanDayResponse{
			Date:       day.Date,
			Categories: []MealCategory{cat},
		})
	}
}
