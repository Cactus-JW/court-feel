# Court Feel

A 3D volleyball feel sandbox that runs in the browser: TypeScript, Vite and three.js, client-only, no backend. Every change is judged against one principle, **true to the court**: would someone who has played on a real court recognise it? Fun but wrong is a bug. [README.md](README.md#the-principle) explains the principle. This file is the working guide for everyone who changes the code, coding agents and people alike.

## Commands

```bash
source ~/.nvm/nvm.sh && nvm use   # Node 22 (.nvmrc). The default shell may be on another version.
npm ci                            # when node_modules is missing or package-lock.json changed
npm run dev                       # http://localhost:5173
npm run check                     # typecheck, lint, format check, unit tests. Run before every commit.
npm test                          # unit tests only (Vitest, tests/)
npm run format                    # fix formatting with Prettier
npm run e2e                       # every drill in headless Chromium, several minutes, writes scripts/out/
npm run trace                     # plays every drill twice and compares every frame: the same start gives the same play. CI runs it on every pull request.
npm run trace:compare             # a refactor only: plays every drill here and on main and compares every frame, the play and what is drawn
```

Run `npm run e2e` when a change touches a drill, the autopilots, input, touch controls or the menus. First time: `npx playwright install chromium`.

Run `npm run trace:compare` for a `refactor`: it must print `same play`. A `feat` or a `fix` that changes the play will differ, and that is expected. CI plays every pull request twice with `npm run trace`, which must print `repeatable`: run it when a change touches the simulation, a drill or what is drawn.

## Show it working in the app

Passing tests do not prove a change to the game, its menus, HUD or controls. Drive the real app and capture evidence with the verification skill: read [.agents/skills/verify-court-feel/SKILL.md](.agents/skills/verify-court-feel/SKILL.md), then the feature map in its `features/` directory. When a change adds or alters user-facing behaviour, update the matching feature file in the same pull request.

## Rules the tools do not enforce

- **Every tunable number lives in `src/config.ts`**, in its section, with a doc comment when the name does not say what it is. No magic numbers in game code, so the feel can be tuned in one place. The numbers the simulation still holds of its own are counted for each file in `tests/architecture.numbers.json`, and the count only goes down: a new one fails `npm test`.
- **`src/physics/` stays pure**: no three.js scene, no DOM, only `config`. That keeps it deterministic and testable.
- **Every import points down** ([docs/adr/0010](docs/adr/0010-the-simulation-runs-on-its-own.md)): `config`, then `core` and `physics`, then the simulation (`game`, `ai`, the drills in `game/modes`), then everything a player sees or hears, then `main.ts`. `tests/architecture.test.ts` enforces it, and ESLint flags a bad import as you type. No two files import each other in a circle. What still breaks it is listed in `tests/architecture.known.ts`: fix new code, do not add it to the list.
- **The simulation has no clock and no dice of its own**: no `Math.random`, `Date.now` or `performance.now` in `physics`, `game`, `ai` or the drills. Time is `simTime` and chance is the simulation's seeded `rng`, so the same start gives the same play.
- **All input goes through `Input`** (`src/core/input.ts`). Keys, mouse, touch and the autopilots share that path, so timing windows are identical everywhere. Do not add a side door.
- **Assist may help the player's body, never the ball**, and it must be fully off at 0.
- **A change to physics, timing, contacts or AI decisions comes with a unit test that states the real-court fact**, for example "the middle leaves the floor on the setter's touch".
- **Say where a number comes from** (the rules, a measurement, a video, a coach, your own play) in its doc comment or in the pull request. If you bend reality to make something playable, say so and say why.
- **Effects amplify, they never replace.** They scale with the quality and power of the touch, never hide the ball, and there are no full-screen flashes.
- **Units and frame:** metres, seconds, kilograms, radians (km/h is for display only). Y is up, the net is the plane z = 0, the home team plays on +z facing -z, and facing -z the right hand is +x.

## Before changing a mechanic

The reason a mechanic works the way it does is written down. Read the doc comments on its numbers in `src/config.ts` and on its code, the unit tests that state its real-court facts, and the records in [docs/adr/](docs/adr/README.md). Then check the change against the five rules of [the principle](README.md#the-principle). The pull request template asks one question for each.

When you make a call that someone would otherwise argue about again, write the reason down: in a doc comment next to the code, saying what was turned down, or as a record in `docs/adr/` when no single place in the code can hold it. [docs/adr/README.md](docs/adr/README.md) has the test and the format.

## How to work on a change

Why the checks are arranged as they are, and where a new rule should live, is in [docs/verification.md](docs/verification.md): hold each rule in the cheapest layer that can hold it.

- **Approach before code.** For a change to the simulation (physics, timing, contacts, AI, a drill's rules), say first what the real court does, which tests will state it and which files it touches. Code written to see whether an approach works is thrown away, not tidied up and kept.
- **The test comes first.** Write the test that states the real-court fact and watch it fail. Then write the code that passes it. A test written after the code tends to describe the code.
- **Three failed attempts, then stop.** If a fix has not worked after three tries, stop and say what was tried, what each showed and what you would look at next. A fourth guess costs more than the question.
- **A file that keeps growing is a prompt to look for a boundary**, not a failure. A large file with one job and a clear edge is fine. One that several features have to edit at once is where the next split belongs.

## Docs that move with a change

- README: controls, modes, settings and `config.ts` sections. The start screen's key list (`src/ui/menu.ts`) and the in-game hints say the same things, so keep them in step.
- The pull request: for a change to the feel, say what was reported, the cause, the fix and how it was measured. That write-up lives in the pull request, not in a file.
- `docs/screenshots/`: real frames only. Retake a shot when the moment it shows changes.
- [docs/verification.md](docs/verification.md): when a check is added, moved or removed, or a rule gets a check it did not have.

## Git

- Branch from `main`. One change per pull request. Fill in `.github/pull_request_template.md`.
- Name the branch `<type>/<short-description>`, in lowercase with hyphens: `feat/setter-calls-the-pass`, `fix/crash-screen-input`. If your tool will only push to a branch it named itself (`claude/…`, `cursor/…`), keep that name.
- Commit and pull request titles are Conventional Commits, `type(area): what the player notices`, in plain words: `feat(rally): the setter calls the pass (HIGH! when out of system)`. For `feat`, `fix` and `perf` the description says what the player notices. For the other types it says what changes for the next contributor. Leave the area out when a change has no single one.
  - `feat`: something new the player can do, see, hear or feel.
  - `fix`: something that was wrong and is now right.
  - `perf`: the same behaviour, running faster or smoother.
  - `refactor`: code reshaped, with nothing changed for the player.
  - `test`: unit tests or the end-to-end run only.
  - `docs`: the README, this file, decision records, screenshots.
  - `ci`: the GitHub workflows.
  - `chore`: tooling, dependencies, agent files and other housework.
- Update a branch by rebasing it on `origin/main` and pushing with `--force-with-lease`. If the rebase or the force-push is not possible, merge `main` in and say so in the pull request.
- A pull request is merged once CI is green, it has been reviewed and, for a change to the feel, a volleyball player has tried its Vercel preview.
- GitHub deletes a branch when its pull request is merged. Start the next change on a new branch from `main`.

## Releasing

- Merging to `main` updates the dev site, [court-feel-dev.jackzxq.dev](https://court-feel-dev.jackzxq.dev). The public site, [court-feel.jackzxq.dev](https://court-feel.jackzxq.dev), changes only when a version tag is pushed.
- `vercel.json` tells search engines not to index the dev site. Vercel does that itself for preview URLs, but not for a custom domain assigned to a branch. If the dev domain changes, change it there too.
- To release: bump `version` in `package.json` in a pull request (`npm version <x.y.z> --no-git-tag-version`), merge it, then tag that commit on `main` as `v<x.y.z>` and push the tag. [.github/workflows/release.yml](.github/workflows/release.yml) checks the tag, runs `npm run check` and the build, and fast-forwards the `release` branch, which Vercel deploys to production.
- `release` is moved by that workflow only. To take a bad release back, use Instant Rollback in Vercel, then fix `main` and tag again. After a rollback Vercel holds the next release until someone promotes it.

## Boundaries

- **Always:** run `npm run check` before committing, and verify user-facing changes in the app.
- **Ask first:** anything that changes how the game plays (timing windows, physics constants, controls, AI decisions, a new drill or mechanic), a new dependency, and any art or audio asset. Assets need an MIT-compatible licence and an entry in [CREDITS.md](CREDITS.md).
- **Never:** skip, weaken or delete a test to get CI green, or commit directly to `main` or `release`.
- **The checks are not yours to loosen.** CI also runs the architecture rules as they are on the branch a pull request goes into, and fails when `tests/architecture.known.ts` grows (`scripts/rules-from-base.mjs`). The files that judge every change are listed in [.github/CODEOWNERS](.github/CODEOWNERS): a change to one of them is its own pull request, and the owner's to approve.

## Agent conventions

Keep agent workflow files generic where possible, so every coding agent can use them:

- Project instructions go in this file, not in `CLAUDE.md` or another tool's equivalent.
- Skills go in `.agents/skills/<name>/SKILL.md`. `.claude/skills` is a symlink to that directory so Claude Code registers the same skills. Do not put real files under it.
- If a tool or plugin tells you to write to its own directory (`.claude/`, `.cursor/` and the like), use the generic location and add a symlink only when the tool cannot read it otherwise.
- Helper scripts under `.agents/` are linted and formatted like `scripts/`.
