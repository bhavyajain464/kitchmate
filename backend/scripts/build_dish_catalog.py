#!/usr/bin/env python3
"""Merge indian_food.csv + all Multi_Cuisine rows into dishes/catalog.json."""

import csv
import json
import re
from pathlib import Path

INDIAN_FOOD = Path("/Users/bhavyajain/Downloads/indian_food.csv")
MULTI_CUISINE = Path("/Users/bhavyajain/Downloads/Multi_Cuisine_Recipe_Dataset.csv")
OUT = Path(__file__).resolve().parent.parent / "internal/services/dishes/catalog.json"

NON_VEG = re.compile(
    r"\b(chicken|mutton|lamb|fish|prawn|shrimp|seafood|egg|eggs|meat|keema|"
    r"tuna|salmon|beef|pork|bacon|ham|turkey|duck|crab|lobster)\b",
    re.I,
)
LONG_LASTING = re.compile(
    r"\b(biryani|khichdi|rajma|chole|pulao|pickle|batch|meal prep|pongal)\b", re.I
)
TASTY = re.compile(
    r"\b(butter|tikka|korma|masala|fried|cheese|cream|rich|burrito)\b", re.I
)
HEALTHY = re.compile(
    r"\b(dal|sabzi|rasam|sambar|kootu|poriyal|steamed|salad|soup|khichdi)\b", re.I
)

REGION_MAP = {
    "north": "north-indian",
    "south": "south-indian",
    "east": "east-indian",
    "west": "west-indian",
}


def unified_cuisine(area: str, region: str = "") -> str:
    """Single cuisine slug: north-indian, italian, indian, etc."""
    region = (region or "").strip().lower()
    if region in REGION_MAP:
        return REGION_MAP[region]
    area = re.sub(r"\s+", "_", (area or "indian").strip().lower())
    return area


def norm_key(name: str) -> str:
    return re.sub(r"\s+", " ", name.lower().strip())


def clean_name(name: str) -> str:
    name = re.sub(r"\s+", " ", name.strip())
    return name[:120] if len(name) > 120 else name


def tokenize_ingredients(text: str, limit: int = 10) -> list[str]:
    if not text:
        return []
    parts = re.split(r"[,;]", text.lower())
    out = []
    for p in parts:
        p = re.sub(r"\d+[^a-z]*", " ", p)
        p = re.sub(r"[^a-z\s]", " ", p)
        for w in p.split():
            w = w.strip()
            if len(w) < 3 or w in {"cup", "cups", "tablespoon", "teaspoon", "grams", "the", "and", "with"}:
                continue
            if w not in out:
                out.append(w)
            if len(out) >= limit:
                return out
    return out


def base_categories(course_or_cat: str) -> set[str]:
    c = (course_or_cat or "").lower()
    cats = {"daily"}
    if any(x in c for x in ("main", "lunch", "dinner", "side", "course")):
        cats.add("meal_of_day")
    return cats


def extra_categories(name: str) -> set[str]:
    cats = set()
    if LONG_LASTING.search(name):
        cats.add("long_lasting")
    if TASTY.search(name):
        cats.add("most_tasty")
    if HEALTHY.search(name):
        cats.add("most_healthy")
    if any(k in name.lower() for k in ("expir", "leftover", "quick")):
        cats.add("rescue_meal")
    return cats


def diet_from_row(diet_field: str, name: str) -> list[str]:
    d = (diet_field or "").lower()
    if "non" in d or NON_VEG.search(name):
        return ["non-veg"]
    return ["vegetarian"]


def merge_dish(store: dict, entry: dict) -> None:
    key = norm_key(entry["name"])
    if not key:
        return
    if key not in store:
        store[key] = entry
        return
    cur = store[key]
    if not cur.get("cuisine") and entry.get("cuisine"):
        cur["cuisine"] = entry["cuisine"]
    elif cur.get("cuisine") == "indian" and entry.get("cuisine", "").endswith("-indian"):
        cur["cuisine"] = entry["cuisine"]
    cur["diet"] = sorted(set(cur.get("diet", []) + entry.get("diet", [])))
    cur["categories"] = sorted(set(cur.get("categories", []) + entry.get("categories", [])))
    cur["keywords"] = list(dict.fromkeys(cur.get("keywords", []) + entry.get("keywords", [])))[:14]


def load_indian_food(store: dict) -> None:
    with INDIAN_FOOD.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = clean_name(row.get("name", ""))
            if not name:
                continue
            region_raw = (row.get("region") or "").strip().lower()
            cuisine = unified_cuisine("indian", region_raw)
            course = row.get("course", "")
            cats = sorted(base_categories(course) | extra_categories(name))
            kw = tokenize_ingredients(row.get("ingredients", ""))
            if row.get("flavor_profile"):
                kw.append(row["flavor_profile"].lower())
            if row.get("state") and row["state"] != "-1":
                kw.append(row["state"].lower())
            merge_dish(
                store,
                {
                    "name": name,
                    "cuisine": cuisine,
                    "diet": diet_from_row(row.get("diet", ""), name),
                    "categories": cats,
                    "keywords": kw[:12],
                },
            )


def load_multi_cuisine_all(store: dict) -> None:
    """All 620 recipe rows — Indian households may want Italian, Chinese, etc."""
    with MULTI_CUISINE.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            name = clean_name(row.get("name", ""))
            if not name:
                continue
            area = (row.get("area") or "Indian").strip()
            cuisine = unified_cuisine(area)
            cat_field = row.get("category", "")
            cats = sorted(base_categories(cat_field) | extra_categories(name))
            kw = tokenize_ingredients(row.get("ingredients", ""))
            kw.append(cuisine)
            if cat_field:
                kw.append(cat_field.lower().replace(" ", "_"))
            merge_dish(
                store,
                {
                    "name": name,
                    "cuisine": cuisine,
                    "diet": diet_from_row("", name),
                    "categories": cats,
                    "keywords": kw[:12],
                },
            )


def main() -> None:
    store: dict[str, dict] = {}
    load_indian_food(store)
    load_multi_cuisine_all(store)
    dishes = sorted(store.values(), key=lambda d: (d.get("cuisine", ""), d["name"].lower()))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        json.dump(dishes, f, ensure_ascii=False, indent=2)
        f.write("\n")
    veg = sum(1 for d in dishes if "vegetarian" in d.get("diet", []))
    by_cuisine: dict[str, int] = {}
    for d in dishes:
        c = d.get("cuisine", "?")
        by_cuisine[c] = by_cuisine.get(c, 0) + 1
    print(f"Wrote {len(dishes)} dishes to {OUT} ({veg} vegetarian, {len(dishes)-veg} non-veg)")
    print("By cuisine:", dict(sorted(by_cuisine.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    main()
