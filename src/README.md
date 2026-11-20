# The page

One page, three round icons. Built as docs/SPEC.md section 8 describes. The state lives in the
local server; the page asks `GET /api/state` every second and draws what it is told.

## Looking at it without the server

Add `?mock=1` to the address. The page then answers its own calls from sample data in `src/mock/`
and says so at the top ("Sample data. The models are not connected."). Nothing is saved; a reload
starts the sample data again. A file imported in this view is read by the page but is shown as
"Cannot assess", so a sample view can never be read as a real screening result.

| Address | What it shows |
|---|---|
| `/?mock=1` | the main page with sample data |
| `/?mock=1&panel=bell` | the bell panel open |
| `/?mock=1&panel=letter` | the letter panel open |
| `/?mock=1&panel=import` | the import panel open |

`?panel=` also works without `?mock=1`.

The sample data covers: a screening that is running, four findings under the bell (one marked
"Second check not completed", one that cites a test result from the record, and one possible
finding), one finding not confirmed, letters in every status including overdue and one built from
the template, a history that cannot be assessed, a criterion that could not be screened, a scan
waiting for the pharmacist to check its rows, and a record that also lists a condition, a test
result and a measurement. The twelve sample criteria are written for the mock-up and are labelled
as sample text: the first ten, and two further ones that need a fact from the record. They are not
the criteria of the prototype.

The note "Sample data. The models are not connected." is at the top of the first screen and in the
head of every panel. The sample letters say that they were written by hand for the mock-up, on the
screen and on the printout.

## Records that also carry conditions and results

docs/SPEC.md section 6a. A record may list facts beside its supplies: a condition, a test result
or a measurement. What the page does with them:

- **A fact line** reads "2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2". Wherever lines are listed,
  its kind (CONDITION, RESULT or OBSERVATION) is set as a small mark, so the line is not read as a
  supply. A fact line the models pointed to is shown among the matching lines, in file order.
- **A possible finding** shows one line above its evidence under the bell: "Possible finding. The
  record does not show: (fact). The letter asks the doctor to confirm." The fact is named in the
  words of Model 1. When it named none and the criterion needs one fact only, that fact is named.
- **The import panel** says that a CSV file may also list known conditions and test results.
- **Many criteria.** The status line keeps "Model 1 is screening: criterion 388 of 413" on one
  line down to a screen 320 px wide. A history screened against more than 40 criteria shows its
  bars as small blocks in several rows.

Which line is a fact, whether a finding is a possible finding and which fact is missing are
decided in `../shared/facts.ts`, the same rule the server and the letter use. `lib/facts.ts` only
chooses the words. In the sample view the record is `fictional-patient-g.csv`.

## The judges' view: a recorded real run

`npm run build:replay` builds the page into `dist-replay/`. That build never talks to a server. It
plays `cases/_demo/recorded-state.json`, the saved state of a real run on the entrant's computer,
step by step: each step is one line of the activity log of that run. It says "Recorded run from the
entrant's computer. The live models are not connected." at the top of the first screen and in the
head of every panel. An import, and every button that would change something, answers with one
plain sentence that this is a recorded run.

To record a new run: start Ollama and the server, run `npm run smoke`, then `npm run record` while
the server still runs, then `npm run build:replay`. `dist-replay/` can be put on any plain web
host, in any folder.

## Where things are

| Path | What |
|---|---|
| `api.ts`, `apiError.ts` | one typed call for every call in SPEC section 5; `?mock=1` switches to the sample data, and the replay build to the recorded run |
| `lib/useLantern.ts` | the one-second poll, the criteria, the health of the local models, the pop-up messages |
| `lib/importFile.ts`, `lib/pdf.ts`, `lib/pdfRows.ts` | CSV as text; PDF text into printed rows; scans into PNG pages |
| `lib/pdfPictures.ts` | how much of a PDF page pictures cover: a fifth or more makes the page a scan |
| `lib/criteria.ts` | reads what `GET /api/criteria` sends into what the page shows |
| `lib/letters.ts`, `lib/events.ts`, `lib/format.ts` | overdue, the email link, what is new, dates and words |
| `lib/health.ts` | the words about the local models, and the newest problem for the first screen |
| `../shared/lines.ts` | the one rule for the lines of a finding, shared with the letter and the scorer |
| `../shared/facts.ts`, `lib/facts.ts` | the one rule for the facts a record carries and for a possible finding; the words the page says about them |
| `components/` | hero, the three icons, status line, counts line, the three panels, pop-ups, footer, the replay bar |
| `components/panels.test.tsx` | what the panels say, drawn to plain markup without a browser |
| `brand/` | the mark as a drawing; `node src/brand/write-mark-svg.ts` rewrites `public/mark.svg` and `public/favicon.svg` |
| `mock/` | the sample data and a small stand-in for the server |
| `replay/` | the recorded run: the state as it was at each step, and a stand-in for the server that changes nothing |
| `styles/` | colours and type from SPEC section 8; `print.css` prints only the open letter on A4 |

## What the page sends and expects

- `POST /api/cases`: `csvText` for a CSV; `rows` (one entry per printed row, columns joined with
  ` | `) for a PDF with text; `pageImages` (base64 PNG, no `data:` prefix, about 150 dots per inch,
  one per page) for a scan or a photo. If any page of a PDF is a scan, every page is sent as a
  picture, so no page is left out. A blank page is left out and the page says so.
- `POST /api/cases/:id/confirm-transcription`: `{}` when the rows are right, or `{ "rows": [...] }`
  when the pharmacist corrected them. The server answers 409 with plain words while a row has no
  date that can be read.
- `GET /api/cases/:id/pages/:n`: the picture of page n of a scan, as PNG, until its rows are
  confirmed. The page uses it when it has no picture of its own, for example after a reload.
- `POST /api/cases/:id/screen-again`: `{}`. Screens the criteria that have no result.
- `POST /api/cases/:id/discard`: `{}`. Gives up a scan whose rows are not confirmed.
- `POST /api/letters/:id/agree`: `{ "agreed": true }` or `{ "agreed": false }`.
- Every other POST and PUT carries a JSON body, `{}` when there is nothing to say.
- An error answer is read from `{ "error": "plain words" }` and shown as it is.

## Checks

```
npm run typecheck
npx vitest run src
npm run build
```
