## What changes for the player

<!-- One or two sentences in the player's words: what do they see, hear or feel differently? -->

## Why

<!-- Link the feel report, bug or idea (for example "Closes #12"). For a change to the feel, say what was reported, the cause, the fix and how you measured it. -->

## The court test

<!-- One question for each rule of the principle (README.md#the-principle). Leave out anything that doesn't apply. -->

- **Real sport:** what does a real court do, and where do the numbers come from (rules, measurement, video, coach, your own play)? Did you bend anything to make it playable, and why?
- **Skill:** is the player still graded on the volleyball skill, with every input going through `Input`?
- **Honest physics:** does the ball still go where the contact sends it?
- **Effects:** do they scale with the touch and keep the ball visible?
- **Played:** how did you play it (drill, position, camera, device)? What is left for a person to play on the preview goes under "What no check holds".

## How it is held

<!-- For a feat or a fix (CI reads this section then, and fails while only this comment is in it). Each behaviour the change adds or alters, the check that holds it and the one-line break that turned that check red:
"The ball leaves the hands at the angle it met them: tests/blockHands.test.ts, red with the angle forced to 0."
A check is a unit test, a trace run, an end-to-end check or a verify-court-feel feature file. For a change to the play, CI runs the changed tests against the code on main and wants one of them to fail there: `node scripts/red-on-base.mjs origin/main` says which do. -->

## What no check holds

<!-- For a feat or a fix (CI reads this section too), and for any other change that touches the game. What a person has to try, one line each: where (drill, position, camera, device) and what to look, listen or feel for. Write "Nothing" when every behaviour above is held.
If a change to the play, or to what is shown and heard, comes with no check at all, say why on a line of its own that starts with `Unchecked:`. That line is what lets it pass, and it is where the owner reads what was left to a person. -->

## Checklist

- [ ] README (and the start screen and in-game hints) updated if controls, modes, settings or config sections changed
- [ ] The reason for a call someone would argue about again is in a doc comment next to the code, or in `docs/adr/` if it has no place there
- [ ] Screenshots or a clip for anything visible, and `docs/screenshots/` retaken if one of those moments changed
- [ ] CREDITS.md updated if an asset or library was added
