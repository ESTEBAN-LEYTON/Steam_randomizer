#!/usr/bin/env python3
"""Descarga tu biblioteca de Steam y genera data.json para la web del backlog.

Variables de entorno obligatorias:
  STEAM_API_KEY  -> tu clave de https://steamcommunity.com/dev/apikey
  STEAM_ID       -> tu SteamID64 (17 dígitos)

Solo usa la biblioteca estándar de Python (no hace falta pip install).
Requisito: el perfil y los "Detalles de juegos" deben ser públicos en Steam.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.steampowered.com"
ASSET_CDN = "https://shared.akamai.steamstatic.com/store_item_assets/"
ICON_CDN = "https://media.steampowered.com/steamcommunity/public/images/apps/"
IMG_BATCH = 100
OUTPUT = Path(__file__).resolve().parent.parent / "data.json"
WORKERS = 6
RETRIES = 3


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"Error: falta la variable de entorno {name}.")
    return value


def get_json(path: str, params: dict) -> dict | None:
    """GET a la Web API de Steam. Devuelve None si el juego no tiene logros (400/403)."""
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "steam-backlog-script"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            # 400 = "Requested app has no stats"; 403 = perfil privado para ese dato
            if e.code in (400, 403):
                return None
            if e.code == 429 or e.code >= 500:
                time.sleep(2 * attempt)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 * attempt)
    return None


def owned_games(key: str, steamid: str) -> list[dict]:
    data = get_json(
        "IPlayerService/GetOwnedGames/v1/",
        {
            "key": key,
            "steamid": steamid,
            "include_appinfo": 1,
            "include_played_free_games": 1,
            "format": "json",
        },
    )
    if data is None:
        sys.exit("Error: no se pudo leer la biblioteca. ¿Clave correcta y perfil público?")
    games = data.get("response", {}).get("games")
    if games is None:
        sys.exit(
            "Error: Steam no devolvió juegos. Revisa que 'Detalles de juegos' sea público "
            "en la privacidad de tu perfil y que STEAM_ID sea el SteamID64."
        )
    return games


def achievements(key: str, steamid: str, appid: int) -> tuple[int, int]:
    """Devuelve (desbloqueados, total). (0, 0) si el juego no tiene logros."""
    data = get_json(
        "ISteamUserStats/GetPlayerAchievements/v1/",
        {"key": key, "steamid": steamid, "appid": appid},
    )
    if not data:
        return 0, 0
    stats = data.get("playerstats", {})
    if not stats.get("success"):
        return 0, 0
    achs = stats.get("achievements") or []
    done = sum(1 for a in achs if a.get("achieved") == 1)
    return done, len(achs)


def store_images(appids: list[int]) -> dict[int, str]:
    """URL de la cápsula pequeña (231x87) de cada juego, consultando la tienda por lotes."""
    images: dict[int, str] = {}
    for i in range(0, len(appids), IMG_BATCH):
        chunk = appids[i : i + IMG_BATCH]
        query = {
            "ids": [{"appid": a} for a in chunk],
            "context": {"language": "spanish", "country_code": "US"},
            "data_request": {"include_assets": True},
        }
        data = get_json("IStoreBrowseService/GetItems/v1/", {"input_json": json.dumps(query)})
        for item in (data or {}).get("response", {}).get("store_items", []):
            assets = item.get("assets") or {}
            fmt = assets.get("asset_url_format")
            name = assets.get("small_capsule") or assets.get("header")
            if fmt and name and item.get("appid"):
                images[item["appid"]] = ASSET_CDN + fmt.replace("${FILENAME}", name)
    return images


def main() -> None:
    key = env("STEAM_API_KEY")
    steamid = env("STEAM_ID")

    games = owned_games(key, steamid)
    print(f"Juegos en la biblioteca: {len(games)}")

    # Solo consultamos logros de juegos que exponen estadísticas (ahorra cientos de llamadas).
    with_stats = [g for g in games if g.get("has_community_visible_stats")]
    print(f"Consultando logros de {len(with_stats)} juegos…")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = pool.map(lambda g: achievements(key, steamid, g["appid"]), with_stats)
        ach_by_app = {g["appid"]: r for g, r in zip(with_stats, results)}

    print("Buscando imágenes…")
    images = store_images([g["appid"] for g in games])

    out = []
    for g in games:
        done, total = ach_by_app.get(g["appid"], (0, 0))
        icon = g.get("img_icon_url")
        out.append(
            {
                "appid": g["appid"],
                "name": g.get("name") or f"App {g['appid']}",
                "playtime_min": int(g.get("playtime_forever", 0)),
                "ach_done": done,
                "ach_total": total,
                "img": images.get(g["appid"], ""),
                "icon": f"{ICON_CDN}{g['appid']}/{icon}.jpg" if icon else "",
            }
        )
    out.sort(key=lambda x: x["name"].casefold())

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "games": out,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Escrito {OUTPUT} con {len(out)} juegos.")


if __name__ == "__main__":
    main()
