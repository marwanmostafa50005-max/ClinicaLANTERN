# Review fixes

Wednesday 18 November 2026. Fictional patients only. No real person is in any of this.

Three reviewers read the first build. One looked for findings the app could miss, one compared the
page with the founder's design, and one tried to break it. They reported 36 findings: 1 blocker,
15 serious, 19 minor, and one more that arrived cut off.

This file lists each finding, what was done about it, and the test that covers it. After that
comes the list of what is left open, with the reason. The last part says what was run at the end.

## In short

- All 36 findings were real. None was put aside as "not real".
- 27 are fixed in full: 1 to 12, 17 to 23, 26, 29, 30, 32 to 36.
- 6 are fixed in the part that code can settle, and the rest is left open: 13, 14, 24, 27, 28, 31.
- 3 are left as they are, because only the founder can decide them: 15, 16, 25.
- Finding 36 arrived cut off in the middle of a sentence. What could be read is the same defect as
  finding 6, and the same fix and the same tests cover it.
- No design was changed. `docs/SPEC.md` is now version 2: it writes down what changed, each place
  marked "(v2)".
- No npm package was added.

How to read the tests: `file > group > test`. All of them run with `npm test`. No test calls a
model. What was proved with the real models is under "What was run at the end".

## The findings

### 1. Long history: two supplies in different parts were never read together (blocker)

Real. A stand-in model that reads perfectly what it is shown gave "clear" for a pair of supplies
290 lines apart, and for a pair only 31 lines apart on either side of a part boundary.

What was done:

- In every part of a long history Model 1 now also lists each line that holds a medicine on the
  criterion's list, whether or not the rule is met in that part.
- Then Model 1 reads all the listed lines together in one more call, and that answer is used.
  "No part suspected" alone is never a clear result.
- A criterion is clear only when every part was read and no part listed a line, or when the lines
  read together are clear.
- When a part could not be read, or the listed lines do not fit in one call, the criterion is
  "could not be screened". A finding that one part suspected is always kept.
- The second check gets the same listed lines together in one call, not one part at a time.
- The page says what a long history is, and the status line shows the step.
- A long history is now on the demo answer sheet: `cases/_demo/long-split.csv`, 310 lines, with
  the two medicines 275 lines apart and never in the same part. The join test and the scorer run
  it with the real models.

Tests:

- `pipeline/screen.test.ts > a long history whose two proving lines fall in different parts`
  (3 tests: 290 lines apart, 31 lines apart, and a history with only one of the two medicines)
- `pipeline/screen.test.ts > the end of a long history: the listed lines are read together` (7 tests)
- `pipeline/check.test.ts > checkFinding > checks the listed lines of a long history together, never one part at a time`,
  and the three tests after it
- `server/engine.test.ts > a long history` (4 tests)
- `src/components/panels.test.tsx > the import panel > says what a long history is: read in parts, then the listed lines together`
- With the real models: the last round of `tools/smoke.mjs` (5 checks) and the scorer on the demo sheet.

### 2. A scanned PDF with a line of real text on each page was taken as a text PDF (serious)

Real. A fax header of 40 letters on a page that is one big picture sent the file down the text
route. The scan was never read.

What was done:

- The page now looks at the pictures on every page of a PDF. A page is a scan when pictures cover
  a fifth of it or more, however much text lies over them. A page of text with a small logo stays
  a page of text. When the size of a picture cannot be told, the page counts as a scan.
- If any page is a scan, the whole file goes by the scan route: Model 1 reads the pictures and the
  pharmacist checks the rows.
- A second net on the text route: when a page gave only one or two rows, the page asks for a look.

Tests:

- `src/lib/pdfPictures.test.ts > real PDF files > takes a scan with a fax header of 40 letters or more on each page as a scan, not as text`
  (a hand-made PDF read with the real PDF reader), and the two tests after it
- `src/lib/pdfPictures.test.ts > how much of a page pictures cover` (5 tests) and `> what a page of a PDF is` (4 tests)
- `src/lib/importFile.test.ts > a PDF read as text: the second net` (3 tests)

### 3. A scan page with no rows was dropped without a word, and the check had no page marks (serious)

Real.

What was done:

- The history keeps the number of pages of the scan.
- A page that gave no rows is shown: "Page 2 of 3: no rows were read", with a note to look at its
  picture and not to confirm if it holds supplies.
- The check shows the rows page by page, with the count for each page and the picture of that page.
- The server hands out the page pictures until the rows are confirmed, so the check still works
  after a reload (see also finding 33).
- A row read from a scan must start with a date that can be read, as in a CSV file. Such a row is
  named, and the rows cannot be confirmed until it is corrected. This is not a dead end: the
  pharmacist corrects the row and confirms again, or discards the scan.

Tests:

- `server/engine.test.ts > a scan: nothing is dropped without a word` (4 tests)
- `pipeline/history.test.ts > rows from a PDF or a scan > asks of a row read from a scan what a CSV file asks: a date that can be read, first in the row`
- `src/components/panels.test.tsx > the check of a scan` (2 tests)

### 4. A "no" that names the proving lines was taken as a plain no (serious)

Real. One more thing was found while fixing it. The second model writes the fields of its answer
in alphabetical order, whatever order the form gives. So "confirmed" came before the explanation.
This was measured with the real model.

What was done:

- Both answer forms now ask for the explanation first and the yes or no last. The fields of the
  second check are numbered (`step1_what_matches` to `step4_confirmed`), so the alphabetical order
  and the wanted order are the same.
- Model 1 says "no" but names lines of the history: the criterion goes on to the second check, and
  the record says why.
- Model 2 says "no" but names lines as proof: the finding goes to the bell marked "Second check
  unclear". It is not counted as confirmed.
- What Model 1 wrote for a clear criterion is kept in the state and can be opened on the history card.
- A finding in the grey list (Model 2 did not confirm) now has an "Accept anyway" button. The
  server already allowed it. Finding 27 lists this button as the founder's decision: it is one
  button and can be taken out again.

Tests:

- `pipeline/screen.test.ts > the screen prompt > asks for the explanation first and the yes or no last`
- `pipeline/screen.test.ts > reading the screen answer > does not take a "no" that names the proving lines as a plain no: it goes on to the second check and says so`
- `pipeline/check.test.ts > the answer form of the second check` (7 tests)
- `server/engine.test.ts > a second check that is not a plain yes or no` (2 tests)
- `server/engine.test.ts > a criterion that could not be screened is never "no finding" > keeps what Model 1 wrote for a criterion it called clear`
- `src/components/panels.test.tsx > the words of the models under the bell > marks a finding whose second check is unclear, and one whose check did not finish`,
  and `> lets the pharmacist accept a finding from the grey list`
- The proof was run again with the real models and the new forms: see "What was run at the end".

### 5. When Model 1 could not screen, the page still said "No finding was suspected" (serious)

Real.

What was done:

- The card says "Screened against 0 of 2 criteria. 2 could not be screened." The words "No finding
  was suspected" are written only when every criterion ran.
- A history counts as screened only when no criterion failed.
- A pop-up now also says when a history was not fully screened, when a screening was interrupted,
  and when a history cannot be assessed. The red number on the magnifying glass also counts a
  history that was not fully screened or was interrupted, until it is screened again.
- The first screen shows a note beside the status line: "1 history was not fully screened. This is
  not the same as no finding." The bell panel says the same, with a link.
- New button on the card: "Screen again what has no result". It screens only the criteria with no
  result. Nothing is imported twice.

Tests:

- `src/components/panels.test.tsx > the result line of a history` (4 tests)
- `server/engine.test.ts > a criterion that could not be screened is never "no finding"` (3 tests)
- `server/api.test.ts > the calls added after the review of 18 November > screens again what could not be screened, and refuses when there is nothing to do`
- `src/lib/events.test.ts > newThings > counts a history whose screening has just ended with a criterion that could not be screened`,
  the two tests after it, and `> notFullyScreened`
- `src/components/panels.test.tsx > the words of the models under the bell > says on the bell panel that a history was not fully screened: "no findings waiting" is not the whole story`
- `src/components/panels.test.tsx > the first screen > shows what must not be missed beside the status line, and nothing when all is well`

### 6. One failed write of the state file stranded the work until a restart (serious)

Real, in all three cases the reviewer described.

What was done:

- Saving the state never stops a step any more. When the file cannot be written, the server says so
  in the log, keeps working from memory, and tries again every second. It says when the file can
  be written again.
- A job that waits with no worker is started when the page next asks for the state.
- A step that stops with an error nobody expected is started again by itself, up to two more
  times. After that it ends in a state the pharmacist can see: a second check goes to the bell as
  "not completed", a letter says it could not be drafted, and a screening stays "interrupted" with
  the "Screen again" button.
- The newest problem of the last quarter of an hour is shown on the first screen.

Tests:

- `server/engine.test.ts > one failed write of the state file does not strand the work` (5 tests:
  the three cases A, B and C of the finding, the retry, and the waiting job)
- `server/engine.test.ts > a step that stops with an error nobody expected` (5 tests)
- `src/lib/health.test.ts > the newest problem, for the first screen` (3 tests)

### 7. The scorer gave PASS when neither the bell nor the letter showed a planted line (serious)

Real.

What was done:

- There is now one rule for the lines of a finding (`shared/lines.ts`): the lines the second check
  named, and the lines the first model named. The bell panel, the letter, the scorer, the join test
  and the page walk all use it.
- In the bell panel a line that only the first model named is marked "Named by the first model only".
- The scorer judges the planted lines against the lines the app shows and prints. "The letter
  shows none of the planted lines" is now a reason for FAIL.

Tests:

- `shared/lines.test.ts` (5 tests)
- `eval/score.test.ts > the pass rule, one case at a time > fails when the letter shows none of the planted lines`,
  and `> judges the planted lines against the lines the app shows: those of Model 2 and those of Model 1, in history order`
- `pipeline/letter.test.ts > what a letter is built from > cites the lines of the second check and keeps the lines of the first model as well`,
  and `> still prints the proving lines when the second model named other lines`
- `src/components/panels.test.tsx > the lines of a finding under the bell` (2 tests)

### 8. The scorer counted a letter and no failed call when Model 3 failed twice (minor)

Real.

What was done:

- A letter draft now says plainly why it was built from the template: the drafts failed their
  checks, the model did not answer, or the step failed.
- The scorer lists "Model 3 did not answer" under the calls that could not be completed, and the
  criterion does not pass.

Tests:

- `eval/score.test.ts > the pass rule, one case at a time > does not pass, and counts a failed call, when the letter is the template because Model 3 did not answer`
- `pipeline/letter.test.ts > draftLetter > falls back to the template when the model does not answer, and says that, not that a draft failed its checks`

### 9. A criterion file with its medicine list in the wrong shape loaded without complaint (minor)

Real.

What was done:

- A criterion file is refused when its medicine groups are not a list, when a group has the wrong
  shape, when "ingredients" or "brands" have the wrong shape, or when a group names no medicine.
  The message names the criterion and the group.

Tests:

- `pipeline/criteria.test.ts > a criterion file with a slip in its medicine list` (6 tests; the
  last one loads every criterion file of the repository)

### 10. The judges' recorded-run view was not built (serious)

Real.

What was done:

- `npm run build:replay` builds the judges' view into `dist-replay/`. It never talks to a server.
- It plays `cases/_demo/recorded-state.json`, the saved state of a real run on this PC, step by
  step. Each step is one line of the activity log of that run. `npm run record` writes the file
  from a running server after a real run. Nothing in it is changed or added by hand.
- The words "Recorded run from the entrant's computer. The live models are not connected." are at
  the top of the first screen and in the head of every panel. The bar under the slogan also says
  that the steps of the pharmacist were made by the join test script, not by a person.
- An import, and every button that would change something, answers with one plain sentence.
- The build of the live page holds nothing of the recording, and the judges' build holds nothing of
  the sample data and no call to a server. This was checked on the built files.

Tests:

- `src/replay/replay.test.ts` (10 tests; the last two play the recording that ships with the
  repository and check that nothing can be changed and no server is called)
- `src/components/panels.test.tsx > a view that is not a live run > says so in the head of every panel, not only on the first screen`
- Checked by hand in a browser: the built view plays by itself, reaches step 26 of 26, and makes
  no request to `/api`.

### 11. In the sample view the panels, the letter and the printout did not say "sample" (serious)

Real.

What was done:

- "Sample data. The models are not connected." is now in the head of every panel as well.
- The sample letters end with "Sample letter. It was written by hand for the mock-up of the page.
  No model drafted it." The trail says "Sample letter, written by hand for the mock-up", not
  "Drafted by Model 3".
- The printout of a sample letter carries the mark "SAMPLE DATA. This letter was written by hand
  for a mock-up. No model wrote it."
- The sample status line starts with "Sample of the status line:".
- The ten `mock-*` pictures in `docs/screens/` were taken again after the change, and one was
  added: an open letter at phone width.

Tests:

- `src/components/panels.test.tsx > a view that is not a live run` (2 tests)
- `src/mock/server.test.ts > what the pharmacist does > no sample letter says that a model drafted it, and each is laid out like a real letter`

### 12. The check that a letter never tells the doctor what to do let most instructions through (serious)

Real. Of 20 sentences that instruct the doctor, 15 passed the old check.

What was done:

- A sentence of the model's paragraphs is now a problem when it starts with an action word (stop,
  cease, start, switch, change, reduce, increase, prescribe, withhold, arrange, do not), or holds
  must, should, needs to, is to be, requires, recommend, advise or suggest. A question is allowed.
- The path is unchanged: the letter is drafted once more with the problem named, then the template.

Tests:

- `pipeline/facts.test.ts > checkLetterTone > catches an instruction to the doctor` (20 sentences)
- `pipeline/facts.test.ts > checkLetterTone > lets a question or a plain statement through` (12 sentences)
- `pipeline/facts.test.ts > checkLetterTone > catches the two-sentence instruction that was once logged as "the letter checks found nothing"`
- `pipeline/letter.test.ts > draftLetter > sends back a draft that tells the doctor what to do`

### 13. Model 2's own words and line choices were shown as fact (serious)

Real. Fixed, except one question that is the founder's.

What was done:

- What Model 2 may write under "what matches" is limited to 700 characters, and "what cannot be
  seen" to 500. The model server keeps to the limit. A text that reached the limit is cut back to
  its last whole sentence, and the page says that more was written.
- The bell panel heads the list "Lines the models pointed to" and says "The models chose these
  lines. Check them against the criterion."
- The model's text is headed "What Model 2 wrote in the second check", with the line "These are
  the model's own words, not a checked fact."
- Under "What a dispensing history cannot show" the criterion's own words come first. What Model 2
  wrote comes after them, marked "Model 2 added:".
- The rule the models were given is shown under the criterion: "What the models were asked to look for:".

Left open: whether code may check the dates of the lines the models cite. See the list at the end.

Tests:

- `pipeline/check.test.ts > the answer form of the second check > limits how much the model may write under "what matches"`,
  and `> cuts a long working-out back to whole sentences and says that more was written`
- `pipeline/ollama.test.ts > chat > sends the limit on a text field to the model server, which keeps the text to it`
- `pipeline/history.test.ts > a long history read together, and a text a model wrote > cuts a text that reached its limit back to a whole sentence, and says that more was written`
- `src/components/panels.test.tsx > the words of the models under the bell > puts the criterion's own words first for what cannot be seen, and what Model 2 added after them`

### 14. The internal working phrase was in a file that would be committed (serious)

Real. The phrase is in `docs/FOUNDER_DESIGN.md`, the founder's own words, and nowhere else.
Keeping it out of what a judge sees is the coordinator's advice, not a ruling of the founder: he
has not ruled on it, and item 1 of the "Left open" list is his to decide.

What was done:

- `docs/FOUNDER_DESIGN.md` is now named in `.gitignore`. The file is untouched and stays on this
  PC, but it will not go into a commit. This is the careful choice until the founder decides, and
  it is undone by taking one line out of `.gitignore`.
- A test reads every text file that git would commit and fails if one holds the phrase. To learn
  which files those are it asks git for the list. That call only reads and changes nothing. On a
  copy with no git the test is skipped, because nothing can be committed from such a copy.

Left open: the founder's decision. See the list at the end.

Tests:

- `shared/judges-wording.test.ts > what a judge can see` (3 tests)

### 15. Every letter says "reviewed and edited by the pharmacist" from the moment it is drafted (minor)

Real. Not changed. `docs/SPEC.md` section 7 gives this last line word for word, so changing it is
a change of the design. See the list at the end.

### 16. The red number on the bell goes after one look (minor)

Real. Not changed. The finding itself says that the founder decides. See the list at the end.

### 17. "Overdue by N days" was one day too many (minor)

Real. Three days and five minutes counted as four days.

What was done:

- The page counts whole days that have passed. A letter that is past its time counts at least one day.

Tests:

- `src/lib/format.test.ts > words and numbers > counts whole days that have passed, and tolerates missing times`
- `src/lib/letters.test.ts > overdue > counts at least one day once the due time has passed`

### 18. A finding whose second check did not finish was counted and announced as "confirmed" (minor)

Real.

What was done:

- "Findings confirmed" counts only a second check that was completed and answered yes.
- The pop-up for the other cases says: "A finding is waiting under the bell. The second check did
  not give a clear yes."

Tests:

- `src/lib/events.test.ts > newThings > does not call a finding "confirmed" when the second check did not finish, or is unclear`
- `src/lib/events.test.ts > pop-ups > never says "confirmed" for a finding Model 2 did not confirm`
- `server/engine.test.ts > a second check that is not a plain yes or no > a "no" that names the proving lines still reaches the bell, marked unclear, and is not counted as confirmed`

### 19. Three sentences on the page were not true as written (minor)

Real.

What was done:

- "A scan or a photo of a printed history (PDF, PNG or JPEG) can be tried: Model 1 reads the rows
  and you check every row." It no longer says "also works".
- "This can take one to three minutes for each page." It no longer says "about a minute".
- "Subject (used for the email)". It no longer says "and for this list".

Tests:

- `src/components/panels.test.tsx > the import panel > says only what is true about scans, and explains the bars and the line numbers`
  covers the first two sentences.
- The third sentence has no unit test: an open letter cannot be drawn without a browser. It is in
  the pictures `docs/screens/live-walk-07-letter-ready-1366x768.png` and `mock-letter-open-390x844.png`.

### 20. A pop-up that arrived while its own panel was open covered the "Fictional patient" tag (minor)

Real.

What was done:

- No pop-up is raised about the panel that is open.
- A pop-up about another panel now sits under the head of the open panel on a wide screen, so the
  tag and the note beside it stay in view. Measured at 1366 by 768: the pop-up starts at 72 px and
  the head ends at 66 px.
- The pictures were taken again.

Tests:

- `src/lib/events.test.ts > pop-ups > raises no pop-up about the panel that is open: it would cover the top of that panel`
- The place of the pop-up is a style rule. It was measured in a browser, not unit tested.

### 21. Keyboard: Escape stopped working after the bypass form was closed or after "Save changes" (minor)

Real.

What was done:

- The panel listens for Escape on the whole page while it is open. A form inside the panel that
  uses the key itself is closed first.
- When the bypass form closes, the focus goes back to the Bypass button. After "Save changes" it
  goes to the letter text.

Tests:

- `src/components/panels.test.tsx > the keyboard > Escape goes back to the main page, unless a form inside the panel has already used the key`
- Checked with real key presses in a browser: Escape closes the bypass form and the focus is on
  Bypass; the next Escape closes the panel.

### 22. Phone width: the head of an open letter was squeezed, and at 320 px the third icon was cut off (minor)

Real.

What was done:

- On a narrow screen the words in the head of an open letter have a full row of their own.
- Under 360 px the three icons shrink, so all three fit at 320 px.

Tests:

- These are style rules. They were measured in a browser at 390 and 320 px, not unit tested.
  Picture: `docs/screens/mock-letter-open-390x844.png`. The page walk also checks that nothing
  scrolls sideways at 390 by 844.

### 23. In the real demo Accept and Bypass were below the first screen of the bell panel (minor)

Real.

What was done:

- The row with Accept and Bypass stays at the bottom edge of the bell panel while the evidence
  above it is read. With the six lines of the demo finding both buttons are in the first screen.

Tests:

- A style rule, measured in a browser at 1366 by 768 and at 390 by 844: the row ends exactly at the
  bottom edge of the panel. Picture: `docs/screens/live-walk-04-bell-panel-1366x768.png`.

### 24. First screen: the brand was a quarter of the screen, and there is more than "only 3 icons" (minor)

Real. The first part is fixed. The second part is three questions for the founder.

What was done:

- The mark, the name and the two lines under it now grow with the height of the band. Measured in
  a browser, the brand block is 29% of the screen at 1366 by 768 (was 25%), 28% at 1920 by 1080
  (was 18%) and 17% on an upright tablet (was 11.5%).

Left open: whether the activity log, the "Start a clean demo" link and the number on the
magnifying glass may stay. See the list at the end.

Tests:

- Style rules, measured in a browser. Not unit tested.

### 25. "Open in my email program" is not "straight to the doctor" (minor)

Real. Not changed. The page is honest about it ("Nothing is sent by this app"). Putting the letter
into the email, or keeping a doctor's address, is the founder's decision. See the list at the end.

### 26. A scan the pharmacist does not confirm could never be removed (minor)

Real.

What was done:

- New button "Discard this scan" on the check of a scan. The history stays in the list, marked
  "The pharmacist discarded this scan. Its rows were not confirmed, so it was not screened." The
  log keeps the step. The red number on the magnifying glass clears, and the page pictures are removed.

Tests:

- `server/engine.test.ts > a scan: nothing is dropped without a word > a scan the pharmacist will not confirm can be discarded: it is kept in the list, marked as not screened`
- `server/api.test.ts > the calls added after the review of 18 November > discards a scan the pharmacist will not confirm`
- `src/lib/events.test.ts > scanNeedsCheck > stops counting a scan once the pharmacist has discarded it, so the number on the magnifying glass clears`

### 27. Other things a pharmacist would find confusing (minor, 14 parts)

Real. Nine parts are done, one is done in part, and four are left open.

| Part | What | Now |
|---|---|---|
| 1 | The coloured bars had no key | Done. One line under the bars says what each colour means. A history that was not fully screened has no green tick. |
| 2 | A card never said what became of a finding | Done. "What became of the 3 findings: 1 was not confirmed by the second check, 1 was accepted by you, 1 was bypassed by you." |
| 3 | "Lines not verified" and line numbers were not explained | Done. "Each line has a number. L030 is line 30 of this history." The tag says what it means when the mouse rests on it. When no model pointed to a line that exists, the panel says "Please read the whole history." |
| 4 | PDF rows show bare numbers, title rows are numbered, the patient is only "Fictional patient" | Open. See the list at the end. |
| 5 | The rule the models were given was not shown | Done. "What the models were asked to look for:" under the criterion. |
| 6 | "What a dispensing history cannot show" mixed Model 2's words and the criterion's | Done. The criterion's words first, then "Model 2 added:". |
| 7 | One finding makes one letter | Open. The founder decides. |
| 8 | A template letter tells the doctor "The AI draft did not pass its checks." | Open. The founder decides. The wording is now right when the model did not answer at all (finding 32). |
| 9 | "Could not be screened" had no "try again" | Done. "Screen again what has no result" (finding 5). |
| 10 | A finding in the grey list could not be acted on | Done, as finding 4 asks: "Accept anyway". The founder may take it out. |
| 11 | "Start Ollama" did not say how | Done. "Start them with start-ollama.ps1 (step 1 of docs\RUNNING.md)." |
| 12 | "closed" and "overdue" did not say what | Done. "letters closed", "letters overdue", and "1 history screened" for one. |
| 13 | The red number on the magnifying glass is not explained on the main page | Open. See the list at the end. |
| 14 | With the scan picture shown larger the rows move under it | In part. The large picture now has a height limit and its own scroll, so the first rows stay in view under it. Side by side at full size does not fit a 1366 px screen. |

Tests:

- `src/components/panels.test.tsx > the import panel > says only what is true about scans, and explains the bars and the line numbers` (parts 1 and 3)
- `src/components/panels.test.tsx > what the card says became of the findings > follows each finding to its end, not only to the second check` (part 2)
- `src/components/panels.test.tsx > the words of the models under the bell > puts the criterion's own words first for what cannot be seen, and what Model 2 added after them` (parts 5 and 6)
- `src/components/panels.test.tsx > the words of the models under the bell > lets the pharmacist accept a finding from the grey list`,
  and `server/engine.test.ts > a second check that is not a plain yes or no > a finding in the grey list can still be accepted, and then gets its letter` (part 10)
- `src/lib/health.test.ts > the words about the local models > says in plain words that nothing can be screened, and how to start the models` (part 11)
- `src/components/panels.test.tsx > the first screen > says what is closed and what is overdue, and writes one history as one` (part 12)

### 28. With the models not running, an import was shown as screened with no finding (serious)

Real. Fixed, except one wish the reviewer marked "better still".

What was done:

- A history is not counted as screened when a criterion failed. The headline says how many criteria
  could not be screened, and the log line no longer says "nothing suspected" in that case (finding 5).
- The first screen says "The local models are not running. Nothing can be screened until they
  are." in a red note beside the status line. The import panel says it too, with how to start them.
- The page asks for the health of the models again when a file is imported, and every 5 seconds
  while they are not ready.
- "Screen again what has no result" picks the history up once the models run (finding 5).

Left open: holding a job while the model server is down. See the list at the end.

Tests:

- `server/engine.test.ts > a criterion that could not be screened is never "no finding" > does not count the history as screened, and the log never says "nothing suspected"`
- `src/lib/health.test.ts > the words about the local models` (4 tests)
- `src/components/panels.test.tsx > the import panel > says when the local models are not running, before a history is imported`
- `src/components/panels.test.tsx > the first screen > shows what must not be missed beside the status line, and nothing when all is well`

### 29. The letter jumped while the pharmacist typed in the lower part of it (serious)

Real. One key press moved the view from 557 to 341.

What was done:

- The scroll position is read before the letter box is given its new height, and put back after.

Tests:

- `src/components/panels.test.tsx > typing in the lower part of a letter > keeps the scroll position while the box is given its new height`
- Checked with real key presses in a browser: the position stayed at 330 after one key and after
  22 more.

### 30. "Open in my email program" with unsaved edits raised the browser's "leave this page?" (serious)

Real.

What was done:

- The button saves the edits first and waits for the save. Only then does it open the email
  program. The "should open" message is shown only after that. When the save fails, nothing is
  opened and the reason is shown.

Tests:

- `src/lib/letters.test.ts > "Open in my email program"` (3 tests)

### 31. A long history took 170 model calls, lost the cached reading, and nothing could stop it (serious)

Real. Fixed, except the "Stop this screening" button.

What was done:

- For a long history the parts are now the outer loop and the criteria the inner one. Each part is
  read once and reused for every criterion, as `docs/SPEC.md` section 3 intends.
- The prototype screens up to 1,000 lines in one history. A longer one shows "Cannot assess" with
  the reason in plain words. It is not screened in part.
- "Start a clean demo" now stops the model call that is running at once.

Left open: a "Stop this screening" button. See the list at the end.

Tests:

- `pipeline/screen.test.ts > screenHistory: several criteria on one history > reads each part of a long history once for all criteria: the parts are the outer loop`
- `server/engine.test.ts > a long history > is refused in plain words when it is too long for the prototype, and is not screened in part`
- `server/engine.test.ts > a clean start while a model call is running > stops that call at once`
- `pipeline/ollama.test.ts > chat > stops at once when it is told to, and does not try a stopped call again`
- `pipeline/screen.test.ts > screenCriterion > passes the stop signal to every model call`

### 32. When Model 3 did not answer, the letter and the page said an AI draft failed its checks (minor)

Real.

What was done:

- There are two wordings now. When the model did not answer: "Built from the standard letter
  template. The AI model did not answer." The old wording is kept for a draft that failed its
  checks. The letter, the log and the page each use the right one.

Tests:

- `pipeline/letter.test.ts > draftLetter > falls back to the template when the model does not answer, and says that, not that a draft failed its checks`,
  and `> says why the template was used: the drafts failed their checks, or the step failed`
- `server/engine.test.ts > a letter built from the template > says in the log what happened` (3 cases)
- `src/components/panels.test.tsx > a letter built from the template > says that the model did not answer when that is what happened, not that a draft failed its checks`

### 33. The pictures of a scan were gone after a page reload (minor)

Real.

What was done:

- New call `GET /api/cases/:id/pages/:n`. It returns the saved picture of a page until the rows are
  confirmed. The page loads the pictures from it when it has none of its own.

Tests:

- `server/api.test.ts > the calls added after the review of 18 November > serves the page pictures of a scan until its rows are confirmed, so the check works after a page reload`
- `server/engine.test.ts > a scan: nothing is dropped without a word > the page pictures can be fetched from the server until the rows are confirmed`
- `src/components/panels.test.tsx > the check of a scan > shows the page marks, the empty page, the pictures kept by the server and the way to discard the scan`

### 34. A state file that is valid JSON but damaged inside stopped the server from starting (minor)

Real.

What was done:

- Every history, finding, letter and job is checked when the state is loaded. A file that fails is
  treated like one that cannot be read: it is kept as `state-unreadable-<time>.json` and the server
  starts clean, saying so.
- The step that picks up interrupted work has the same fallback.

Tests:

- `server/store.test.ts > the state store > treats a state file that is valid JSON but damaged inside as unreadable` (7 cases),
  and `> accepts a whole state, with every optional part in it`
- `server/engine.test.ts > a state that cannot be picked up > is kept as a backup and a clean state is started: the server starts, it never crashes`
- `src/lib/health.test.ts > the newest problem, for the first screen > shows a saved state that could not be read on start`

### 35. A second "npm start" rewrote the state file before it noticed the port was taken (minor)

Real.

What was done:

- The server opens the port first. It loads the state, picks up interrupted work and starts the
  queue only after the port is open. A second start ends with the plain message and touches nothing.

Tests:

- `server/index.test.ts > starting the server twice by mistake > the second start ends with a plain message and does not touch the state file of the first`
  (it starts the real server twice)

### 36. One failed save of the state file can leave a job "running" for ever (arrived cut off)

Real. This is the same defect as finding 6, found by a second reviewer. The text of the finding
was cut off in the middle of its second case, so its proposed fix could not be read. Both cases
that could be read are fixed by the work under finding 6.

Tests:

- `server/engine.test.ts > one failed write of the state file does not strand the work > A: the write just after a job is marked running fails. The job still runs`
- `server/engine.test.ts > one failed write of the state file does not strand the work > C: the write fails when the pharmacist accepts. The answer is still yes and the letter is written`

## Left open

The founder settled eight of these items on 18 November, about 19:10 (his words in DRIVE_413.md,
"Founder's decisions of 18 November, about 19:10"; the settling note is
BOARD\verdict\OPEN_ITEMS_FOR_THE_FOUNDER.settled.md). What remains open:

11. **Holding a job while the model server is down (finding 28).** Requested from Grok after G06
    (BOARD\unattended\REQUEST-kimi-to-grok-open-11.md); his answer is in main.
12. **PDF rows (finding 27, part 4).** Requested from Grok after G06
    (BOARD\unattended\REQUEST-kimi-to-grok-open-12.md); his answer is in main.
14. **The scan picture beside the rows at full size (finding 27, part 14).** Done in part only.
15. **Pop-ups on a narrow screen (finding 20).** On a phone the head of a panel takes several
    rows, and a pop-up about another panel can still cover part of it for up to 10 seconds.

## What was run at the end

All of it ran on this PC on 18 November 2026. The models ran through Ollama 0.40.15 at
127.0.0.1:27435. The app server was on port 8787. It was started for the runs and stopped after
them. Ollama was left running.

| What | Result | Where to look |
|---|---|---|
| `npm run typecheck` | Clean. | |
| `npm test` | 536 tests in 28 files pass. Before the review there were 347 tests in 21 files. | |
| `npm run build` and `npm run build:replay` | Both build. | `dist\`, `dist-replay\` |
| The live join test, `node tools\smoke.mjs`, at 12:00 on the final build | ALL 47 CHECKS PASSED in 169 seconds. Four histories, three findings, one letter, and every step of the pharmacist. | `cases\_demo\review-fix-run-2026-11-18.json`, `docs\screens\live-01` to `live-12` |
| The walk through the real page with real clicks, `node tools\page-walk.mjs`, at 11:53 on the final build | ALL 42 CHECKS PASSED in 436 seconds. The CSV file, the PDF, the picture and the scanned PDF each gave the confirmed finding. Model 1 read 45 of 45 rows exactly from each scan. The page raised no error. | `cases\_demo\review-fix-walk-2026-11-18.json`, `docs\screens\live-walk-*` |
| The scorer on the demo sheet, three histories, at 11:16 | PASS: caught 2 of 2, false flags 0, failed calls 0, letters 2 of 2, both written by the model. | `eval\results\20261118-111622\table.md` |
| A sample of the proposed criteria with the new answer forms, at 10:42: six criteria, 18 histories | 12 of 12 planted findings caught, with the planted lines shown. 6 of 6 near misses clear. 0 false flags. 0 calls tried twice. These criteria are not signed and not in use. | `cases\_demo\review-fix-sample-2026-11-18.json` |
| The recording for the judges' view | Written from the join test above: 4 histories, 3 findings, 1 letter, 26 steps. | `cases\_demo\recorded-state.json` |

More about these runs:

- The join test also passed at 11:12 and at 11:47, and the walk at 11:18, 11:27 and 11:38, each
  time with every check. Small changes to the page were made between those runs. The runs in the
  table are the last ones, made after the last change.
- The scorer and the sample ran earlier in the day. The sample uses the model jobs only, and their
  code did not change after it. The scorer ran after the last change to the model jobs, the server
  and the scorer. Only the page changed later.
- The long history in the join test: Model 1 read the three parts, then read the 36 listed lines
  together and suspected the finding, naming L032 (Xarelto, 8 August 2026) and L309 (Celebrex,
  21 August 2026). Model 2 read the same 36 lines together and confirmed it with the same two lines.
- The sample view and the recorded view were also looked at by hand in a browser: the keyboard,
  typing in a letter, the phone widths, the place of the pop-ups, and the Accept row of the bell panel.
- Not seen with the real models: a criterion that could not be screened, a second check marked
  "unclear" or "not completed", a letter built from the template, and a failed write of the state
  file. These are covered by the unit tests with stand-in models.

At the end `data\state.json` holds the end of the last join test: four histories, one closed
letter, one bypass, and the finding of the long history waiting under the bell.
