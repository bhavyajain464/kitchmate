#!/usr/bin/env node
/**
 * Build photorealistic food photography prompts for dish catalog entries.
 * Used by generate-dish-images-ai.py and Cursor batch generation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const CATALOG_PATH = path.resolve(
  ROOT,
  '../../backend/internal/services/dishes/catalog.json',
);

const VESSEL = {
  bread: 'wicker basket lined with a checkered cloth holding',
  beverage: 'traditional clay kulhad cup of',
  dessert: 'tall chilled glass of',
  drink: 'tall chilled glass of',
  fried: 'steel plate piled with',
  snack: 'steel plate piled with',
  chutney: 'small stone mortar bowl of',
  side: 'deep ceramic bowl of',
  default: 'deep ceramic bowl of',
};

function vesselFor(dish) {
  const tags = dish.tags ?? [];
  const meal = dish.meal_type ?? [];
  if (tags.includes('bread')) return VESSEL.bread;
  if (tags.includes('beverage') || tags.includes('breakfast-staple') && meal.includes('breakfast') && (dish.name ?? '').toLowerCase().includes('chai')) {
    return VESSEL.beverage;
  }
  if (tags.includes('dessert') || tags.includes('drink') || meal.includes('dessert')) {
    return VESSEL.dessert;
  }
  if (tags.includes('fried') || tags.includes('fried-snack') || meal.includes('snack')) {
    return VESSEL.fried;
  }
  if (tags.includes('chutney')) return VESSEL.chutney;
  if (meal.includes('side') && !tags.includes('bread')) return VESSEL.side;
  return VESSEL.default;
}

function visualDescription(dish) {
  const name = (dish.display_name || dish.name || '').toLowerCase();
  const ings = (dish.key_ingredients ?? []).slice(0, 6).join(', ');
  const tags = dish.tags ?? [];

  if (name.includes('naan')) {
    return 'soft pillowy tandoor-baked flatbreads with golden-brown charred spots and a light flour dusting, stacked warmly';
  }
  if (name.includes('kulcha')) {
    return 'fluffy leavened Punjabi flatbreads with a crisp golden exterior and soft white interior, brushed lightly with butter';
  }
  if (name.includes('bhakri')) {
    return 'rustic round jowar flatbreads with a hearty coarse texture, lightly browned on the griddle';
  }
  if (name.includes('baati')) {
    return 'round whole-wheat baati rolls baked golden with a firm crust and ghee-sheened surface';
  }
  if (name.includes('luchi')) {
    return 'puffed deep-fried Bengali luchis, golden and airy with a delicate crisp shell';
  }
  if (name.includes('kachori')) {
    return 'crispy golden moong dal-stuffed kachoris with flaky layered pastry and a savory spiced filling';
  }
  if (name.includes('mirchi') && name.includes('salan')) {
    return 'Hyderabadi green chilli salan in a rich peanut-sesame gravy, with whole chillies simmered in tangy tamarind-spiced curry';
  }
  if (name.includes('thecha')) {
    return 'coarse Maharashtrian thecha chutney of crushed green chillies, garlic, and peanuts with a vibrant fresh green color';
  }
  if (name.includes('manchurian')) {
    return 'crispy vegetable manchurian balls tossed in glossy Indo-Chinese sauce with capsicum and spring onion';
  }
  if (name.includes('spring roll')) {
    return 'golden crispy fried spring rolls with a crunchy wrapper and visible shredded vegetable filling';
  }
  if (name.includes('chilli chicken')) {
    return 'succulent chicken pieces wok-tossed in spicy Indo-Chinese chilli sauce with onions, capsicum, and green chillies';
  }
  if (name.includes('falooda')) {
    return 'layered rose-milk falooda with basil seeds, vermicelli, rose syrup, and a scoop of ice cream on top';
  }
  if (name.includes('chai') || name.includes('tea')) {
    return 'creamy masala chai with a frothy milky surface, warm amber-brown color, and aromatic spice notes';
  }
  if (tags.includes('bread')) {
    return `freshly made ${dish.display_name || dish.name} with authentic Indian home-kitchen texture, made with ${ings}`;
  }
  return `homestyle ${dish.display_name || dish.name} with appetizing natural colors and realistic texture, featuring ${ings}`;
}

function garnishHint(dish) {
  const name = (dish.display_name || dish.name || '').toLowerCase();
  const tags = dish.tags ?? [];
  if (tags.includes('bread')) return 'a light brush of melted butter and a sprinkle of nigella seeds';
  if (name.includes('chai')) return 'a dusting of cardamom and a few tea leaves on the rim';
  if (name.includes('falooda')) return 'chopped pistachios and a drizzle of rose syrup';
  if (tags.includes('indo-chinese')) return 'sesame seeds and sliced spring onions';
  if (tags.includes('chutney') || name.includes('thecha')) return 'a swirl of cooking oil and fresh coriander';
  if (tags.includes('fried') || tags.includes('fried-snack')) return 'fresh coriander and a wedge of lemon';
  return 'fresh coriander leaves and a light tempering of spices';
}

function pairLabel(pairs, catalogById) {
  const labels = (pairs ?? [])
    .slice(0, 2)
    .map((id) => {
      const d = catalogById.get(id);
      if (d) return d.display_name || d.name;
      return id.replace(/_/g, ' ').replace(/-/g, ' ');
    })
    .filter(Boolean);
  return labels.length ? labels.join(' and ') : 'a simple Indian side dish';
}

/** Photorealistic dish photography prompt (3:2 landscape delivery). */
export function buildDishImagePrompt(dish, catalogById = new Map()) {
  const name = dish.display_name || dish.name;
  const vessel = vesselFor(dish);
  const visual = visualDescription(dish);
  const garnish = garnishHint(dish);
  const accompaniment = pairLabel(dish.pairs_with, catalogById);

  return (
    `A photorealistic, close-up food photography shot of ${vessel} ${name} resting on a rustic wooden kitchen counter in a cozy home kitchen. ` +
    `The dish features ${visual}. It is beautifully garnished with ${garnish}. ` +
    `In the softly blurred background (bokeh), there is a warm, inviting home kitchen setting with a hint of a stovetop, a folded checkered dish towel, and a plate of ${accompaniment}. ` +
    `Natural morning sunlight streams in from a nearby window, creating soft, warm lighting and appetizing highlights on the food. ` +
    `Shot on a 50mm macro lens, f/1.8 for a shallow depth of field, 8k resolution, highly detailed, mouth-watering. ` +
    `Landscape 3:2 composition, no text, no labels, no watermark.`
  );
}

export function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

export function getDish(id) {
  return loadCatalog().find((d) => d.id === id) ?? null;
}

function parseArgs(argv) {
  const args = { ids: [], limit: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id' && argv[i + 1]) args.ids.push(argv[++i]);
    else if (argv[i] === '--limit' && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

if (process.argv[1]?.endsWith('dish-image-prompts.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  const byId = new Map(catalog.map((d) => [d.id, d]));
  let items = catalog;
  if (args.ids.length) items = items.filter((d) => args.ids.includes(d.id));
  if (args.limit) items = items.slice(0, args.limit);
  for (const dish of items) {
    if (args.dryRun) {
      console.log(`\n# ${dish.id} — ${dish.display_name || dish.name}`);
      console.log(buildDishImagePrompt(dish, byId));
    } else {
      console.log(
        JSON.stringify({
          id: dish.id,
          name: dish.display_name || dish.name,
          prompt: buildDishImagePrompt(dish, byId),
        }),
      );
    }
  }
}
