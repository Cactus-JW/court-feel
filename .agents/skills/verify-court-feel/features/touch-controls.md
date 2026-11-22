# Touch controls

On a phone or tablet the game shows on-screen controls: a joystick under the left thumb, drag-to-aim on the right, hold buttons for JUMP, HIT, BLOCK and PASS, and one thin bar along the top: on the left a hitter's routes (a chip each, and ROUTES for the route panel) or, when you set, each hitter with their call, PLAY and HELP, and the opposing block; on the right the score (Mini Rally, a gold dot on the serving side), REPLAY, RESET and pause. The route panel opens under the bar from the left edge to the buttons; a drag on it scrolls it and a tap on a route calls it. The camera is the pause menu's View. A phone leaves out the title, the drill's intro line, speed, streak and the camera name, and key hints start off. Your position sizes the buttons (a setter's SET is big, HIT small). Touches go through the same input path as keys, so timing is identical. A setting (Auto, On, Off) and the `touch=1` link parameter control whether they show.

## Sub-features

- `touch-auto` turns the controls on by itself on a touch screen, with button names in the hints.
- `touch-menus` works the start screen, the pause menu and the Settings sheet by tapping, and the pause menu lists the drill's touch controls in place of its keys.
- `touch-stick` moves the athlete with the left-thumb stick, and runs the approach when pushed out to the ring.
- `touch-jump` loads a jump while JUMP is held and takes off on release.
- `touch-hit` winds up while a finger is down on the right half in the air, aims by dragging, and swings on release.
- `touch-top-row` calls a set or a route, calls a play on the wheel, toggles the opposing block and pauses.
- `touch-setting` chooses Auto, On or Off for `Touch controls`, in the Controls tab of Settings.

## How to get to it (user POV)

- Open the app on a touch screen. The controls appear when a drill starts.
- On a hybrid device, touch the screen once: in Auto the first touch turns them on.
- Settings, Controls tab, `Touch controls`: `Auto`, `On`, `Off`. Auto turns them on for touch screens.
- Add `touch=1` to a link to force them on a desktop. [Quick-start links](./quick-start-links.md) drives that entry.

## Driving it with court.mjs

Preconditions:

- A touch session is running: `court launch --touch` (844x390, touch screen). If a desktop session is also running, launch this one as `COURT_SESSION=phone` and prefix every `court` command in this recipe the same way.
- `court doctor` ends with `HEALTHY` and its page line says `touch session`.
- The recipe uses the manual clock (a test hook). Name it in the proof.

- **Start by tapping.** Open the app as a new player and start the Spike Drill with taps. Run `court open --fresh`, `court tap 'role=button[name="Skip to the drills"]'`, `court tap '.view.on .row:has(.row-t:text-is("Spike Drill"))'` and `court tap '.view.on .panel-foot .play-btn'`. The state line shows `"screen":"play"` and no `message`: a phone leaves out the drill's intro line. Run `court state`: `game.touchControls` is `true` and `game.pointerLocked` is `false`.
- **Freeze the clock.** Run `court clock manual` and `court shot touch-layout`: the stick ring at the bottom left, PASS, BLOCK, JUMP and HIT at the bottom right, the route chips `HIGH HUT GO 3 2`, `ROUTES` and `VS BLOCK` at the top left, `RESET` and pause at the top right, and the score sentence (`0 pts · rep 0 · set 1: …`) in a small line under the bar, not on the chips. No title, speed, streak or camera name. Run `court state`: `hud.hint` is empty (key hints start off; with Settings → Key hints on it names buttons such as `JUMP` and `RESET`, and leaves out the camera, which has no button).
- **Call a route.** Tap the second chip, `HUT`. Run `court touch start 4 '.touch [data-btn="d2"]'`, `court touch end 4` and `court step 0.05`. The state line shows `"title":"Spike Drill · Outside hut"` and `"route"` starting `2 Hut`.
- **Route panel.** Tap `ROUTES`: `court touch start 4 '.touch [data-btn="play"]'`, `court touch end 4`, `court step 0.3` and `court shot touch-routes`. The panel runs from the left edge to the buttons, under the bar, with the court sketch and all five routes (tempo and `GOOD PASS` not cut off); the score line is hidden while it is open. Tap a route in its list: `court eval '(()=>{const r=document.querySelectorAll(".rp-list li")[2].getBoundingClientRect();return Math.round(r.left+r.width/2)+" "+Math.round(r.top+r.height/2)})()'` gives its centre (`356 180` at 667x375), then `court touch start 2 <x> <y>`, `court touch end 2`, `court step 0.1`: the title ends `· Outside go`. A drag scrolls instead of calling: on a screen shorter than the list (`court resize 667 300`), `court touch start 1 300 230`, `court touch move 1 300 150`, `court touch end 1`, and `.route-panel`'s `scrollTop` is above 0. Tap `ROUTES` again to close it (`g.routesOpen` is `false`).
- **Stick.** Put the left thumb down and push it up to the ring. Run `court touch start 1 160 300`, `court touch move 1 160 210`, `court step 0.3` and `court state`. `game.stick` is `{"x":0,"y":1,"sprint":true}` and `game.me.z` is lower than before: the athlete is running at the net.
- **Jump.** Hold JUMP, then let go. Run `court touch start 2 .t-jump`, `court step 0.1` and `court state`: `game.me.state` is `load` and `game.held` is `["Space"]`. Run `court touch end 2`, `court step 0.05` and `court state`: `game.me.state` is `air`.
- **Hit.** In the air the whole right half is HIT. Put a finger down there, drag to aim, then lift. Run `court touch start 3 560 140`, `court touch move 3 640 150`, `court step 0.05` and `court state`: `game.me.action` is `windup`, `game.held` is `["Mouse0"]` and `game.yaw` is no longer `0`. Run `court shot touch-windup`. Run `court touch end 3`, `court step 0.05` and `court state`: `game.me.action` is `swing`. Lift the stick thumb: `court touch end 1`.
- **Camera.** There is no camera button on a phone: it is `View` in the pause menu (see **Pause**).
- **Opposing block.** Tap `VS BLOCK`. Run `court touch start 4 '.touch [data-btn="vsblock"]'`, `court touch end 4` and `court step 0.05`. The state line shows a title ending `· block: single`.
- **Pause.** Tap the pause button. Run `court touch start 5 .t-pause` and `court touch end 5`. The state line after the first command shows `"screen":"paused"`. Run `court state`: `pauseMenu.keys` lists the touch controls, starting `"Left thumb: Push the stick out to the ring to run the approach"` and `"JUMP: Hold to load, release to take off"`, and `pauseMenu.quick` is `{"View":"First person","Touch aim sensitivity":"1.00","Volume":"80%"}`.
- **Setting.** Open the settings and tap the three `Touch controls` chips in turn, reading `court state` after each. Run `court tap 'role=button[name="Settings"]'`: the state line shows `"screen":"settings"`, `"sheet":"settings"` and `"tab":"Controls"`. Run `court tap '.set-row:has-text("Touch controls") .chip:text-is("On")'` and `court state`: the `Touch controls` row in `settingsPanel.rows` reads `On`, `game.touchControls` is `true` and `saved.settings.touchControls` is `"on"`. Run `court tap '.set-row:has-text("Touch controls") .chip:text-is("Off")'` and `court state`: the row reads `Off`, `game.touchControls` is `false` and `saved.settings.touchControls` is `"off"`. Run `court tap '.set-row:has-text("Touch controls") .chip:text-is("Auto")'` and `court state`: the row reads `Auto`, `game.touchControls` is `true` again and `saved.settings.touchControls` is `"auto"`.
- **Resume.** Run `court tap 'role=button[name="DONE"]'` and `court tap '.pause .play-btn'`. The state line after `DONE` shows `"screen":"paused"`, and after the second tap `"screen":"play"`.
- **Play wheel by touch (setter).** Run `court open '?mode=setter&pos=OH' --manual` and `court step 0.5`. The bar reads `OH High · MB 1 · OPP Back · PIPE High`, `PLAY` and `ROW`, and the buttons are a setter's (BLOCK big, HIT small). Tap `PLAY` with a small wobble: `court touch start 1 '.touch [data-btn="play"]'`, `court touch move 1 292 12`, `court touch end 1`, `court step 0.1`. `court eval 'g.wheelOpen'` is `true`: the wobble called nothing. Touch a play and let go: `court touch start 2 380 300`, `court touch end 2`, `court step 0.1`. The state line shows `"message":"Play · Double quick"` (667x375; the wheel opens below the bar, scaled to fit a short screen). Hold `PLAY` and slide onto a play instead: `court touch start 1 '.touch [data-btn="play"]'`, `court touch move 1 <x> <y>` onto a slice, `court touch end 1`.
- **Proof.** Run `court errors`. It reports `"count": 0`.

## Gotchas

- `REPLAY` (`.touch [data-btn="replay"]`) is shown only while the last attempt can be replayed (`g.replayAvailable()`), misses included. The hint then ends `REPLAY last attempt`. Press it with `court touch start 4 '.touch [data-btn="replay"]'` and `court touch end 4`; any later touch skips the replay.
- `court tap` works on menu controls only. The pad's buttons take no pointer events of their own (the pad reads every touch by position), so `court tap .t-jump` times out. Use `court touch start <id> <selector>` and `court touch end <id>`.
- The set-call chips and the other top-row buttons for a drill are built on the first frame after it starts. On the manual clock, run the recipe's `court shot` (or a `court step`) before touching them, or `court touch start` finds no chip.
- Touch ids are fingers. A finger stays down across commands until its `end`. `court open` lifts them all. Reuse an id only after its `end`.
- Coordinates in the recipe are for the 844x390 session. Selectors do not depend on the size.
- The stick reads the thumb's movement on the next `court step`, like a key.
- The hit swing in the recipe meets no ball. It proves the controls, not a graded contact. A graded touch rep needs the timing of a real approach.
- On the ground a finger on the right half aims without hitting. Only while loading or in the air is the whole right half HIT. On the ground, hit with `court touch start <id> .t-hit`.
- The helper cannot rotate the phone, so the "Turn your phone sideways" message in portrait is not drivable. Haptics and fullscreen cannot be observed here.
- With `Touch controls` set to `Off` the pad is gone but the menus still take taps. The recipe leaves the setting on Auto.
- On a touch session the gold buttons have no key cap, so `role=button[name="PLAY"]` and `role=button[name="RESUME"]` do match here. On a desktop session they do not. The recipe uses `.view.on .panel-foot .play-btn` and `.pause .play-btn`, which work on both.
- `hud.hint` is empty until the drill has drawn a frame. Read it after the recipe's `court shot` or a `court step`, not straight after the tap on `PLAY`.
