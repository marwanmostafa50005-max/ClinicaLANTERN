# The sign-off page

This page is for you, the clinical reviewer. The final database has 583 criteria in use, 7 set
aside, 0 named candidates outside use, and 7 never drafted. Thirty-one more reached main in 8b543b6,
bringing the in-use count from 534 to 565; twelve more reached main in 874a091, bringing it to 577;
two more reached main in 8fa5b56, bringing it to 579; three more reached main in ba81741, bringing
it to 582; MHRA-12 reached main in 0571aab, bringing it to 583. START-H7 passed its late run and was
brought into use in commit f28deb1; CKD-C09B, KHAWAGI-G130 and KHAWAGI-G153 followed in 6d3e8de,
GERARD-39 and GERARD-40 followed in b69735c, SCOTRESP-01 followed in f77e39b, and SCOTRESP-09
followed in 623c0af after their own runs passed.
The page offers a criterion for signing only when its final text has passed and its audit is
complete. You read one criterion at a time, then sign it with one click or say what must change.
Every patient in the test histories is fictional. The 20:05:34 sign-off snapshot lists 241 ready to
sign, 231 passed but not yet for signing, 8 did not pass and in repair, 80 whose new text waits for
a run, and 23 passed and settled page updates outstanding.

## Start it

1. Open PowerShell.
2. Paste this line and press Enter:

       node C:\Users\AdamG\ClinicaLANTERN-Lantern\tools\signoff\server.mjs

3. Open this address in your browser: **http://127.0.0.1:8790**

Leave the PowerShell window open while you work. To stop the page, press Ctrl+C in that window.

The first time, the page asks for your name. It asks once. You can stop at any time and start again later. The page opens at the first criterion you have not signed.

## What is on the page

- **Left: the list.** The first ten, then the reserves, then the rest by family. A tick means signed. A pencil means you asked for a change. An exclamation mark means look again.
- **Middle: the criterion.** The published statement and its credit line, the medicines that count, the facts it needs, what the models are told, what the letter asks the GP, what cannot be seen in the record, the urgency and the test histories. This is the criterion's own letter request. In the pharmacist's application, code joins the accepted findings for one patient into one combined letter. Most criteria are longer than one screen. Scroll the middle with the mouse wheel, or press Space or Page Down.
- **Right: your decision.** Under it are the scored result, Gemini's second opinion and the drafter's doubts.
- **Top: the counts.** Signed, to change, left and not drafted. Beside them are the progress bar, the search box and the filters.

The statement is marked in one of two ways. **Published text** means the words are the published ones. **The entrant's own words. Not the published text.** means the drafter wrote a summary. Read those with more care.

## What each button does

| Button | Key | What it does |
|---|---|---|
| **SIGN** | S | Records your signature on the file you are reading. Then it goes to the next one that is not signed. |
| **NEEDS A CHANGE** | C | Opens a box. Write what must change, in your own words. Save it. Then it goes on. |
| Back, Next | Left and right arrow | Move one step in the list. |
| Skip | | Leaves this one as it is and goes to the next one that is not signed. |
| Undo | U | Takes back your last click. Press it again for the click before that. |
| Withdraw the signature | | Shown on a signed criterion. It removes your signature. |
| Show the rows | | Shows a test history as a table. The gold rows are the planted lines. |
| AGREE: LEAVE IT OUT | S | Shown on the 7 criteria that were not drafted. It records that you agree. |

The search box finds a criterion by its number, its name or a medicine. The filters narrow the list. Press Esc to leave the search box or a filter. Your search stays, and the keys work on the criterion again.

## Your words in the change box

- Your words count only after you press **Save and go to the next one**, or Ctrl+Enter.
- While the box is open, the S and U keys do not sign and do not undo. What you type goes into the box.
- If you leave a criterion with words in the box, the page tells you. A gold button at the top says how many notes are not saved. Click it to go back to them.
- The words you have not saved are kept in your browser. They are still there after a reload.
- A criterion with unsaved words cannot be signed by mistake. Save the words, or press **Throw them away**, then sign.
- If you undo a change request, your words go back into the box. Nothing you wrote is lost.

## Look again

Your signature belongs to the words you read. If a word, a medicine or a number in that file is changed later, for example by a repair, the page marks it "Look again". It shows the new version and says which parts changed. Those parts are marked in red. Read them and sign again. A file with changed words is never signed for you.

If a file is only saved again with another layout (line ends, spacing, the order of the fields), nothing you read has changed. Your signature stands, and the page says so.

## Nothing is final until apply is run

Each click is saved at once in the ledger. The page changes no criterion file. To make your signatures final, run this line in PowerShell. It only says what would happen. It writes nothing.

    node C:\Users\AdamG\ClinicaLANTERN-Lantern\tools\signoff\apply.mjs --dry-run

Then run the same line without `--dry-run`. It writes your name and the date into each criterion file you signed, and marks the file as no longer a draft. It does not sign a file whose words changed after you signed it, and it tells you which ones. It also writes the list of changes you asked for.

After that, a signature cannot be withdrawn on the page. Press NEEDS A CHANGE and say why.

## Where things are kept

| What | Where |
|---|---|
| The ledger: your name and every decision | `C:\Users\AdamG\ClinicaLANTERN-Lantern\docs\signoff\ledger.json` |
| A copy of the ledger for each hour you worked | `docs\signoff\backups` |
| The changes you asked for, written by apply | `docs\signoff\changes.md` |
| Words typed in the change box and not saved yet | In your browser, on this computer |

## If something looks wrong

- **The page does not open.** Check that the PowerShell window is still open. If it is not, start the page again.
- **"Port 8790 is already in use."** The page is already running. Open the address.
- **The S key does nothing.** The change box is open, or the keyboard is in the search box or a filter. Press Esc, then S.
- **A red bar says the ledger is damaged.** Stop there. Nothing was overwritten. The backups folder holds earlier copies.
- **A message says the ledger file was missing and was put back.** No decision is lost. Tell the build team, because something removed the file.
- **The list does not show the current database.** Tell the build team. The top of the page reports the final-test and ready-to-sign counts.

## For the build team

- The page listens on 127.0.0.1 only and reads the folders again on every request. One entry is shown for each criterion, from the newest copy: the repository, then a repaired wave on the board (`W<n>-r<k>`), then the board, then `waves-claude`.
- Results come from `run0\results\results.json` and `fireup\runs\waves\summary.json`. Second opinions come from `fireup\gemini\reviews\*.json`. All are optional.
- Ledger extras: every decision keeps `parts`, one short fingerprint for each field of the file he read (`draft` and `signed_by_clinical_reviewer` left out). Apply adds `applied_at` and `applied_hash` to a signed entry. An agreement to leave out a criterion that was not drafted is kept apart from the signatures, under `not_drafted_agreed`.
- A decision stands when the file is the same bytes (`file_hash`), or when every part is the same (the file was only laid out again). It asks for a second look when any part differs. `apply.mjs` follows the same rule and prints "laid out again" for a file it signs on the second ground. A copy step that reads and rewrites the JSON therefore does not throw his signatures away. A copy step that changes a word does.
- The ledger is written whole (temporary file, flush, rename), so a stop in the middle of a save leaves the old ledger. A leftover temporary file is removed by a later save. If the ledger file disappears while the page runs, the page puts it back from memory at the next request and says so. Do not delete `docs\signoff` to reset a test while the page is running: stop the page first.
- The ledger and its backups are plain files inside the repository folder and are not in `.gitignore`. A clean-up of untracked files would remove them when the page is not running. Keep them out of any clean-up, and copy `docs\signoff` somewhere safe at the end of his day.
- Tests: `node tools\signoff\test\run-tests.mjs` (47 checks) and `node tools\signoff\test\crash-test.mjs` (kills the server while clicks are being saved, then checks that no acknowledged click is lost). Both use a copy in the temp folder. Roots can be set with `SIGNOFF_REPO`, `SIGNOFF_WAVES`, `SIGNOFF_BOARD`, `SIGNOFF_LEDGER`, `SIGNOFF_RUN0`, `SIGNOFF_SUMMARY`, `SIGNOFF_GEMINI` and `PORT`.
