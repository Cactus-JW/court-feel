# Config is one folder, with a file for each owner, behind one index

Every tunable number was in one file, `src/config.ts`: 3,176 lines, every
layer's numbers in the order they arrived, and nothing to say whose a number
was. Config is now the folder `src/config/`. It has one file for each owner of
the numbers (the court, the ball, the input, the body, the skills, the brains,
the drills, the display, the venues, the app) and an index that re-exports them
all, lowest first. Everything outside the folder imports the index
(`'../config'`), so there is still one place to tune the feel, and a number can
move to another file with no importer changing. The owner of a number is the
file it is in. That is what lets a test say who may read it
(`tests/architecture.config.test.ts`): physics reads the court and the ball,
and the simulation nothing of the display's or the app's.

## Considered options

- **One file, sorted by owner.** It is what record 0012 says in so many words,
  and it needs no index. Turned down because the owner would be a banner
  comment, which no check can read, and because the one file every feature
  edits would keep growing: a reader adding one number reads all of it, and the
  next regrouping moves most of its lines again.
- **A file for each section** (`TIMING`, `CONTACT`, `SERVE` and some thirty
  more). Turned down because a section is not an owner: "who may read this"
  would need a second list saying which thirty files are whose. An owner's
  file is split when it has grown too large to read (the skills, by skill),
  behind the same index.
- **A file beside each drill.** Record 0012 turned this down and it stands.
  The drills' numbers are one file, `drills.ts`: the feel is tuned across
  drills, and they share numbers (`COACH_TOSS`, `RUN_UP_GO`).
- **A split by what a level may touch**: what never changes, what a difficulty
  may override, what is shown. Turned down because that line is not settled:
  which numbers a level changes is still being decided number by number, and
  "what a level may override" would be most of config in one file. What it was
  for is kept: a file comes after the files it reads, so a file of levels can
  sit after the owners it overrides, and its imports say which those are.
- **Importing each owner's file directly**, with no index. The layer table
  could then say who reads what with no test of its own. Turned down because a
  number could not change file without every importer changing, and every
  import line in the game would have been rewritten to get there.

## Consequences

- Record 0012 names `src/config.ts`. Read it as this folder: its "one place to
  tune" and its "sorted by who owns each number" are what this record builds.
- A new number goes in its owner's file. A new file gets a line in the index,
  after the files it reads, and, if it is the display's or the app's, a line
  in the gate's list (`CONFIG_SHOWN` in `scripts/brings-a-check.rule.mjs`),
  which is also the list of what the simulation may not read.
- Three files of the simulation still read a display or app number. They are
  listed by name in `tests/architecture.known.ts`, and the list only gets
  shorter.
- `drills.ts` is not split by drill without a new record.
