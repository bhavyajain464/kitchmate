#!/usr/bin/env python3
"""Generate photorealistic dish PNG masters via Gemini image API.

Reads GEMINI_API_KEY from backend/.env. Skips ids that already have masters/{id}.png.

Usage:
  python3 scripts/generate-dish-images-ai.py --limit 3
  python3 scripts/generate-dish-images-ai.py --id plain-naan --id masala-chai
  python3 scripts/generate-dish-images-ai.py
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
CATALOG = REPO / "backend/internal/services/dishes/catalog.json"
MASTERS = ROOT / "assets/dishes/masters"
CARD = ROOT / "assets/dishes/card"
PROGRESS = ROOT / "assets/dishes/.generation-progress.json"
ENV_FILE = REPO / "backend/.env"
PROMPT_SCRIPT = ROOT / "scripts/dish-image-prompts.mjs"
OPTIMIZE_SCRIPT = ROOT / "scripts/optimize-dish-images.mjs"

DEFAULT_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
MISSING_IDS = [
    "plain-naan",
    "plain-bhakri",
    "baati",
    "luchi",
    "kachori",
    "mirchi-ka-salan",
    "thecha",
    "veg-manchurian",
    "spring-rolls",
    "plain-kulcha",
    "chilli-chicken",
    "falooda",
    "masala-chai",
]


def load_env() -> None:
    if not ENV_FILE.is_file():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def load_catalog() -> list[dict]:
    return json.loads(CATALOG.read_text())


def has_master(dish_id: str) -> bool:
    return (MASTERS / f"{dish_id}.png").is_file()


def build_prompt(dish_id: str) -> str:
    out = subprocess.check_output(
        ["node", str(PROMPT_SCRIPT), "--id", dish_id],
        text=True,
        cwd=ROOT,
    ).strip()
    row = json.loads(out)
    return row["prompt"]


def save_progress(ok: list[str], fail: dict[str, str]) -> None:
    catalog = load_catalog()
    have = {d["id"] for d in catalog if has_master(d["id"])}
    pending = [d["id"] for d in catalog if d["id"] not in have]
    payload = {
        "ok": sorted(have),
        "fail": fail,
        "pending": len(pending),
        "total": len(catalog),
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    PROGRESS.write_text(json.dumps(payload, indent=2) + "\n")


def run_optimize(ids: list[str] | None = None, force: bool = False) -> None:
    cmd = ["node", str(OPTIMIZE_SCRIPT)]
    if force:
        cmd.append("--force")
    if ids:
        for dish_id in ids:
            subprocess.run([*cmd, "--id", dish_id], cwd=ROOT, check=False)
        return
    subprocess.run(cmd, cwd=ROOT, check=False)


def generate_image(client, model: str, prompt: str) -> bytes:
    from google.genai import types

    response = client.models.generate_content(
        model=model,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(aspect_ratio="3:2"),
        ),
    )
    for part in response.parts:
        if part.inline_data is not None:
            data = part.inline_data.data
            if isinstance(data, str):
                import base64

                return base64.b64decode(data)
            return bytes(data)
        if hasattr(part, "as_image"):
            img = part.as_image()
            buf = BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()
    raise RuntimeError("No image in response")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", action="append", default=[])
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--delay", type=float, default=2.0)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_env()
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not args.dry_run and not api_key:
        print("GEMINI_API_KEY missing — set in backend/.env", file=sys.stderr)
        return 1

    catalog = load_catalog()
    if args.id:
        items = [d for d in catalog if d["id"] in args.id]
    else:
        items = [
            d
            for d in catalog
            if d["id"] in MISSING_IDS and (args.force or not has_master(d["id"]))
        ]

    if args.limit:
        items = items[: args.limit]

    if not items:
        print("Nothing to generate.")
        save_progress([], {})
        return 0

    MASTERS.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        for dish in items:
            print(f"\n# {dish['id']} — {dish.get('display_name') or dish.get('name')}")
            print(build_prompt(dish["id"]))
        print(f"\n… {len(items)} total")
        return 0

    from google import genai

    client = genai.Client(api_key=api_key)
    ok: list[str] = []
    fail: dict[str, str] = {}
    existing_fail: dict[str, str] = {}
    if PROGRESS.is_file():
        try:
            existing_fail = json.loads(PROGRESS.read_text()).get("fail") or {}
        except json.JSONDecodeError:
            pass
    fail.update(existing_fail)

    for i, dish in enumerate(items, 1):
        dish_id = dish["id"]
        dest = MASTERS / f"{dish_id}.png"
        if not args.force and dest.is_file():
            ok.append(dish_id)
            continue
        prompt = build_prompt(dish_id)
        try:
            png = generate_image(client, args.model, prompt)
            dest.write_bytes(png)
            ok.append(dish_id)
            fail.pop(dish_id, None)
            print(f"[{i}/{len(items)}] ok {dish_id}")
            save_progress(ok, fail)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            fail[dish_id] = msg
            print(f"[{i}/{len(items)}] FAIL {dish_id}: {msg}", file=sys.stderr)
            save_progress(ok, fail)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                print("Rate limit / credits exhausted — stopping.", file=sys.stderr)
                return 2
        time.sleep(args.delay)

    save_progress(ok, fail)
    run_optimize(ids=ok, force=True)
    subprocess.run(["npm", "run", "generate:dish-images"], cwd=ROOT, check=False)
    print(f"Done: {len(ok)} generated, {len(fail)} failed")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
