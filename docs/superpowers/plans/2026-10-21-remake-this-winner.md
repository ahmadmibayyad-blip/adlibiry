# Remake This Winner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an ad's page, after "Write my version" has produced a script, the user picks an AI actor, a voice and a product photo and gets a finished 9:16 MP4 ad: the actor speaks the script, with AI product shots cut in.

**Architecture:** A new `remakes` table holds one row per video with a small state machine (`voicing → rendering → composing → done | failed`). The `remake.start` mutation checks the user's monthly allowance in seconds and schedules `remake.advance`. That internal action reschedules itself every 10 s until the row reaches `done` or `failed`. Each line of the script becomes one segment. ElevenLabs voices every line. fal.ai renders actor lines with OmniHuman (portrait + line audio, lip-synced) and product lines with Seedance image-to-video (product photo). fal's ffmpeg compose then joins the segments on one timeline. The final MP4 is copied into Convex storage, because fal's links expire.

**Tech Stack:** Convex (queries/mutations/actions, scheduler, file storage), fal.ai queue REST API called with plain `fetch` (no new npm dependency), ElevenLabs (existing `lib/voiceover.ts`), React + Tailwind UI, vitest + convex-test.

**Spec:** No separate spec doc. The design came from the 2026-10-21 Arcads teardown conversation and is pinned in *Design decisions* below. Arcads findings are in memory `arcads-teardown.md`.

## Design decisions (the spec)

- Entry point: the existing `WriteVariant` box in `src/pages/dashboard/ad-spy/_components/AdVideoAnalysis.tsx`. "Make the video" appears under the script, after `<Voiceover>`. The script itself is not saved today; the client sends the `Variant` it holds.
- One segment per script line that has voice-over text. Line 0 is always `actor`. A later line is `product` when its `scene` matches `/product|close-?up|unbox|demo|hands?|b-?roll|packag|show(s|ing)? (it|the)/i`, up to `MAX_PRODUCT_SHOTS = 2`. Every other line is `actor`.
- Actors: 8 synthetic, AI-generated portraits shipped as static files `public/actors/<id>.jpg`. Never a real person's face. fal reads them from `${appUrl()}/actors/<id>.jpg`.
- Allowance: AI-video seconds per calendar month (UTC), summed from the user's remakes that didn't fail. A failed remake costs nothing. Per `byTier` tier (`lib/billing.ts`; Pro at €35/month is the only paid plan): `REMAKE_SECONDS = { admin: null /* unlimited */, paid: 60, trial: 15, free: 0 }`, each overridable by Convex env `REMAKE_SECONDS_PAID` / `_TRIAL` / `_FREE`. 60 s of OmniHuman costs about $10, under a third of a Pro payment. **Business defaults: confirm them with the user before merging.**
- All users together: at most `REMAKES_PER_DAY` (default `30`) remakes per day; admins are exempt. One remake running per user at a time.
- Limits per remake: at most `MAX_LINES = 12` lines and `MAX_SECONDS = 45` estimated seconds. Product photo ≤ 8 MB, `image/jpeg|png|webp`.
- Output: 9:16, 720p (OmniHuman `resolution: "720p"`, Seedance `resolution: "720p", aspect_ratio: "9:16"`).
- The UI states under the finished video: "Made with AI. Mark it as AI-generated when you run it as an ad."
- Not in v1: captions, credit top-ups, saved scripts, more than 8 actors, custom actors, translation.

## Global Constraints

- Secrets: `FAL_KEY` (new) and `ELEVENLABS_API_KEY` (exists) in Convex Production. Without `FAL_KEY`, `remake.start` throws `NOT_CONFIGURED`: "AI video isn't switched on yet (FAL_KEY)."
- fal queue API: `POST https://queue.fal.run/<model>` with header `Authorization: Key <FAL_KEY>` and the input as the JSON body. The reply holds `request_id`, `status_url` and `response_url`. Poll `status_url` until `status === "COMPLETED"`, then GET `response_url`. Always use the returned URLs; never build them from the model id (sub-path models answer under their base app id).
- Model ids live in `FAL_MODELS` in `convex/lib/fal.ts`: actor `fal-ai/bytedance/omnihuman/v1.5` (env `FAL_ACTOR_MODEL`), product `fal-ai/bytedance/seedance/v1/pro/image-to-video` (env `FAL_PRODUCT_MODEL`), compose `fal-ai/ffmpeg-api/compose`.
- OmniHuman costs $0.16 per second (fal page, 2026-10-21).
- ElevenLabs output `mp3_44100_128` is constant bit rate, so seconds = bytes × 8 / 128000.
- Repo rules (memory `adspy-pro-git-setup`): commit with `git -c user.name="ahmadmibayyad-blip" -c user.email="ahmadmibayyad@gmail.com" commit`. Run tests as `npx vitest run --maxWorkers=4`. Don't use `Array.prototype.at()` in `convex/`. Use `new Uint8Array(buf)` as a test Response body. Write scripts containing apostrophes with the Write tool, not heredocs.
- Never ask for API keys in chat (repo CLAUDE.md). Tell the user where to put them.
- New Convex modules (`remake`, `lib/remake`, `lib/fal`) must be added by hand to `convex/_generated/api.d.ts` (import line + entry, alphabetical), as CLAUDE.md describes.
- Work only in worktree `C:\Users\ahmad\adlibiry-remake` (branch `claude/remake-winner`). Link node_modules with `cmd //c mklink //J node_modules ..\adlibiry\node_modules`. Remove that junction with `cmd //c rmdir node_modules` before any `git worktree remove`.
- User-facing errors are `ConvexError({ code, message })` in plain words, like the rest of `convex/`.

## Review Focus

1. A product "photo" that's a 40 MB video or a PDF → `start` refuses it ("Upload a JPG, PNG or WebP photo under 8 MB.") before spending anything. Test in Task 4.
2. A fal job that never finishes → after `STALE_MS = 20 min` the remake becomes `failed` ("The video took too long. Try again; it didn't use your seconds."), and its seconds no longer count. Test in Task 5.
3. Double-clicking "Make the video" → the second `start` while one is running throws `BUSY` ("Your last video is still being made."). Test in Task 4.
4. fal rejects the product photo (safety checker, 422) → `failed` with "The AI video service refused this photo. Try a plain product photo." and no seconds used. Test in Task 5.
5. A script with blank voice-over lines, or too long → blank lines are dropped; more than 45 s estimated is refused ("Shorten the script to about 45 seconds."). Test in Task 2 (dropping) and Task 4 (refusal).

---

### Task 1: fal spike: confirm the API shapes and how compose treats a video's own audio

No repo code. This decides one constant, `COMPOSE_KEEPS_VIDEO_AUDIO`, used in Task 2. The user must first create a fal.ai account, add about $5 of credit, and hand over a key.

**Files:**
- Create (scratchpad, not repo): `fal-spike.mjs`

- [ ] **Step 1: Ask the user to save their fal key** in `C:\Users\ahmad\fal-key.txt` (one line), not in chat. Also ask them to set it as `FAL_KEY` in the Convex Production deployment (dashboard → Settings → Environment Variables).
- [ ] **Step 2: Write `fal-spike.mjs`**. It reads the key from that file. It (a) submits OmniHuman with `image_url` = any public portrait, `audio_url` = a public 3–5 s MP3, `resolution: "720p"`; (b) polls `status_url` every 5 s and prints the result JSON; (c) submits compose with one video track (that clip, `timestamp: 0`, `duration` = clip ms) and **no** audio track; (d) prints the compose result.
- [ ] **Step 3: Run it** with `node fal-spike.mjs`. Expected: OmniHuman result has `video.url` and `duration`; compose result has `video_url`.
- [ ] **Step 4: Download the compose output** and check whether the speech is audible (`ffprobe` shows an audio stream, or play it). Record the answer: audible → `COMPOSE_KEEPS_VIDEO_AUDIO = true`; silent → `false`. Also record the real result field names if they differ from the Global Constraints, and fix the constraints before Task 2.

### Task 2: Pure remake rules (`convex/lib/remake.ts`)

**Files:**
- Create: `convex/lib/remake.ts`
- Modify: `convex/lib/billing.ts` (export the existing `type PlanUser`)
- Test: `convex/lib/remake.test.ts`

**Interfaces:**
- Produces:
  - `REMAKE_ACTORS: { id: string; name: string; gender: "female" | "male" }[]`, eight entries: maya, sofia, emma, aisha (female); liam, noah, omar, lucas (male)
  - `MAX_LINES = 12`, `MAX_SECONDS = 45`, `MAX_PRODUCT_SHOTS = 2`, `STALE_MS = 20 * 60_000`, `POLL_MS = 10_000`, `COMPOSE_KEEPS_VIDEO_AUDIO: boolean` (from Task 1)
  - `type SegmentKind = "actor" | "product"`
  - `type Segment = { kind: SegmentKind; text: string; scene: string; audioId?: string; audioUrl?: string; audioSeconds?: number; statusUrl?: string; responseUrl?: string; videoUrl?: string }`
  - `planShots(lines: { scene: string; voiceover: string }[]): Segment[]`
  - `estimateSeconds(lines: { voiceover: string }[]): number`: per line `max(1, words / 2.5)`, sum, rounded up
  - `mp3Seconds(bytes: number): number`: `bytes * 8 / 128000`, 2 decimals
  - `seedanceDuration(seconds: number): string`: `ceil`, clamped to 2–12, as a string
  - `productPrompt(scene: string, product: string): string`
  - `REMAKE_SECONDS: Record<Tier, number | null> = { admin: null, paid: 60, trial: 15, free: 0 }`
  - `remakeSecondsLimit(user: PlanUser | null, env: Record<string, string | undefined>): number | null` (null = unlimited): `byTier(user, REMAKE_SECONDS)`, then the env override `REMAKE_SECONDS_<TIER uppercased>` when it's a non-negative number (admin is never overridden)
  - `monthStart(now: number): number` (UTC first-of-month, ms)
  - `composeTracks(segments: Segment[], keepVideoAudio: boolean): { id: string; type: "video" | "audio"; keyframes: { url: string; timestamp: number; duration: number }[] }[]`

- [ ] **Step 1: Write the failing tests**

```ts
it("drops blank lines and starts with the actor", () => {
  const s = planShots([{ scene: "Close-up of the product", voiceover: "Look at this" }, { scene: "x", voiceover: "  " }, { scene: "Hands unboxing it", voiceover: "Opening it" }]);
  expect(s.map((x) => x.kind)).toEqual(["actor", "product"]);
});
it("caps product shots at 2", () => {
  const lines = Array.from({ length: 5 }, (_, i) => ({ scene: "product demo", voiceover: `line ${i}` }));
  expect(planShots(lines).filter((x) => x.kind === "product")).toHaveLength(2);
});
it("estimates 2.5 words a second, at least 1 s a line", () => {
  expect(estimateSeconds([{ voiceover: "one two three four five" }, { voiceover: "hi" }])).toBe(3);
});
it("reads CBR mp3 length", () => expect(mp3Seconds(80_000)).toBe(5));
it("clamps seedance duration", () => {
  expect(seedanceDuration(0.4)).toBe("2"); expect(seedanceDuration(4.2)).toBe("5"); expect(seedanceDuration(30)).toBe("12");
});
it("gives each tier its monthly seconds", () => {
  expect(remakeSecondsLimit({ role: "admin" }, {})).toBeNull();
  expect(remakeSecondsLimit({ plan: "pro", subscriptionStatus: "active" }, {})).toBe(60);
  expect(remakeSecondsLimit({ plan: "pro", subscriptionStatus: "active" }, { REMAKE_SECONDS_PAID: "90" })).toBe(90);
  expect(remakeSecondsLimit({ plan: "pro", subscriptionStatus: "active" }, { REMAKE_SECONDS_PAID: "lots" })).toBe(60);
  expect(remakeSecondsLimit({ proTrialEndsAt: Date.now() + 60_000 }, {})).toBe(15);
  expect(remakeSecondsLimit({}, {})).toBe(0);
});
it("lays segments end to end", () => {
  const segs = [{ kind: "actor", text: "", scene: "", audioUrl: "a1", audioSeconds: 2, videoUrl: "v1" }, { kind: "product", text: "", scene: "", audioUrl: "a2", audioSeconds: 3.5, videoUrl: "v2" }] as Segment[];
  const [video, audio] = composeTracks(segs, true);
  expect(video.keyframes).toEqual([{ url: "v1", timestamp: 0, duration: 2000 }, { url: "v2", timestamp: 2000, duration: 3500 }]);
  expect(audio.keyframes).toEqual([{ url: "a2", timestamp: 2000, duration: 3500 }]); // actor audio rides in its own clip
  expect(composeTracks(segs, false)[1].keyframes).toHaveLength(2);
});
```

- [ ] **Step 2: Run** `npx vitest run convex/lib/remake.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** everything in the Interfaces block in `convex/lib/remake.ts`. Add a top comment in the house style saying what the feature is and which file uses it. `productPrompt` returns `` `${scene}. The product: ${product}. Vertical phone video, natural light, realistic, no text on screen.` ``, trimmed to 600 chars.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(remake): pure rules for AI video remakes`.

### Task 3: fal queue client (`convex/lib/fal.ts`)

**Files:**
- Create: `convex/lib/fal.ts`
- Test: `convex/lib/fal.test.ts`

**Interfaces:**
- Produces:
  - `FAL_QUEUE_URL = "https://queue.fal.run"`, `FAL_MODELS: { actor: string; product: string; compose: string }` (env overrides read at call time via `falModels(env)`)
  - `type FalJob = { statusUrl: string; responseUrl: string }`
  - `falSubmit(key: string, model: string, input: unknown): Promise<FalJob>`
  - `falStatus(key: string, job: FalJob): Promise<"pending" | "done">`: `IN_QUEUE`/`IN_PROGRESS` → pending, `COMPLETED` → done; anything else throws `FalError`
  - `falResult(key: string, job: FalJob): Promise<unknown>`
  - `videoUrlOf(body: unknown): string | null`: reads `video.url` or `video_url`
  - `class FalError extends Error { status: number; body: unknown }`
  - `describeFalError(status: number, body: unknown, admin: boolean): string`: 401/403 → "The AI video service refused the key. Check FAL_KEY in Convex."; 402 or /balance|credit/ → "The AI video service is out of credit."; 422 → "The AI video service refused this photo. Try a plain product photo."; 429 → "The AI video service is busy. Try again in a minute."; else "The AI video failed. Try again." Admins also get `` ` (fal: <detail first 160 chars>)` ``.

- [ ] **Step 1: Write the failing tests.** Stub `fetch` with `vi.stubGlobal`. Assert: `falSubmit` POSTs to `https://queue.fal.run/fal-ai/x` with header `Authorization: Key k` and the JSON body, and returns `{ statusUrl, responseUrl }` from `status_url`/`response_url`; `falStatus` maps the three statuses and throws `FalError` on a 500; `videoUrlOf({ video: { url: "u" } }) === "u"` and `videoUrlOf({ video_url: "w" }) === "w"`; `describeFalError(422, {}, false)` gives the photo message, and with `admin: true` and body `{ detail: "nsfw" }` ends with `(fal: nsfw)`.
- [ ] **Step 2: Run** `npx vitest run convex/lib/fal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `fetch` and `AbortSignal.timeout(30_000)`. Non-2xx → `throw new FalError(status, parsed body)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(remake): fal.ai queue client`.

### Task 4: Table, upload, start and read queries (`convex/remake.ts`)

**Files:**
- Modify: `convex/schema.ts` (add next to `voiceovers`/`videoAnalyses`, around line 752)
- Create: `convex/remake.ts`
- Test: `convex/remake.test.ts`

**Interfaces:**
- Consumes: Task 2 (`planShots`, `estimateSeconds`, `remakeSecondsLimit`, `monthStart`, `REMAKE_ACTORS`, `MAX_LINES`, `MAX_SECONDS`, `STALE_MS`), `stableToken` (`lib/authIdentity`), `Variant` (`lib/videoAnalysis`).
- Produces:
  - table `remakes`: `{ userId: v.id("users"), adId: v.id("ads"), status: v.string() /* voicing|rendering|composing|done|failed */, actorId: v.string(), voiceId: v.string(), product: v.string(), productImageId: v.id("_storage"), segments: v.any() /* Segment[] */, seconds: v.number() /* estimate, then real */, composeJob: v.optional(v.any()), videoId: v.optional(v.id("_storage")), error: v.optional(v.string()), startedAt: v.number(), finishedAt: v.optional(v.number()) }`, indexes `by_user` `["userId", "startedAt"]`, `by_user_ad` `["userId", "adId", "startedAt"]`, `by_started` `["startedAt"]`
  - `remake.uploadUrl` mutation `() => string` (signed-in only)
  - `remake.start` mutation `{ adId, variant: v.any(), actorId, voiceId, product, productImageId } => Id<"remakes">`
  - `remake.allowance` query `() => { limit: number | null; used: number }`
  - `remake.latestForAd` query `{ adId } => { _id; status; error: string | null; videoUrl: string | null; seconds: number } | null`. A stale `voicing|rendering|composing` row (older than `STALE_MS`) reads as `failed`.
  - internal `remake.load` query, `remake.patch` mutation `{ remakeId, fields: v.any() }`
  - `usedSeconds(rows)` counts every row this month except `failed` and stale ones.

- [ ] **Step 1: Write the failing tests** (convex-test, same setup as `voiceover.test.ts`, with `FAL_KEY` stubbed):
  - pro user, valid input → returns an id, the row is `voicing`, and `ctx.scheduler` has `remake.advance` queued
  - no `FAL_KEY` → `NOT_CONFIGURED`
  - free user → `LIMIT` "AI videos come with Pro."
  - pro user with 58 s used this month and a 5 s script → `LIMIT` "You have 2 seconds of AI video left this month."
  - row already `rendering` for this user → `BUSY` "Your last video is still being made." (Review Focus 3)
  - script estimated at 60 s → `TOO_LONG` "Shorten the script to about 45 seconds." (Review Focus 5)
  - stored file is `application/pdf` or 9 MB → `BAD_PHOTO` "Upload a JPG, PNG or WebP photo under 8 MB." (Review Focus 1; use `ctx.storage.store` with a Blob of that type and size)
  - unknown `actorId` → `BAD_REQUEST` "Pick an actor from the list."
  - a `failed` row from earlier this month doesn't count in `allowance().used`
- [ ] **Step 2: Run** `npx vitest run convex/remake.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `start`, validate `variant.lines` (array, ≤ `MAX_LINES`, strings trimmed ≤ 400), product (3–200 chars) and `voiceId` (`/^[A-Za-z0-9]{8,40}$/`). Check the photo with `ctx.db.system.get("_storage", id)` (`contentType`, `size`). Then check allowance, the daily ceiling (`by_started`, admins exempt) and busy. Insert with `segments = planShots(lines)` and `seconds = estimateSeconds(lines)`, then `ctx.scheduler.runAfter(0, internal.remake.advance, { remakeId })`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(remake): remakes table, start with monthly AI-video allowance`.

### Task 5: The pipeline (`remake.advance`)

**Files:**
- Modify: `convex/remake.ts` (add `advance` internalAction; split it into a new `convex/remakeRun.ts` if `remake.ts` passes ~300 lines)
- Test: `convex/remake.test.ts`

**Interfaces:**
- Consumes: Task 3 (`falSubmit`, `falStatus`, `falResult`, `videoUrlOf`, `FalError`, `describeFalError`, `falModels`), Task 2 (`mp3Seconds`, `seedanceDuration`, `productPrompt`, `composeTracks`, `COMPOSE_KEEPS_VIDEO_AUDIO`, `POLL_MS`, `STALE_MS`), `ELEVEN_URL`/`ELEVEN_MODEL`/`ELEVEN_FORMAT`/`describeElevenError` (`lib/voiceover`), `appUrl` (`lib/billing`).
- Produces: `remake.advance` internalAction `{ remakeId }`. Each call does one step and reschedules itself after `POLL_MS` unless the row is `done` or `failed`:
  - `voicing`: for each segment, ElevenLabs TTS (same request as `voiceover.make`) → `ctx.storage.store` → `audioId`, `audioUrl` (`storage.getUrl`), `audioSeconds = mp3Seconds(bytes)`. Then submit fal jobs: actor → `{ image_url: `${appUrl()}/actors/${actorId}.jpg`, audio_url, resolution: "720p" }`; product → `{ prompt: productPrompt(scene, product), image_url: productPhotoUrl, duration: seedanceDuration(audioSeconds), resolution: "720p", aspect_ratio: "9:16", camera_fixed: false }`. Save `statusUrl`/`responseUrl` and set `seconds` = the sum of `audioSeconds` → `rendering`.
  - `rendering`: `falStatus` for each segment without `videoUrl`. When done, `falResult` + `videoUrlOf`. Once all segments have a `videoUrl`, submit compose `{ tracks: composeTracks(segments, COMPOSE_KEEPS_VIDEO_AUDIO) }` → `composeJob` → `composing`.
  - `composing`: when done, fetch `videoUrlOf(result)` → `ctx.storage.store(blob "video/mp4")` → `videoId`, `done`, `finishedAt`.
  - Any `FalError` → `failed` with `describeFalError(status, body, isAdmin)`. ElevenLabs non-OK → `failed` with `describeElevenError`. `Date.now() - startedAt > STALE_MS` → `failed` "The video took too long. Try again; it didn't use your seconds."

- [ ] **Step 1: Write the failing tests** with `vi.stubGlobal("fetch", ...)`, routing by URL (`api.elevenlabs.io` → 80 000-byte `audio/mpeg`; `queue.fal.run/...` → `{ request_id, status_url, response_url }`; `status_url` → `COMPLETED`; `response_url` → `{ video: { url: "https://fal.media/v.mp4" } }` or `{ video_url: ... }`; `fal.media/...` → small `video/mp4` bytes):
  - driving `advance` three times (`t.action(internal.remake.advance, ...)` each time) takes a 2-line remake to `done` with a `videoId`, and `seconds === 10`
  - the compose POST body's video track has 2 keyframes at 0 and 5000 ms
  - fal submit answers 422 → `failed` with the photo message, and `allowance().used` is 0 (Review Focus 4)
  - `startedAt` set 21 min ago while `rendering` → `failed` with the too-long message (Review Focus 2)
- [ ] **Step 2: Run** `npx vitest run convex/remake.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `advance` as above. Re-read the row at the start of every call and stop if it's `done`/`failed` (scheduled duplicates are harmless).
- [ ] **Step 4: Run** `npx vitest run convex/remake.test.ts`, then `npx tsc -p convex --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(remake): voice, render and compose pipeline on fal.ai`.

### Task 6: The 8 actor portraits

**Files:**
- Create: `public/actors/{maya,sofia,emma,aisha,liam,noah,omar,lucas}.jpg`
- Test: `convex/lib/remake.test.ts` (add one test)

- [ ] **Step 1: Write the failing test**: for each `REMAKE_ACTORS` id, `fs.existsSync("public/actors/<id>.jpg")` is true and the file is under 400 KB.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Generate** each portrait with an image model (Higgsfield or Gemini). Prompt: "Photorealistic portrait of a fictional, AI-generated <age 22–40> <gender> person, phone selfie UGC style, looking at the camera, head and shoulders, plain bright home background, 9:16". Mix ages and ethnicities across the 8. Never use a real person or a reference face. Save as 720×1280 JPEG, quality 85.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(remake): eight synthetic AI actor portraits`.

### Task 7: "Make the video" UI

**Files:**
- Create: `src/pages/dashboard/ad-spy/_components/RemakeVideo.tsx`
- Modify: `src/pages/dashboard/ad-spy/_components/AdVideoAnalysis.tsx` (render `<RemakeVideo adId={adId} variant={variant} product={product} />` right after `<Voiceover …/>` in `WriteVariant`)
- Test: `src/pages/dashboard/ad-spy/_components/RemakeVideo.test.tsx`

**Interfaces:**
- Consumes: `api.remake.uploadUrl`, `api.remake.start`, `api.remake.allowance`, `api.remake.latestForAd`, `api.voiceover.voices`, `REMAKE_ACTORS`.
- Produces: `export default function RemakeVideo(props: { adId: Id<"ads">; variant: Variant; product: string })`

- [ ] **Step 1: Write the failing tests** (Testing Library, `convex/react` hooks mocked as in existing component tests):
  - with `allowance = { limit: 60, used: 20 }` it shows "40 s of AI video left this month"
  - with `limit: 0` it shows "AI videos come with Pro." and an upgrade link to `/pricing`, with no Make button
  - "Make the video" is disabled until an actor and a photo are chosen
  - `latestForAd` `status: "rendering"` shows "Making the actor and product shots… (2–5 min)"
  - `status: "done"` with `videoUrl` renders a `<video>` with that src, a Download link, and the text "Made with AI. Mark it as AI-generated when you run it as an ad."
  - `status: "failed"` shows the error and a "Try again" button
- [ ] **Step 2: Run** `npx vitest run src/pages/dashboard/ad-spy/_components/RemakeVideo.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Match the look of `WriteVariant` (border-t section, `Clapperboard` icon, `BOX` cards). The actor picker is a grid of 8 `/actors/<id>.jpg` thumbnails with the selected one ringed. The voice uses `FilterSelect` filled from `api.voiceover.voices`. The photo upload POSTs the file to `uploadUrl()` and keeps the returned `storageId`, accepting `image/jpeg,image/png,image/webp`. Status labels: voicing "Recording the voice…", rendering "Making the actor and product shots… (2–5 min)", composing "Putting the video together…". Errors go through `errorMessage` and `toast.error`.
- [ ] **Step 4: Run** the test, then `npx tsc --noEmit` and `npx eslint src/pages/dashboard/ad-spy/_components`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(remake): Make the video on the ad page`.

### Task 8: Full check and PR

- [ ] **Step 0: Document the feature** in `CLAUDE.md` under *Data*, after the Video analysis bullet, in the same style: entry point, `remakes` states, fal models, `FAL_KEY`, `REMAKE_SECONDS` per tier + env overrides, `REMAKES_PER_DAY`, failed = free, actors in `public/actors`. Commit `docs: Remake this winner in CLAUDE.md`.
- [ ] **Step 1: Run** `npx vitest run --maxWorkers=4`. Expected: all green (apart from the known local-only `src/lib/renderApi.test.ts` in junction worktrees).
- [ ] **Step 2: Merge-check**: `git fetch` then `git merge-tree --write-tree origin/main claude/remake-winner`. Expected: no conflicts.
- [ ] **Step 3: Push** `git push -u origin claude/remake-winner`. Give the user the compare link `https://github.com/ahmadmibayyad-blip/adlibiry/compare/main...claude/remake-winner`. Once the PR is open, check CI via `/commits/<sha>/check-runs`.
- [ ] **Step 4: Tell the user what to set before merging:** `FAL_KEY` in Convex Production, and confirm the monthly second defaults (trial 15, Pro 60). After merge, make one real 2–3-line remake on adspypro.net and watch the Convex dashboard Logs while it runs.
