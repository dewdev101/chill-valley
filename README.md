# 🌾 Chill Valley

A cozy little farming game that runs in the browser — no build step, no dependencies.

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Walk |
| E / Space | Use tool · harvest · open market · go to bed |
| 1–4 | Hoe · Watering can · Seeds · Basket |
| Q | Switch seed type |
| M | Toggle music |
| Esc | Close menus |

## How it works

- **Till** grass with the hoe, **plant** seeds, **water** them. Refill the can at the pond.
- Watered crops grow one stage each night. Rainy days water everything for you.
- Sell produce and buy new seeds at the **Valley Market**.
- Press **E** at the farmhouse door to go inside. Sleep in the bed to end the day; walk out the front doorway to leave.
- Each action costs energy. Sleep to restore it; stay up past 2 AM and you'll pass out (and lose 10% of your gold).
- The game auto-saves to `localStorage` every time you sleep.

| Crop | Seed | Sells | Days | Notes |
| --- | --- | --- | --- | --- |
| Turnip | 20g | 45g | 3 | |
| Carrot | 35g | 80g | 4 | |
| Strawberry | 60g | 110g | 5 | Regrows every 2 days |
| Pumpkin | 100g | 320g | 7 | |

## Project layout

```
index.html      page shell, HUD, title screen
src/style.css   HUD, hotbar, menus
src/game.js     game loop, world, rendering, audio, save/load
assets/         PixelLab sprites (see Art)
```

## Art

Sprites in `assets/` were generated with [PixelLab](https://www.pixellab.ai):

```
assets/farmer/<dir>.png                     player "Farm Boy", 8 directions (68×68)
assets/farmer/walk/<dir>/0-5.png            6-frame walk cycle per direction
assets/house.png  assets/market.png          buildings
assets/interior.png                         inside the farmhouse (400×256, drawn at 2×)
assets/tree.png   assets/rock.png            scenery
assets/crops/{turnip,carrot,strawberry,pumpkin}.png   ripe crops & icons
```

Ground tiles, seedlings, tools, weather and lighting are still drawn in code, and the music is generated with the Web Audio API. If a sprite is missing, the game falls back to its hand-drawn version.
