# Code conventions

**Date:** 2026-10-24

Conventions for keeping the Selective Publisher codebase consistent, adapted from the conventions of Vidlu (`vidlu/docs/conventions.md`) and irap-tools. The patterns below already exist in the code, and this document makes them explicit.

See [`../AGENTS.md`](../AGENTS.md) for the Obsidian plugin guidelines and the broader coding guidelines that apply across projects.

---

## 1. Naming

### 1.1 General

- `PascalCase` for classes, interfaces, types, and enums.
- `camelCase` for functions, methods, variables, and properties.
- `UPPER_SNAKE_CASE` for module-level constants (`DEFAULT_SETTINGS`, `MAX_LCS_CELLS`).
- `kebab-case` for file names (`diff-parser.ts`, `publish-preview-modal.ts`).
- `private` for members that are not used outside their class.

Names used outside a small local scope should be specific: `getFileDiff`, not `getDiff`.

A boolean that describes a state should read as an affirmative statement (`hasUncommittedChanges`, `isClickable`), not a bare adjective or a question. A property completes the sentence begun by its owner (`pattern.isMatched`), so its name does not repeat the owner. A variable has no owner, so its name starts with its own subject (`lineIsInCodeBlock`).

A boolean option or parameter that tells a function what to do is named as a command (`skipPreview`, `hideBadge`). A function with more than one boolean parameter takes an options object, so that call sites name each flag: `publishNotes({ commitOnly: true })`.

Name counts with either the `num` prefix or the `Count` suffix: `numFiles` or `fileCount`. Use one form consistently within a module.

Prefix every CSS class with `sp-` (`sp-publish-diff`) and mark state with an `is-` class (`is-added`, `is-clickable`).

### 1.2 Function naming by role

Use an **imperative verb phrase**, with exceptions:

- **Predicates** are phrased as affirmative statements: `isClickable`, `hasUncommittedChanges`.
- **Factories and constructors** can be named after what they produce.
- **Event handlers** are named with the `on` prefix followed by the event name (a noun with a past participle).

**Accessors**: prefer a getter (`get value()`) whenever the value is cheap, deterministic, and free of side effects. Otherwise use `get`, or name the work, for example `fetch` for I/O.

| Prefix | Role | Example |
|---|---|---|
| `parse` | Convert text to a structure | `parseDiff` |
| `render` | Build DOM elements | `renderDiff` |
| `get` | Accessor, possibly with arguments | `getFileDiff` |
| `resolve` | Map an identifier to a path or object | `resolveRepoPath` |
| `toggle` / `set` / `update` | Mutator | `toggleDiff` |

A method that doesn't read `this` should be a module-level function, or a `static` method of a helper class such as `GitHelper`, instead of an instance method.

### 1.3 Common type suffixes

Reuse established suffixes before inventing new ones:

| Suffix | Role |
|---|---|
| `*Service` | Class that implements a feature and does not depend on UI (`PublishingService`) |
| `*Helper` | Static wrapper around an external tool (`GitHelper`) |
| `*Modal` | Subclass of Obsidian `Modal` |
| `*Criterion` | Rule that decides whether a note is published (`TagCriterion`) |
| `*MatchMode` | Enum of the ways a criterion matches (`TextMatchMode`) |

---

## 2. Formatting

- Indent with four spaces and use single quotes.
- Do not end statements with semicolons.
- Prefer `async` / `await` over promise chains. Mark a deliberately unawaited promise with `void`.

---

## 3. Source layout

Source files are in `src/`, one clear purpose per file, and one modal per `*-modal.ts` file.

Layers import only downward: UI modules (modals, views) import services, and services import helpers and parsers. Modules that parse or compute, such as `diff-parser.ts`, do not import `obsidian` or touch the DOM.

---

## 4. User interface text

- Use sentence case for headings, buttons, commands, and tooltips: "Open file", "Show changes".
- Take colors, spacing, and fonts from Obsidian CSS variables (`--text-muted`, `--background-modifier-border`), so that the plugin follows the theme. Do not hard-code colors.

---

## 5. Documentation and prose

### 5.1 Writing style

This section applies to all prose in the repository: doc comments, comments, markdown documents, the README, UI text, and commit messages.

**Punctuation and casing.**

- Always use the spaced en-dash (` – `) – never use the em-dash (`—` / ` — `), and never a double hyphen (`--`) standing in for either.
- Avoid semicolons. Use a comma, a full stop, or an en-dash, whichever the sense calls for.
- Use sentence case for all titles and headings (for example, "How it works", "Publish preview"), capitalising only the first word and proper nouns.

**Content and phrasing.**

- Convey meaning as efficiently as possible: give the essential information, and avoid verbosity, conversational filler, restating what the code plainly says, and redundancy with respect to other documentation.
- Avoid loose abbreviations in prose: "implementation", not "impl", and "configuration", not "config", as a noun.
- Use ISO 24495-1:2023 Plain language or ASD-STE100 Simplified Technical English (STE) where it does not detract from meaning. Consider also the Diátaxis framework for structuring information.
- **Single source of truth applies to comments too.** Document a rule once, at the type or function that owns it, and reference it elsewhere. At a call site, keep only what is local to that site – why *this* caller does what it does.
- Prefer plain, accurate language over metaphor and jargon. Use verbs that describe the actual operation (e.g. a file is copied, an event fires).
- **Name a thing with a noun.** For an operation referred to *as a thing*, use the noun or gerund English already provides, not the bare verb stem: "forward pass" (not "at forward"), "encoding" (not "the encode"). Established zero-derived nouns (a build, a call, a step) are exempt.
- Prefer a simple negation to an absolute or temporal adverb: "does not crop", not "never crops". Use temporal adverbs ("always", "never") only for temporal invariants the code enforces.
- **Describe current behaviour only.** After a rename or behaviour change, update affected comments in the same edit. Record historical context, such as what an earlier version did, in commit messages or development notes, not in code comments.

Where this section is silent, follow the [Google developer documentation style guide](https://developers.google.com/style) and the [Obsidian style guide](https://help.obsidian.md/style-guide).

### 5.2 Code documentation

- Use TSDoc comments (`/** ... */`) for exported classes and for functions whose behaviour isn't obvious from the signature. Skip self-documenting members. Do not repeat types that the signature already states.
- Write the first sentence of a doc comment as a description, not an imperative statement: "Returns the diff between the published copy and the vault version.", not "Return the diff".
- Document non-obvious contracts: units, value ranges, and the meaning of absent values (for example, a line number that is absent for added lines).
- Prefer a more descriptive identifier over an inline comment. Add a comment only for rationale a name cannot carry, and explain *why*, not *what*.
- Write inline comments as descriptive clauses or noun phrases, not as imperatives ("Falls back to the first branch", not "Fall back to the first branch"), without a trailing full stop.

### 5.3 Commit messages

Write the subject in the **imperative mood**, as [git-commit](https://git-scm.com/docs/git-commit#_discussion) asks, completing *"if applied, this commit will..."* (`Add`, `Move`, `Fix`, `Upgrade`, `Split`, `Remove`, `Refactor`), not *"if the commit is applied, the code will..."*.

**The verb names what the commit does to the codebase, not what the software does afterwards:** `Add an inline diff of modified files to the publish preview`, not `Show diffs of modified files in the publish preview`.

- One line, capitalised, no trailing period, and no type prefix such as `feat:` / `fix:`.
- A full descriptive clause rather than a terse label: `Make the criterion editor modal more compact`, not `Modal fixes`.
- Add a body separated by a blank line for non-trivial changes, explaining what changed and why. Each paragraph is written on one line without hard-wrapping.
- Bump the version in its own commit, and update `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` together.
