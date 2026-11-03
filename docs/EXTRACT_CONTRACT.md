# Tomorrow → Lens: `POST /api/extract` (text-a-photo)

What Tomorrow calls when someone texts a photo (a whiteboard, notes, a syllabus page, a schedule, or a course site's
to-do list), and what it does with the answer. Lens's side is built:
[`src/lib/tomorrow/extract.ts`](../src/lib/tomorrow/extract.ts) (zod schemas, the same shapes as below, and the logic),
[`src/app/api/extract/route.ts`](../src/app/api/extract/route.ts), and
[`src/app/api/extract/answer/route.ts`](../src/app/api/extract/answer/route.ts). If this document and those files
disagree, the files are right.

## The loop

1. The person texts one or more photos. Tomorrow downloads them from Twilio and converts HEIC to JPEG. It may shrink
   them to 2048 px on the long edge; each must be at most 3 MB.
2. Tomorrow calls `POST /api/extract` with the photos, the person's upcoming deadlines and exams (`existing`), and the
   term dates it knows.
3. Lens reads each photo: one cheap call says what it is and whether it can be read, then it's read and verified like
   any upload in the app (SAM 3.1 on whiteboards and notes). A photo too blurry to trust isn't guessed at.
4. Tomorrow:
   - creates every item with `auto_apply: true`;
   - texts `summary`, then `questions[0]` (one question per text, its options numbered, the suggested one marked);
   - offers `review.url` for the full picture.
5. Each reply goes to `POST /api/extract/answer`. The response is the whole picture again. Tomorrow applies what's newly
   auto-applicable (items, and changes the person confirmed) and texts the next question, until none are left.

## Request

```http
POST https://tmrw-lens.vercel.app/api/extract
Authorization: Bearer <LENS_REBUILD_SECRET>
Content-Type: application/json
```

The same shared secret as `/api/rebuild` (docs/REBUILD_CONTRACT.md); server to server only.

```jsonc
{
  "version": 1,
  "user_ref": "u_7f3a1c9e", // optional, please send it: Tomorrow's opaque id for the person (8-64 chars; not a phone or email). Limits are per person; without it, every request shares one Tomorrow identity
  "zone": "America/New_York",
  "now": "2026-10-28T11:05:00-04:00", // when the text arrived
  "images": [{ "data": "<base64 JPEG or PNG, at most 3 MB>" }], // 1 to 4
  // Upcoming deadlines and exams Tomorrow has (at most 300), so Lens can say what a photo changes or repeats.
  "existing": [
    {
      "id": "tmrw_task_456", // echoed back in changes and duplicates
      "title": "Quiz 3",
      "kind": "exam", // deadline | exam | task | null
      "course": "MATH141", // or null
      "date": "2026-10-30", // or null
      "time": null, // "HH:mm" or null
      "source": "MATH141 syllabus", // where it came from, as the person would say it
    },
  ],
  "term": { "start": "2026-08-31", "end": "2026-12-08" }, // or null; either date may be null
}
```

The whole body must stay under 4.5 MB (Vercel's limit): one 3 MB photo, or several smaller ones.

## Response

`200 OK`. Abridged; every field is in the schema.

```jsonc
{
  "version": 1,
  "summary": "From your photo: nothing new to add yet. 1 already in your plan. 1 question for you.",
  "photos": [{ "index": 0, "kind": "whiteboard_photo", "readable": "clear", "items": 3 }],
  // New items and classes, in the import contract's shapes (docs/IMPORT_CONTRACT.md), plus:
  "items": [
    {
      "lens_id": "item_3b9e21",
      "kind": "task",
      "title": "Office hours",
      "course": "MATH141",
      "date": "2026-10-28",
      "start_time": "14:00",
      "end_time": "15:00",
      "start": "2026-10-28T14:00:00-04:00",
      "end": "2026-10-28T15:00:00-04:00",
      "evidence": [
        {
          "source": "whiteboard photo",
          "page": null,
          "quote": "Office hours today 2-3pm",
          "computed_from": "\"today\", counted from the day the photo was taken (Wed Oct 28).",
        },
      ],
      "status": "verified", // verified | needs_question | unverified | conflict
      "auto_apply": true, // create it now; false: wait (its question is in questions)
    },
  ],
  // An existing item the photo says something different about. Never applied until the person answers.
  "changes": [
    {
      "existing_id": "tmrw_task_456",
      "lens_id": "item_9c01aa",
      "title": "Quiz 3",
      "kind": "moved", // the photo says it moved; "contradiction": it just says something else
      "from": { "date": "2026-10-30", "time": null },
      "to": { "date": "2026-11-02", "time": null },
      "evidence": { "source": "whiteboard photo", "page": null, "quote": "Quiz moved to Mon!", "computed_from": null },
      "question_id": "q_change_tmrw_task_456",
      "status": "needs_question", // confirmed: apply `to` to the existing item. kept: leave it.
      "auto_apply": false,
    },
  ],
  // Read from the photo and already in Tomorrow with the same date: nothing to do.
  "duplicates": [{ "existing_id": "tmrw_task_789", "lens_id": "item_51d2f0" }],
  "questions": [
    {
      "id": "q_change_tmrw_task_456",
      "text": "Your MATH141 syllabus says Quiz 3 is Fri Oct 30. The whiteboard photo says \"Quiz moved to Mon!\", which is Mon Nov 2. Which is right?",
      "options": [
        { "id": "new", "label": "Mon Nov 2 (the whiteboard photo)" },
        { "id": "keep", "label": "Fri Oct 30 (your MATH141 syllabus)" },
        { "id": "different", "label": "They're two different things" },
      ],
      "input": null, // or "date" | "time" | "text": the option that asks them to type it
      "suggested": "new", // pre-selected, never applied until they answer
      "why": "The whiteboard photo says it changed, and it's newer than your MATH141 syllabus.",
    },
  ],
  "review": { "url": "https://tmrw-lens.vercel.app/review/<token>", "expires_at": "2026-10-29T15:05:00.000Z" },
}
```

What Lens guarantees:

- `auto_apply: true` only for an item that's verified (its quote read back the same on a second, independent read of its
  crop; its date computed in code from the words; nothing to ask), with a date, or a task. Everything else waits.
  An optional item ("Tell your instructor about any exam conflict (Exam 2) (only if you have a conflict)", derived from
  a syllabus's notice rule) is never `auto_apply`; its title says when it applies.
- **No invented dates or times.** A deadline with no time written has `start_time: null`; date-only stays date-only. A
  time on only one side of a comparison isn't a change.
- A change to an existing item is never applied until the person answers its question.
- A photo too blurry to trust gives no items, only a question asking for a sharper one.
- One question per ambiguity, in the order to ask them: the photo's own questions (when was it taken, which course)
  come before the changes they unlock.

## Answers: `POST /api/extract/answer`

```jsonc
{
  "version": 1,
  "review": "<token>", // the last part of review.url
  "answers": [{ "question_id": "q_change_tmrw_task_456", "option_id": "new", "value": null }],
}
```

- `value` is what they typed, for the option whose question has an `input`: a date as `YYYY-MM-DD`, a time as `HH:mm`.
  Parse their text into that; for the photo-date question, `"option_id": "today"` means the day the text arrived.
- Send only new answers. Lens keeps earlier ones with the review (a later answer to the same question replaces the
  earlier one).
- No model call; the response is the full shape above.
- `404` once the review has expired (24 hours).

## Errors

| Status | When                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401    | Missing or wrong secret                                                                                                                                                             |
| 413    | An image over 3 MB                                                                                                                                                                  |
| 415    | An image that isn't JPEG or PNG (HEIC is named, so you can convert it)                                                                                                              |
| 422    | Doesn't match the contract; `issues` says what's wrong                                                                                                                              |
| 429    | `code: "user_limit"`: this `user_ref` is past 30 calls or $0.50 today (shared with `/api/rebuild`; each photo the model reads is one call, a cached photo is free); has Retry-After |
| 502    | The model didn't answer properly; retry once                                                                                                                                        |
| 503    | `code: "global_limit"`: Lens's daily budget for Tomorrow is spent; has Retry-After. Without a `code`, the secret isn't set on this Lens                                             |

## Privacy

- Photos are held in memory for the request only. Lens never writes them anywhere.
- What was read (quotes, boxes, dates) is cached for 24 hours, encrypted with a key derived from the photo's bytes, so
  the same photo isn't paid for twice.
- The review stores what was read, plus the `existing` items sent, encrypted for 24 hours with a random key that exists
  only in the review link. The link is signed, so it can't be forged or extended.
- Logs hold counts and costs only, never content.

## Test it

The four cases in [`evals/extract/cases.ts`](../evals/extract/cases.ts) use the synthetic fixtures in
`fixtures/synthetic/` (`whiteboard-quiz-moved.jpg`, `canvas-todo.png`, `whiteboard-blurry.jpg`).

```bash
jq -n --arg img "$(base64 -i fixtures/synthetic/canvas-todo.png)" '{version:1,user_ref:"test_user_1",zone:"America/New_York",now:"2026-11-01T18:00:00-05:00",images:[{data:$img}],existing:[],term:{start:"2026-08-31",end:"2026-12-08"}}' > extract-request.json
curl -s https://tmrw-lens.vercel.app/api/extract -H "Authorization: Bearer $LENS_REBUILD_SECRET" \
  -H "Content-Type: application/json" --data @extract-request.json
```
