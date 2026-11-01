# Tomorrow → Lens: `POST /api/rebuild`

What Tomorrow calls when a planned session passes undone, and what it does with the answer. Lens's side is built:
[`src/lib/rebuild/contract.ts`](../src/lib/rebuild/contract.ts) (zod schemas, the same shapes as below),
[`src/lib/rebuild/agent.ts`](../src/lib/rebuild/agent.ts) (the agent) and
[`src/app/api/rebuild/route.ts`](../src/app/api/rebuild/route.ts) (the route). If this document and those files disagree,
the files are right.

## The loop, end to end

1. **Miss detection (Tomorrow).** A planned session or task whose end time has passed, still `scheduled`, not marked done.
   Check about 15 minutes after its planned end, inside the person's waking hours (outside quiet hours, the check waits
   for the morning).
2. **Check-in (Tomorrow).** One message, single tap or one word: "Did Calc practice happen?" with yes / no / partial.
   Same rules as SPEC 6.7: the person's own words where there are any, varied wording, no guilt.
3. **Reply handling (Tomorrow).**
   - "yes": mark it done. No rebuild.
   - "no", "skipped", "partial", anything else, or **no reply within 2 hours**: call `POST /api/rebuild` with the reply
     text as written (`null` for no reply).
4. **Rebuild (Lens).** Muse Spark, with tools over the plan Tomorrow sent, decides what moves or drops and why. Code
   checks every move against the free time Tomorrow sent, and writes the message from the reasons.
5. **Apply (Tomorrow).** Re-check every move against your own availability (the plan may have changed since you sent
   it). If all moves still fit, apply the diff and send the `message` as the **one** recovery message. If any move no
   longer fits, apply nothing and call again with the current plan.

## Request

```http
POST https://lens.bettertmrw.app/api/rebuild
Authorization: Bearer <LENS_REBUILD_SECRET>
Content-Type: application/json
```

`LENS_REBUILD_SECRET` is one shared secret (at least 32 characters, e.g. `openssl rand -hex 32`), set in both
deployments' environment variables. Send it from your server only.

```jsonc
{
  "version": 1,
  "zone": "America/New_York", // the person's IANA zone
  "now": "2026-11-04T18:10:00-05:00",
  "missed": {
    "item_id": "s_calc", // one of items[].id
    "reply": "too tired tonight", // their reply as written, at most 280 chars; null when they didn't reply
  },
  // Sessions and tasks you placed, from now through the horizon (about 7 days, or through the latest deadline
  // they prepare for), plus the missed one. Lens may move or drop these, and nothing else.
  "items": [
    {
      "id": "s_calc",
      "title": "Calc practice",
      "course": "MATH141", // or null
      "start": "2026-11-04T16:00:00-05:00",
      "end": "2026-11-04T17:00:00-05:00",
      "due": null, // must finish by, if it has its own limit
      "for": "d_quiz", // the deadline it prepares for (an id in deadlines), or null
      "min_minutes": null, // the shortest version worth doing; null means 30 (or the full length if shorter)
      "status": "missed", // "missed" for the missed one, "planned" for the rest
    },
    {
      "id": "s_outline",
      "title": "Essay outline",
      "course": "ENGL101",
      "start": "2026-11-05T14:00:00-05:00",
      "end": "2026-11-05T15:00:00-05:00",
      "due": null,
      "for": "d_essay",
      "min_minutes": null,
      "status": "planned",
    },
  ],
  // Busy time Lens never moves or overlaps: classes, events, exams.
  "fixed": [{ "title": "MATH141 lecture", "start": "2026-11-04T10:00:00-05:00", "end": "2026-11-04T10:50:00-05:00" }],
  "deadlines": [
    { "id": "d_quiz", "title": "Quiz 3", "course": "MATH141", "due": "2026-11-05T10:00:00-05:00" },
    { "id": "d_essay", "title": "Essay 2", "course": "ENGL101", "due": "2026-11-06T23:59:00-05:00" },
  ],
  // Free time you'd place a session in (awake hours, buffers, and quiet hours already applied), NOT counting the
  // time the items above use: Lens adds an item's slot back itself when it moves or drops that item.
  "open_windows": [
    { "start": "2026-11-04T19:00:00-05:00", "end": "2026-11-04T22:00:00-05:00" },
    { "start": "2026-11-05T07:30:00-05:00", "end": "2026-11-05T09:30:00-05:00" },
  ],
}
```

Limits: 1 to 100 items, at most 300 fixed blocks, 100 deadlines, 200 windows, 200 KB in all. Every instant has an
offset. Item ids are unique, at most 64 characters.

## Response

`200 OK`

```json
{
  "version": 1,
  "diff": [
    {
      "item_id": "s_calc",
      "action": "move",
      "start": "2026-11-05T07:30:00-05:00",
      "end": "2026-11-05T08:30:00-05:00",
      "reason": "you said tonight is out and it's the last free time before the quiz"
    },
    { "item_id": "s_outline", "action": "keep", "start": null, "end": null, "reason": null }
  ],
  "message": "Moved Calc practice to 7:30am tomorrow because you said tonight is out and it's the last free time before the quiz. Nothing else changed.",
  "decided_by": "agent"
}
```

- `diff` has one entry per request item, in the same order. `move` has the new `start`/`end` (it may be shorter than
  before, never below `min_minutes`); `drop` takes the item off the plan; `keep` leaves it alone.
- At most 3 entries are not `keep`.
- `message` is ready to send as is. It names every change, with times written by code in the person's zone, and ends
  "Nothing else changed." No guilt, streaks, praise, or urgency (code refuses reasons that have them).
- `decided_by` is `"fallback"` when the model couldn't be used (an outage, the spend cap, or no answer in time). Code then
  put the missed item in the first free time that fits before it's due, or dropped it if none does. It's still a valid
  rebuild; send it the same way.

What Lens guarantees, checked from scratch before it answers: every move starts after `now`, sits inside
`open_windows` (or a slot freed by another change), overlaps no `fixed` block and no other item, and ends before its
`due` and its deadline. The same request again within 24 hours gets the same answer from Lens's cache, so retries are
safe and free.

Errors:

| Status | When                                                    |
| ------ | ------------------------------------------------------- |
| 400    | The body isn't JSON                                     |
| 401    | Missing or wrong secret                                 |
| 413    | Body over 200 KB                                        |
| 422    | Doesn't match the contract; `issues` says what's wrong  |
| 503    | `LENS_REBUILD_SECRET` isn't set on this Lens deployment |

The route answers within about 50 seconds (the agent gives up at 45 and falls back). Use a 60-second timeout. On a
network error or 5xx, retry once, then send nothing and log it. A silent miss is better than a wrong message.

## Test it

```bash
curl -s https://lens.bettertmrw.app/api/rebuild \
  -H "Authorization: Bearer $LENS_REBUILD_SECRET" \
  -H "Content-Type: application/json" \
  --data @rebuild-request.json
```

The 10 cases in [`evals/rebuild/cases.ts`](../evals/rebuild/cases.ts) are ready-made requests (simple move, making
room, "too tired tonight", sick today, shortening, no time left, a reply that tries to give orders, the clock change,
partial). Their recorded answers are in `evals/rebuild/recorded/`.
