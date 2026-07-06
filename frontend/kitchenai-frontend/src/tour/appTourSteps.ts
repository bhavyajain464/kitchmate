import type { MainTabParamList } from '../navigation/types';

export type TourTooltipPlacement = 'above' | 'below' | 'center';

export type TourTab = keyof MainTabParamList;

export type AppTourStep = {
  id: string;
  title: string;
  body: string;
  tab: TourTab;
  targetId?: string;
  fallbackTargetId?: string;
  placement: TourTooltipPlacement;
};

export const APP_TOUR_STEPS: AppTourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to your kitchen',
    body: "You're set up. Here's a quick tour of every part of Rasoi Buddy.",
    tab: 'Home',
    placement: 'center',
  },
  {
    id: 'quick-actions',
    title: 'Quick actions',
    body: 'Add items, get meal ideas, log meals, or add to your shopping list.',
    tab: 'Home',
    targetId: 'home-quick-actions',
    placement: 'below',
  },
  {
    id: 'meal-of-day',
    title: 'Meal of the day',
    body: "Today's meals from your week plan. Tap to view or edit the plan.",
    tab: 'Home',
    targetId: 'home-meal-of-day',
    placement: 'below',
  },
  {
    id: 'expiry',
    title: 'Expiry alerts',
    body: 'Expired and expiring items show up here — tap to reorder or use them before they go bad.',
    tab: 'Home',
    targetId: 'home-expiry',
    fallbackTargetId: 'home-pantry-fallback',
    placement: 'below',
  },
  {
    id: 'profile',
    title: 'Your profile',
    body: 'Update diet prefs, your plan, and kitchen invite code.',
    tab: 'Home',
    targetId: 'home-profile',
    placement: 'below',
  },
  {
    id: 'tabs',
    title: 'Five kitchen tabs',
    body: "Home, Inventory, Meals, Cook, and Shopping — we'll walk through each one next.",
    tab: 'Home',
    targetId: 'tour-tab-bar',
    placement: 'center',
  },
  {
    id: 'inventory-toolbar',
    title: 'Stock your pantry',
    body: 'Search items, add manually, or scan a grocery bill to fill your inventory.',
    tab: 'Inventory',
    targetId: 'inventory-toolbar',
    placement: 'below',
  },
  {
    id: 'meals-week-plan',
    title: 'Week plan',
    body: 'Plan breakfast, lunch, and dinner for the week ahead.',
    tab: 'Meals',
    targetId: 'meals-week-plan',
    placement: 'below',
  },
  {
    id: 'cook-composer',
    title: 'WhatsApp your cook',
    body: "Send today's menu to your cook in one tap.",
    tab: 'Cook',
    targetId: 'cook-composer',
    placement: 'below',
  },
  {
    id: 'cook-recipes',
    title: 'Cooking instructions',
    body: 'Browse recipes with ingredients, prep time, and step-by-step instructions. Tap any dish to open it.',
    tab: 'Cook',
    targetId: 'cook-recipes-list',
    placement: 'below',
  },
  {
    id: 'shopping-suggestions',
    title: 'Smart suggestions',
    body: 'Items to order based on your meal plan and pantry gaps.',
    tab: 'Shopping',
    targetId: 'shopping-suggestions',
    placement: 'below',
  },
  {
    id: 'shopping-list',
    title: 'Your shopping list',
    body: 'Build your list and order from Blinkit, Zepto, and other partners.',
    tab: 'Shopping',
    targetId: 'shopping-list',
    placement: 'below',
  },
];

export const APP_TOUR_TARGET_IDS = {
  quickActions: 'home-quick-actions',
  mealOfDay: 'home-meal-of-day',
  expiry: 'home-expiry',
  pantryFallback: 'home-pantry-fallback',
  profile: 'home-profile',
  tabBar: 'tour-tab-bar',
  inventoryToolbar: 'inventory-toolbar',
  mealsWeekPlan: 'meals-week-plan',
  cookComposer: 'cook-composer',
  cookRecipesList: 'cook-recipes-list',
  shoppingSuggestions: 'shopping-suggestions',
  shoppingList: 'shopping-list',
} as const;
