# A difficulty only overrides numbers that have a name

Difficulty levels are planned, and today the numbers they would change are in
two places: `src/config.ts`, and about 1,200 written straight into physics, the
simulation, the brains and the drills. A difficulty is a typed set of overrides
of named numbers in config, applied once when a session starts. Game code reads
a number and never asks which difficulty it is in: there is no `if (hard)`.
So a number has to have a name in config before a difficulty can touch it, a
drill's numbers get a section of their own there (as `SERVE_DRILL` has), and
config is sorted by who owns each number, so that what a level changes can be
read in one place. Branching on the level in game code was turned down because
it scatters a level over every file it touches and nobody can say what "hard"
means without reading them all. A whole config for each level was turned down
because two copies of 2,400 lines drift apart.

## Considered options

- **A config file beside each drill.** It keeps a drill and its numbers in one
  folder, which is where the code is heading. Turned down for the numbers: the
  feel is tuned across drills (a pass window is the same pass in the Receive
  drill and the Mini Rally), and `AGENTS.md` promises one place to tune it. A
  drill gets its own section in config, not its own file of numbers.
- **`SET_LEVELS` as the pattern for everything**: a table with a row for each
  level, read by level. It is right where a mechanic has levels of its own (the
  set does). As the general answer it puts the level back in the game code, one
  lookup at a time.

## Consequences

- None of this is built except its measure. `tests/architecture.numbers.json`
  counts the numbers each simulation file still holds of its own, and the count
  only goes down. A file is ready for a difficulty when its count is near zero.
- The order of work: name the numbers file by file, the drills first (they are
  what a level changes most); sort config by owner as the sections fill; add
  the override when the first second level exists, and not before.
- How an override reaches the code (a tuning object handed down through the
  hosts, or the sections rebuilt when a session starts) is left to the change
  that adds the first level. What is fixed here is that it is data, typed
  against config, so a level can be read, compared and tested: "a harder level
  never widens a timing window" is a property test over the tables.
- In a shared session the host applies one difficulty for every seat
  (docs/adr/0011).
- Sorting `src/config.ts` moves most of its lines. It waits for the open
  feature pull requests, which all add to it.
