# Otto Field — p5 Phone

A phone augmented-reality sketch. Point the rear camera at a tabletop, show it a green object, and an Otto anchors itself above the object. The creature is drawn with the `Otto1.gif` sprite, and a join button connects several phones to the same shared room.

It is the same setup you have used in the p5 web editor:

- `index.html` links p5.js 2.x and p5-phone.
- `sketch.js` is your sketch.

It also includes two extras. `.github/workflows/static.yml` tells GitHub to publish your sketch as a web page every time you push. `.agents/skills` teaches coding agents about p5.js 2.x and p5-phone (see the end of this page).

## Use it

The full walkthrough with screenshots is here:
https://digitalfuturesocadu.github.io/vsCodeSetup/guide/

The short version:

1. Click **Use this template**, then **Create a new repository**. Keep it **Public**.
2. In your new repository, open **Settings**, then **Pages**. Set **Source** to **GitHub Actions**.
3. In VS Code, choose **Clone Git Repository**, then **Clone from GitHub**, and pick your new repository.
4. Open `index.html` and click **Go Live** to see the sketch on your laptop.
5. Change `sketch.js`. In Source Control, write a message, click **Commit**, then **Sync Changes**.
6. Wait about a minute. Open this address on your phone:

```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

## What is in the sketch

**Otto Field** opens the rear camera and looks for the largest green blob in the frame:

- Each frame is downsampled to a 160 × 90 buffer. Pixels where green clearly dominates red and blue are marked, and a flood fill finds the biggest connected blob. Wood, skin, white paper and grey tabletops fall out; a green object does not.
- The blob's centre and apparent size are smoothed, then mapped back into camera screen space. The Otto's size follows the marker's screen size, so walking closer to the object makes the creature grow, like a real object at that distance.
- The Otto is drawn from the animated `Otto1.gif` sprite, cropped to the creature and scaled by its **Size** stat.
- The green marker is also the **origin of a tabletop field**. The marker is four field units across, so one unit is about a quarter of its width. Food, other Ottos and every movement in the rules are measured in those units, which means the behaviour stays physical when the phone moves closer or further away.
- Every quarter second the Otto picks the nearest thing inside its **Sight**: food it can eat, or another player's Otto. It then wanders, eats, flees or hunts. Its position is broadcast to the room, so each phone sees the other players' creatures in the same field.
- A **JOIN SHARED SPACE** button appears in the HUD. Tapping it connects this phone to the class room (`a1-orbit`) on the p5-phone Share server; the HUD then shows how many phones are online. Playing solo stays available if you never join.
- The **TUNE** button opens a panel with one slider per stat and a FIELD toggle that draws the sight radius and the field grid. It is meant for balancing during the demo.

The **green object** can be anything clearly green — a sticky note, a bottle cap, a LEGO brick, a piece of tape, a plant leaf. Point the camera so it sits inside the viewfinder, and keep the phone reasonably steady while the Otto locks on.

## How the stats behave

| Stat | Starting value | What it does |
| --- | --- | --- |
| Attack | 10 | Damage in a fight. On contact the Otto with the higher Attack spends less energy. |
| Speed | 2.5 | Field units per second. Wandering is slower than walking to food or a rival. |
| Size | 1 | Scales the sprite, and counts as threat: a larger Otto is scarier to others. |
| Sight | 8 | Radius, in field units, in which food and other Ottos are noticed. |
| Aggression | 10 | Compared with ten times the other Otto's Size. Below it the Otto flees; at or above it the Otto hunts. |
| EnergyRequirement | 50 | Food units needed per day. Energy drains steadily, and a one-minute day burns the whole requirement. |

Decisions, in order, when the Otto looks around:

1. If another Otto is in sight and `Aggression < its Size × 10`, **flee** from it.
2. Otherwise, if it is hungry and food is in sight, **walk to the food and eat** (+10 energy, capped at `EnergyRequirement`).
3. Otherwise, if another Otto is in sight, **hunt** it. On contact both lose energy; a hungry Otto takes bigger risks because it is not distracted by food.
4. Otherwise **wander** slowly near the marker.

Food lives in the shared room, so every phone sees the same pieces. Any phone tops the supply back up to six, which keeps the demo alive if the host's phone sleeps. One Otto per phone, and every other phone's Otto is a potential rival.

## Tips for a good demo

- Use a green object that is clearly more saturated than everything else on the table.
- Avoid pointing at a window or a strongly green wall; the largest blob rule will pick it up.
- A steady hand helps while the lock settles. After that the Otto follows the marker smoothly.
- On a laptop the same page works with the built-in webcam, so you can test the detection before opening it on a phone.
- Open TUNE and raise Sight or Aggression if you want the Otto to react faster and more dramatically on stage.

## Skills for your coding agent

The `.agents/skills` folder holds two skills. A skill is a set of notes a coding agent reads when it needs them. OpenCode and the Chat in VS Code both look in this folder.

- `p5-phone` explains how p5-phone reaches the phone's sensors and asks for permissions.
- `p5js-2x` keeps the agent writing p5.js 2.x code, not the older 1.x code most models learned from.

They come from the [p5-phone repository](https://github.com/npuckett/p5-phone). Leave them as they are for now. You can add your own skills next to them later.
