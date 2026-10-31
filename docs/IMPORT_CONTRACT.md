# Lens → Tomorrow: `POST /api/lens/import`

What Tomorrow implements so Lens's **Send to Tomorrow** creates the confirmed items in the person's Tomorrow account.
Lens's side is built and live: [`src/lib/tomorrow/contract.ts`](../src/lib/tomorrow/contract.ts) (zod schemas, the
same shapes as below) and [`src/app/api/send/route.ts`](../src/app/api/send/route.ts) (the relay). If this document and
that file disagree, the file is right; they're meant to change together.

## Who calls it

The person presses Send in Lens. Lens's server relays one request to `TOMORROW_IMPORT_URL` (default
`https://bettertmrw.app/api/lens/import`) with the person's **Lens token**. Lens never stores the token.

## Request

```http
POST /api/lens/import
Authorization: Bearer <Lens token>
Idempotency-Key: <64 hex chars: sha256 of the JSON body>
Content-Type: application/json
```

- **Lens token**: generated in Tomorrow Settings ("Connect Lens"), one per user, revocable, shown once. Store only a hash.
  It authorizes this one endpoint, nothing else.
- **Idempotency-Key**: the same body always has the same key. If you've seen the key for this user in the last 24 hours,
  return the stored response and do nothing else.

```jsonc
{
  "version": 1,
  "zone": "America/New_York", // IANA zone every date and time below is in
  "items": [
    // A weekly class
    {
      "lens_id": "class_1f3a9c", // stable across sends of the same inputs
      "kind": "class_block",
      "title": "MATH141 lecture",
      "course": "MATH141",
      "meeting_type": "lecture", // lecture | discussion | lab | other
      "location": "ESJ 0224", // or null
      "start": "2026-08-31T10:00:00-04:00", // first meeting
      "end": "2026-08-31T10:50:00-04:00",
      "rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261209T045959Z", // no UNTIL if the last day isn't known
      "exdates": ["2026-11-25T10:00:00-05:00", "2026-11-27T10:00:00-05:00"], // meetings in breaks
      "evidence": [
        {
          "source": "Testudo screenshot",
          "page": null,
          "quote": "Lec MWF 10:00am - 10:50am ESJ 0224",
          "computed_from": "The first MWF on or after the first day of classes (Mon Aug 31).",
        },
      ],
    },
    // A deadline, exam, or task
    {
      "lens_id": "item_8c21d0",
      "kind": "exam", // deadline | exam | task
      "title": "Midterm 1",
      "course": "MATH141", // or null
      "date": "2026-10-21", // the person's local day; null only for a task with no date
      "start_time": "10:00", // local wall clock, or null when no time is written
      "end_time": "10:50", // or null
      "start": "2026-10-21T10:00:00-04:00", // same as an instant, null when there's no time
      "end": "2026-10-21T10:50:00-04:00",
      "evidence": [
        {
          "source": "MATH141 syllabus",
          "page": 2,
          "quote": "Midterm 1, Wed Oct 21, in class",
          "computed_from": "\"Wed Oct 21\", in 2026: the year of the term.",
        },
      ],
    },
  ],
}
```

Rules Lens guarantees, so Tomorrow doesn't have to re-check them:

- Only items the person has verified or answered are sent; nothing amber or unanswered.
- Every date passed Lens's audit (it traces to the words it was read from, or to the person's answer).
- **No invented times.** A deadline with no written time has `start_time: null` and `start: null`. Tomorrow decides what
  that means (end of day for a deadline is the usual choice); please don't show it as midnight.
- `exdates` use the class's own start time, so they match RRULE occurrences exactly.
- 1 to 300 items. `title` ≤ 200 chars, `quote` ≤ 500, at most 5 evidence entries per item.
- `evidence` is for display ("From your MATH141 syllabus, page 2: …"). It contains the person's own words; treat it like
  the rest of their data.

## Response

`200 OK`

```json
{
  "created": { "class_1f3a9c": "tmrw_evt_123", "item_8c21d0": "tmrw_task_456" },
  "skipped_duplicates": ["item_77aa01"]
}
```

- `created`: `lens_id` → Tomorrow's id, for everything created by this call.
- `skipped_duplicates`: `lens_id`s this user already has from an earlier send. Leave those as they are. (Updating an
  item that was edited in Lens after an earlier send is out of scope for v1.)

Errors (Lens shows the person a plain message for each):

| Status | When                                       |
| ------ | ------------------------------------------ |
| 401    | Missing, unknown, or revoked token         |
| 404    | Not deployed yet (Lens says so plainly)    |
| 409    | Same Idempotency-Key, different body       |
| 422    | Body fails validation; include the reasons |
| 429    | Too many imports; include `Retry-After`    |
| 5xx    | Anything else; Lens asks them to try again |

## What Tomorrow does with it

1. Validate with the same schema (copying the zod shapes from `contract.ts` into Tomorrow is fine: it's this
   repo's Apache-2.0 code going into Tomorrow, not the other way).
2. For each item: skip it if this user already has an item with that `lens_id`; otherwise create it, storing
   `lens_id` and `evidence`.
   - `class_block` → a recurring fixed block (DTSTART `start`, RRULE `rrule`, EXDATE `exdates`). The scheduler treats it
     as busy time.
   - `exam` → a fixed event at `start`-`end`, or all day on `date` if there's no time.
   - `deadline` → a due item on `date` (at `start_time` if given). Study sessions are placed before it.
   - `task` → a to-do, with `date` as its due day if there is one.
3. Run the existing scheduler so study sessions are placed around the new classes, and reminders are set.
4. Return the response above, and store it under the Idempotency-Key for 24 hours.

## Test it

Lens's page has **Download what would be sent (JSON)** under Send, which gives you a real body from the sample week.

```bash
curl -s https://bettertmrw.app/api/lens/import \
  -H "Authorization: Bearer $LENS_TOKEN" \
  -H "Idempotency-Key: $(shasum -a 256 lens-import.json | cut -c1-64)" \
  -H "Content-Type: application/json" \
  --data @lens-import.json
```

The second identical call should return the same response and create nothing.
