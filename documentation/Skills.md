# Skills In RavenADK
RavenADK skills are designed to follow the [Agent Skills standard](https://agentskills.io/home) and can be used by agents such as ReAct.

Skills are the reusable instructions, scripts, and references your RavenADK agent can discover and apply while solving tasks.

## What You Get
- Dynamic skill creation support: agents can learn and persist new skills while interacting with users.
- Dynamic tools creation support as the scripts in `scripts` folder of the specific skill
- Skill grouping with wards: organize skills in nested folders (sub-wards) for clean discoverability.
- Pluggable storage: use local disk, MongoDB, or your own store implementation.

If you want skills to be fixed and not learned at runtime, set `dynamicSkillCreation: false` in your skills config.

## Skill Structure (Recommended)
Use a folder per skill, with `SKILL.md` as the source of truth.

```text
my-skill/
    SKILL.md
    scripts/
    references/
    assets/
    evals/
        evals.json
        files/
```

- `SKILL.md`: skill instructions and metadata.
- `scripts/`: helper scripts used by the skill.
- `references/`: supporting technical/reference material.
- `assets/`: images, templates, data files, etc.
- `evals/evals.json`: test cases used to evaluate skill quality.

## Storage Contract
All skill stores should follow [`SchemaSkillStore`](./src/agent/skills/stores/schema.ts).

### Required Store Behavior
- `discoverSkillFolder(fromLocation?)`: returns child folders/files for a location.
- `readSkillMeta(fromLocation?)`: returns only metadata/frontmatter from `SKILL.md` for fast routing.
- `readSkillFull(fromLocation?)`: returns the full `SKILL.md` content.
- `createSkillFile(skillFile, inLocation?)`: creates a new skill-related file (`skill`, `script`, `reference`, `documentation`, `assets`).
- `reloacateSkill(fromLocation, toLocation)`: relocates an existing skill folder, ward, or file subtree.

`config.session` is a scope prefix. When present, it is always applied before `root` and `fromLocation` resolution.

`config.dynamicSkillCreation` controls runtime writes. When set to `false`, runtime skill creation should be blocked by stores.

### Built-In Stores
- Local disk store: [`SkillDiskStore`](./src/agent/skills/stores/diskStore.ts)
- MongoDB store: [`MongoDBSkillStore`](./src/agent/skills/stores/mongodbStore.ts)

You can also build custom stores by implementing [`SchemaSkillStore`](./src/agent/skills/stores/schema.ts).

## Skill Discovery Types
RavenADK supports these entry types when discovering skill structure:

- Folder types: `skill-ward`, `skill`, `scripts`, `references`, `assets`
- File types: `skill`, `script`, `reference`, `documentation`, `assets`

This allows agents to quickly identify where the real skill definition lives (`SKILL.md`) and where supporting artifacts are stored.

## Manual Skill Maintenance APIs
Use these APIs when you want direct control over skill content in storage:

- `createSkillFile(skillFile, inLocation?)`
    - `skillFile.fileName`: target file name.
    - `skillFile.type`: one of `skill`, `script`, `reference`, `documentation`, `assets`.
    - `skillFile.content`: file body to store.
    - `inLocation`: optional folder override. When omitted, `skillFile.location` is used.
- `reloacateSkill(fromLocation, toLocation)`
    - Moves the skill node at `fromLocation` under `toLocation`.
    - Implementations should prevent destructive overwrites and return `false` on collisions.

## Evaluating Skill Quality (Recommended Workflow)
To validate that a skill is truly useful (and not only good on one prompt), use eval-driven iteration based on [Evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills).

### 1. Define Test Cases
Create `evals/evals.json` in the skill directory with:
- realistic prompt
- expected output
- optional files
- assertions (after first run)

### 2. Run With And Without Skill
For each eval case, run twice:
- with the skill
- without the skill (or with previous skill snapshot)

Store outputs separately so results are comparable.

### 3. Grade Assertions
Save structured grading results (for example, `grading.json`) with explicit evidence for each pass/fail assertion.

### 4. Track Cost And Speed
Capture timing and token usage (for example, `timing.json`) and aggregate all evals into a benchmark summary.

### 5. Iterate
Use failed assertions + human review feedback to improve `SKILL.md`, rerun evals in a new iteration folder, and repeat until quality stabilizes.

## Practical Tips
- Keep skills focused: fewer, clear instructions outperform long rule lists.
- Write assertions that are objective and verifiable.
- Keep skill metadata in frontmatter so `readSkillMeta` can route quickly.
- Store reusable logic in `scripts/` when repeated work appears in transcripts.
