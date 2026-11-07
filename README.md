# Cloud Glider

A small 3D browser game: fly a paper glider over an archipelago of floating islands at sunset, in a low-poly style.

- Catch the **glowing orbs** to regain altitude and speed.
- Dodge the **rocks**, the **islands** and the **storms** (they drag you down).
- Don't fall into the **sea of clouds**.
- Diving builds speed, climbing costs it: manage your energy.

## Controls

| Action | Keyboard | Mouse / touch |
| --- | --- | --- |
| Steer | Arrow keys, WASD or ZQSD | Cursor or finger position relative to the center |
| Take off / fly again | Space or Enter | On-screen button |
| Pause | P or Esc | |

## Run locally

Nothing to install: it's plain HTML, CSS and JavaScript, with [three.js](https://threejs.org/) loaded from a CDN.

Serve the folder with any small local server:

```bash
python -m http.server 8123
```

Then open http://localhost:8123.

## Publish on GitHub Pages

1. Create a repository on GitHub and push this folder.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute, the game is live at `https://<your-username>.github.io/<repo-name>/`.

## Project structure

```
index.html    page, HUD and screens
style.css     interface styles
js/game.js    3D scene, flight model, collisions and game loop
```
