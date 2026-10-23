---
name: board-reports
description: Triage OverBoard's "Board not working?" reports (GitHub issues labeled board-report) - read them all, group by board, diagnose from the touch data, comment, fix in a PR with "Fixes #N", and close unfixable ones as not planned. Use when the owner says "check the board reports", "any new reports?", or runs /board-reports.
---

# Board reports: the weekly check-in

Teachers send reports from `app/report/` (Settings & help ▸ Board not working?). Each one becomes a GitHub issue labeled
`board-report`, opened by `tools/report-relay.gs`. The owner is a teacher, not a developer: explain findings in plain
words, and ask before anything that can't be undone.

**What closing an issue does (read this before closing anything):** once a day the Google script emails every teacher
who left an address and whose report was closed **as completed**: a "what changed" paragraph that Claude Haiku writes
from the owner's and collaborators' comments on the issue and the titles of their PRs that mention it, plus fixed
reload instructions. Closed **as not planned** sends nothing. So never close a report as completed unless a fix for it
is merged (or about to be), and never close one by accident.

## 1. Gather

```bash
gh issue list --label board-report --state open --limit 200 --json number,title,createdAt,comments
```

Each issue body has a summary table and the full report as JSON in a ```` ```json ```` block (raw events may be trimmed
to fit; the reports inbox email has the complete file). To read the data, parse the JSON rather than eyeballing it:

```bash
gh issue view N --json body -q .body | python3 -c "import sys,re,json; b=sys.stdin.read(); m=re.search(r'\`\`\`json\n(.*?)\n\`\`\`', b, re.S); r=json.loads(m.group(1)); print(json.dumps({k: r.get(k) for k in ('answers','system','release','overlayVersion','from')}, indent=1)); [print(s['id'], 'skipped' if s['skipped'] else s['seen']) for s in r['steps']]"
```

Also look at closed issues from the last couple of months for the same board, in case it's a repeat of something
already fixed (then the teacher probably has an old version: see 4).

## 2. Read the touch data

Per step (`finger`, `pen`, `palm`, `eraser`, `two`), `seen` holds what the browser reported, whatever it was:

| Field | Meaning |
|---|---|
| `types` | `pointerType` counts: `pen`, `mouse`, `touch` |
| `kinds` | what OverBoard's `pointerKind()` (`shared/ink-core.js`) made of it: `pen`, `palm`, `finger` |
| `buttons`, `eraserButton` | `buttons` values seen; `eraserButton` counts `buttons & 32` (SMART's palm/eraser signal) |
| `maxWidth`, `maxHeight`, `maxPressure` | contact size and pressure; 1×1 means the board doesn't report size |
| `lines` / `taps` | strokes that moved more than 30 px / didn't |
| `wheel`, `ctrlWheel`, `contextMenu`, `gestures` | the input became scrolling, zooming, a right-click or a pinch instead of drawing |
| `touchEvents`, `maxTouches`, `maxAtOnce` | real touch events and how many fingers at once |
| `outsidePad`, `buttonPresses` | touches outside the drawing area; what Next/Skip was pressed with (not the step's input) |
| `skipped` / `visited` | the teacher said they don't have that tool / never reached the step |

The **known-good reference** is the SMART Board on macOS (docs/ARCHITECTURE.md, "Input"): pen tip → `pen`, `buttons: 1`;
palm/fist → `pen` with `buttons: 32`; finger → `mouse`; contact size always 1×1. `pointerKind()` is built on exactly
that. A report fits one of these patterns:

- **Classified wrong:** the data is distinct per tool but `kinds` is wrong (e.g. palm arrives as `touch` with a
  40×40 size and becomes `finger`). Fixable: extend `pointerKind()`. Windows touch screens report real sizes, which is
  what the roadmap's "Generic touch mode" item is about.
- **Indistinguishable:** two tools arrive identically (pen and finger both `mouse`, same size). OverBoard can't tell
  them apart in the browser. Say so; maybe a toolbar setting is the answer. Ask the owner before designing one.
- **Swallowed:** a step shows `wheel`/`gestures`/`contextMenu` but no `lines`: the browser or driver turned it into
  scrolling or zooming. Look at `touch-action` and the event handling.
- **Nothing at all:** no events. Often the board's own ink software is on top, or its driver isn't installed (README,
  "Smartboard tips"). Usually a question for the teacher, not a code fix.
- **Old version:** `release` or `overlayVersion` is older than a fix that already shipped. The teacher needs to reload,
  or remake an HTML board copy. No code change.

Also use `device` (`userAgent`, `uaData.platform`/`model`, `maxTouchPoints`, `pointer`) and the teacher's `answers`
(brand, model, the problems they ticked). Their private comments are only in the reports inbox: if one would help, ask
the owner to paste it.

## 3. Report to the owner first

Before changing code, give the owner a short summary: how many reports, grouped by board and pattern, what each group
needs (fix, question for the teacher, nothing), and which ones look like spam or tests. Wait for a go-ahead on fixes.

## 4. Act on each group

- **Comment on every issue you looked at**, in plain words: what the board sent, what that means, and what happens
  next. Haiku reads these comments to write the teacher's email, so keep the one that describes a fix plain and true
  ("Wiping with your palm on Promethean boards now erases instead of drawing."), with no code, file names or promises.
- **Fixes:** follow CLAUDE.md as for any change. The PDF app and the overlay stay the same, new words go in
  `shared/strings.js` in all 8 languages, the version goes up, `python3 tools/build.py`, add a test that replays the
  reported events, and let CI run the suite. Put `Fixes #12, fixes #15` in the PR body so merging closes them as
  completed, and the follow-up emails go out the next day.
- **Old version:** comment that the fix is already out, then close as completed (the follow-up email has the reload
  steps).
- **A question for the teacher:** draft a short, friendly email for the owner to send from the reports inbox (Reply to
  the report email, so it reaches the teacher). Leave the issue open.
- **Spam, tests, or won't fix:** say why in a comment, then close as not planned, so no email goes out:
  `gh issue close N --reason "not planned"`.
- **Duplicates of an open report:** comment "Same as #N", and leave it open so it gets closed by the same fix and that
  teacher gets the email too.

## 5. Finish

Tell the owner, in a few lines: what was fixed (PR link), which teachers will get an email once it merges, which emails
are waiting for them to send, and what's still open and why.
