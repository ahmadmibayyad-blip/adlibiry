# AI Studio: its own page, plus a video playground

Date: 2026-10-21. Status: approved in chat, spec for review.

## Why

The ad page carries every AI tool (Why this video works, Write my version, Voice-over, Make the video) under the
ad's stats, and it has become too long. The user also wants a fal-style playground: describe a video, pick a model,
generate, refine, export.

## What the user agreed

- One **AI Studio** page in the sidebar, three tabs: **Remake an ad**, **Playground**, **My videos**.
- The ad page keeps one button, **Open in AI Studio ↗**, which opens the studio for that ad in a new tab.
- The Playground is for **Pro customers**, paid from the same AI-video seconds as UGC videos.
- The Playground starts from a **prompt plus an optional product photo** (first frame).
- Stay on fal (no Higgsfield): same models, similar prices, already integrated. Model ids live in one catalog so
  one model can move to another provider later.

## Pages

Route `/dashboard/studio` (`src/pages/dashboard/studio/page.tsx`), tab in `?tab=remake|playground|videos`, ad in
`?ad=<id>`. Sidebar entry "AI Studio".

- **Remake an ad** (`?ad=<id>`): the ad's thumbnail and name at the top, then the existing tools as numbered steps:
  1 Why this video works, 2 Write my version, 3 Voice-over, 4 Make the video. The components move as they are
  (`AdVideoAnalysis.tsx` and its children); no behaviour change. Without `?ad`: a short note to open an ad in Ad Spy
  and click "Open in AI Studio".
- **Playground**: see below.
- **My videos**: the user's UGC videos (`remakes`, done) and playground clips (`studioClips`, done), newest first,
  each with a player, its prompt or ad, date and Download MP4. 30 per page.
- **Ad page** (`src/pages/dashboard/ads/[id].tsx`): `AdVideoAnalysis` is replaced by a small card with
  "Open in AI Studio ↗" (`target="_blank"`) to `/dashboard/studio?tab=remake&ad=<id>`. `AdTranscript` stays.

## Playground

1. **Describe** — textarea (max 1,500 characters) with 3 tips under it (subject and action, camera move, light and
   mood). Optional product photo (JPG/PNG/WebP under 8 MB, same upload as Make the video). With a photo the model's
   image-to-video endpoint is used, else text-to-video.
2. **Model** — cards: name, one line on what it's good at, allowed lengths, and the seconds it will use.
3. **Format** — 9:16, 1:1, 16:9 where the model supports it (image-to-video models without an aspect setting follow
   the photo; their card says so). Length: only that model's lengths.
4. **Generate** — one clip at a time per user. Progress line while it runs (1–4 min).
5. **Takes** — every finished clip of this session's prompt shows in a strip below with **Re-roll** (same settings,
   new seed), **Other model** (keeps prompt, photo and format, opens the model picker), **Download MP4**.

### Models (v1)

Checked on fal 2026-10-21. The catalog is `convex/lib/studio.ts` `STUDIO_MODELS`; exact text-to-video ids and
parameters are re-checked on fal's API page when building, and a model without a text-to-video endpoint is shown only
when a photo is added.

| Key | Image-to-video endpoint | fal price | Lengths | Multiplier |
|---|---|---|---|---|
| `kling-2.5` | `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` | $0.07/s | 5, 10 | ×0.5 |
| `kling-3` | `fal-ai/kling-video/v3/pro/image-to-video` | $0.14/s | 5, 10 | ×1 |
| `seedance` | `fal-ai/bytedance/seedance/v1/pro/image-to-video` (1080p) | tokens, ~$0.12/s | 3–12 | ×1 |
| `h3-turbo` | `minimax/h3-max-turbo/image-to-video` | $0.025/s | per fal page | ×0.5 |

Veo 3.1 is left out: fal shows it is retired on 2026-11-17 with no successor named. Add it back when one is
published.

## Billing

- Seconds charged = `ceil(length × multiplier)`, at least 1. The multiplier is fal's price per second against the
  actor model's $0.16/s, rounded up to the next 0.5 (never below 0.5), so every clip costs us no more per allowance
  second than a UGC video does.
- Same allowance as remakes: monthly `REMAKE_SECONDS` per tier, then bought packs; `balance()` in `remake.ts` adds
  `studioClips` rows that count. Charged at start (`monthlySeconds` + `extraSeconds`), refunded by not counting
  failed or stale rows, exactly like `remakes`.
- Shared limits: one video or clip running per user (across both tables), `ATTEMPTS_PER_DAY` across both, all users'
  `REMAKES_PER_DAY` across both. Free accounts: "AI videos come with Pro."

## Backend

- `convex/lib/studio.ts` (pure, tested): `STUDIO_MODELS`, `chargeFor(model, length)`, `validateRequest(...)`
  (prompt length, model, length allowed, aspect allowed), `falInput(model, request, imageUrl, seed)` building each
  model's body.
- `convex/studio.ts`: `start` (mutation: checks as above, inserts `studioClips`, schedules `advance`), `advance`
  (internalAction: submit → poll every 10 s → copy the MP4 to storage; 20 min stale = failed; fal errors described
  with `describeFalError`), `mine` (query: My videos, both tables, paginated), `latest` (query: the running/last clip).
  Re-roll = `start` with the same fields and a new random seed (models without a seed just run again).
- Table `studioClips`: userId, model, prompt, imageId?, aspect, length, seed?, status
  (rendering | done | failed), job?, videoId?, error?, seconds, monthlySeconds, extraSeconds, startedAt, finishedAt?.
  Indexes by_user [userId, startedAt], by_started [startedAt].
- `convex/lib/fal.ts` is reused (`falSubmit`, `falStatus`, `falResult`, `videoUrlOf`).

## Errors

- fal refuses the prompt or photo: the clip fails with fal's described reason, no seconds used.
- Not enough seconds: "You have N seconds of AI video left." plus the Buy button, before anything runs.
- Missing `FAL_KEY`: "AI video isn't switched on yet (FAL_KEY)."

## Tests

- `convex/lib/studio.test.ts`: charges, validation, each model's fal body.
- `convex/studio.test.ts`: start/charge/limits shared with remakes, the pipeline with fal stubbed (like
  `remake.test.ts`), failure is free, re-roll, `mine` merges both tables.
- `src/pages/dashboard/studio/*.test.tsx`: tabs from the URL, the Remake tab with and without `?ad`, Playground
  shows each model's seconds and blocks Generate without a prompt, ad page shows the Open in AI Studio link.

## Not in v1

Two models side by side in one click, editing a clip, sending a playground clip into a UGC video, Veo.
