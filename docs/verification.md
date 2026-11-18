# Verification

How Court Feel keeps a change from breaking the game, and how to decide where a
new rule should live. [AGENTS.md](../AGENTS.md) says what to do; this says why
the checks are arranged the way they are. The list of every test and what it
fails on is in the [README](../README.md#testing).

## The principle

**Hold each rule in the cheapest layer that can hold it.**

There are five places a rule can live. They are ordered by what each costs
every time a change is made:

| Layer | What it is | What it costs |
|---|---|---|
| 1. The codebase | The structure makes the wrong thing awkward or impossible to write | Paid once |
| 2. Static analysis | Types, lint, the architecture test, unit tests, CI | Seconds, every change |
| 3. Verification | Running the game and comparing what happens | Minutes, every change |
| 4. Prose | `AGENTS.md`, decision records, skills | Has to be read, remembered and followed |
| 5. Human review | A person looks | A person, every time |

A rule that lives only in prose is a rule that will be broken by someone who
did not read it, person or agent. A rule that lives only in review is paid for
with attention on every pull request. So when a rule is added, or broken, ask
how high up the table it can go.

The order is Lauren Tan's pyramid ("how do I trust my agents more?").

## Where a new rule goes

Ask these in order and stop at the first yes.

1. **Can the structure make it impossible?** A brain is handed an `AiHost`, so
   it cannot reach the HUD: there is nothing to forbid. A `Simulation` has no
   renderer, so a test can build one. This is the best answer when it exists.
2. **Can a check hold it without running the game?** A type, a lint rule, a
   rule in `tests/architecture.test.ts`, a unit test that states the fact.
3. **Can a run show it?** The trace comparison for "nothing changed", a
   property test for "true for every input", the end-to-end run for "it still
   works in the browser".
4. **Only then prose.** Write it in `AGENTS.md`, and say there why no check
   holds it.
5. **Review is for what only a person can judge:** the feel, a decision, a
   change to the checks themselves.

## What holds what

### 1. The codebase

- **Every import points down** a fixed order of layers
  ([decision record 0010](adr/0010-the-simulation-runs-on-its-own.md)). The
  table is `tests/architecture.layers.json`.
- **The simulation runs on its own**: no DOM, no renderer, three.js for maths
  only. `src/game/simulation.ts`.
- **Narrow hosts.** Code is handed the few things it needs, not the object that
  has everything: `AiHost` for the brains, `SimulationHooks` for the simulation.
- **Physics is pure**: `config` and itself.

### 2. Static analysis

- **TypeScript, strict.** ESLint and Prettier.
- **The layer rule in the editor.** ESLint flags an import that points up a
  layer while it is being typed, from the same table as the test.
- **The architecture test** (`tests/architecture.test.ts`), which is the
  authority. It fails on an import that points up, on two files that import each
  other in a circle, on physics importing anything but `config`, on a brain
  importing `Game`, on a simulation file that touches the DOM or builds scene
  objects, on a clock or dice in the simulation (`Math.random`, `Date.now`,
  `performance.now`), on a test that fakes the game, and on a new folder with no
  layer.
- **Unit tests that state a real-court fact**, in the test's name.
- **CI on every pull request.**

### 3. Verification

- **The trace comparison** (`npm run trace:compare`), for a refactor. It plays
  every drill on the branch and on `main` with a seeded autopilot and compares
  the whole simulation after every frame, then what is drawn and shown: every
  call the HUD gets, the camera, the ball, every athlete's pose, the floor
  markers. Nothing is stored, so a feature that changes the play on purpose has
  nothing to re-record.
- **Property tests** (`tests/properties.test.ts`). A fact that must hold for
  every input, tried on hundreds of seeded ones. They are for the bugs nobody
  wrote a case for. The inputs are seeded, so the tests are as repeatable as any
  other and a failure prints the input that broke.
- **Invariants** (`tests/invariants.ts`). What is true of the simulation after
  every step: every number finite, nobody under the floor, the clock moving one
  step at a time. A rare bug fails at the step it happens.
- **The end-to-end run** (`npm run e2e`): every drill in a real browser through
  the real input path.
- **Driving the app.** The `verify-court-feel` skill lets an agent run the game
  and look, before it says a change works.

### 4. Prose

- **[AGENTS.md](../AGENTS.md)**: the working guide. Three of its rules have no
  check yet (below).
- **[Decision records](adr/README.md)**: why a call was made and what was
  turned down.
- **How to work on a change**, in `AGENTS.md`: the approach before the code,
  the test first, stop after three failed attempts.

### 5. Human review

- **The feel.** A change to how the game plays is tried by a volleyball player
  on its preview. No check can say whether a spike feels right.
- **Decisions**, and **changes to the checks**.

## The checks cannot be loosened by the change they judge

A check is worth nothing if the change it judges can rewrite it.

- **CI runs the architecture rules as they are on the branch a pull request
  goes into**, as well as the pull request's own (`scripts/rules-from-base.mjs`).
  A pull request that loosens the test still has to pass the old one.
- **The known lists only get shorter.** `tests/architecture.known.ts` names
  every breach that still exists. A new entry fails CI, unless the list ends up
  shorter than it was: a refactor that moves a breach nearer to where it ends
  puts entries in and takes more out. Fix new code; do not list it.
- **The files that judge every change** are listed in
  [.github/CODEOWNERS](../.github/CODEOWNERS). A change to one of them is its
  own pull request and the owner's to approve.
- **A test is never skipped, weakened or deleted to get CI green.**

## What a passing run does not tell you

Say these out loud in a pull request when they apply.

- **The trace comparison proves what the autopilots play.** A change they never
  reach passes. It does not cover the lessons, the menus, touch input, effects
  or sound.
- **The end-to-end run checks that things work, not that they are unchanged.**
- **A property test proves its property**, on the inputs it generates. A fact
  nobody stated is not tested.
- **Passing tests do not prove a change to what the player sees.** Drive the
  app.

## Rules with no check yet

These live in prose only, so they are the ones most likely to be broken.

| Rule | Where it should go |
|---|---|
| Every tunable number lives in `src/config.ts` | A lint ratchet, once the 900 or so inline numbers are sorted into tunables and plain arithmetic |
| All input goes through `Input` | A list of the files that may listen for keys, pointer or touch |
| A changed mechanic comes with a test that states the real-court fact | Review, helped by the "test first" rule |
| The lessons play as they did | The trace, once an autopilot can play a lesson |

When one of these gets a check, move it up this page.
