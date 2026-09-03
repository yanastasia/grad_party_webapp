# Graduation Party Web App — Current PRD

_Last updated: 3 September 2026_

## Goal
A zero-install, mobile-first web app accessed through one QR code at Anastasia & Leona's graduation party on 5 September 2026.

Guests land on one party hub with two actions:
1. **Photo Booth**: custom browser-based disposable camera.
2. **Song Requests**: open the party's Dekk.fm room to request songs and vote.

The experience should feel lightweight, playful and visually continuous with the printed invitation, menu, QR card and stickers.

---

## 1. Party Hub
### Route: `/`

The printed QR code points here.

### Current content
- `Anastasia & Leona · 05.09.26`
- `Join the party`
- `Pick your side quest.`
- **Photo Booth**
  - `For the archives. Or the group chat.`
- **Song Requests**
  - `The dance floor is a democracy. Mostly.`

### Song destination
`https://dekk.fm/mix?room=a-l-xi`

### Copy rule
Do not repeat copy already printed on the physical QR card. The hub should stay sparse and keep only digital-only/witty supporting lines.

Removed from the hub intentionally:
- `Photos, songs, and good decisions optional.`
- `Take it. Send it. Keep the night alive.`
- `Up to 15 photos per guest.`
- `Request a song or vote for your favorites.`
- `STATE EXAM SURVIVOR · PARTY DEGREE IN PROGRESS`

---

## 2. Guest Identity
### Route: `/photos`

No app download, email, social login or password.

### Registration
- Guest chooses a unique name/alias.
- Length: 2–30 characters.
- Supported characters: letters, numbers, spaces, `_`, `-`.
- Name is normalized server-side for uniqueness.

### Returning guests
- Guest can log back in using the same registered name.
- Session is maintained using a secure HTTP-only cookie.
- Current session lifetime: 7 days.

---

## 3. Photo Allowance
- Default: **15 submitted photos per guest**.
- Limit is enforced server-side.
- A photo counts only after its Google Drive upload is finalized successfully.
- Retakes do **not** consume shots.
- Future admin controls may grant additional shots.

### Retakes
**Unlimited.**

After every capture the guest can:
- `Retake`
- `Keep this one`

The guest may retake indefinitely before accepting a photo. Only the photo they keep and successfully send counts toward the 15-photo allowance.

---

## 4. Camera Capture

### Requirements
- Request browser camera permission.
- Capture directly from the live camera, not from the existing photo library.
- Default to rear/environment camera.
- Allow switching between rear and front cameras.
- Request the highest practical resolution exposed by the device/browser.
- Preserve correct selfie mirroring.
- Do not intentionally downscale the captured frame.
- Export capture as JPEG at quality `1`.

### Current implementation
- Requests very high ideal camera dimensions.
- When supported, reads the video track's reported maximum width/height and applies those constraints.
- Captures the full `videoWidth × videoHeight` frame into canvas.
- Converts to JPEG using maximum canvas JPEG quality.

### Quality constraint
Mobile browsers may expose less than the phone's full native still-camera sensor resolution. Therefore the requirement is **highest practical browser capture quality**, not RAW/native camera parity.

---

## 5. Preview + Unlimited Retake Flow

1. Guest taps shutter.
2. Current camera frame is captured locally.
3. Camera stream stops.
4. Guest sees the captured image.
5. Guest chooses:
   - **Retake** → discard current local capture and reopen camera.
   - **Keep this one** → continue to caption/message.
6. Retake may repeat without limit.
7. Discarded captures are never uploaded and never recorded as consumed shots.

Current helper copy:
`Retake until it earns a place on the roll. Only the one you keep counts.`

---

## 6. Optional Caption / Message

After keeping a photo, the guest may add a short optional message.

### Current requirements
- Optional.
- Empty caption is valid.
- Maximum: **200 characters**.
- Stored with the photo record.
- Can be skipped quickly.

Current copy:
- `for the record...`
- `Add a little context.`
- `Optional, naturally`
- Placeholder: `A note, an inside joke, a weak alibi...`

---

## 7. Upload + Storage

### Current architecture
- Next.js App Router.
- Next.js route handlers.
- Neon Postgres for guests, sessions and photo metadata.
- Google Drive for photo storage.
- Resumable/chunked Drive upload.

### Upload flow
1. Guest keeps a photo and optionally adds a caption.
2. Client asks the server to start an upload.
3. Server validates that the guest still has available shots.
4. Server creates a photo row with `uploading` state.
5. Server creates a Google Drive resumable-upload session.
6. Client uploads the original JPEG in **2 MB chunks**.
7. Google Drive returns the file ID.
8. Client calls finalize.
9. Server marks the photo ready and increments `photos_used` exactly once.
10. Updated remaining-shot count is returned to the guest.

### Drive organization
Each guest receives:
- an **originals** folder under the configured originals parent folder;
- a corresponding **processed** folder under the configured processed-images parent folder.

### Original preservation
The submitted JPEG is the archival original and must never be destructively overwritten.

---

## 8. Current Photo Flow + Copy

### Login / register
- `Disposable camera · 15 shots`
- `Back for more?` / `Join the roll.`
- `Pick a name or alias. Mostly for credit. Slightly for accountability.`

### Camera
- Remaining-shot counter.
- Shutter.
- Front/rear camera switch.
- Back to party.
- Log out / switch guest.

### Preview
- `Retake`
- `Keep this one`
- Unlimited retakes.

### Caption
- Optional 200-character message.

### Uploading
- `still processing...`
- `Sending the evidence somewhere safe.`

### Success
- `Proof of attendance`
- `One for the archives.`
- `Saved. No context required, but appreciated.`
- `one more for the plot?`

### Roll complete
- `15 / 15 · final boss defeated`
- `Your roll is finished.`
- `Camera duties completed. May at least half of these be iconic.`
- `thank you for your service`

---

## 9. Automatic Photo Effect

### Desired effect
A subtle automatic vintage/disposable-camera treatment that matches the party visual system:
- warm film balance;
- slightly faded tonal range;
- softened highlights;
- restrained saturation;
- visible but tasteful grain;
- subtle vignette;
- slightly less digital sharpness.

### Requirements
- Original remains untouched.
- Processed image is a separate derivative.
- Effect is automatic, not manually chosen by guests.
- No beauty filter or AI face alteration.
- Treatment must be deterministic/reproducible for fallback batch processing.

### Current status
- Original uploads are implemented.
- Separate Drive folder structure for processed versions is already provisioned.
- Automatic derivative generation is **not yet implemented in the finalized upload flow**.

### Fallback
If live processing is unavailable or fails:
1. Continue saving originals normally.
2. Do not fail a guest submission solely because styling failed.
3. Mark derivative processing pending/failed.
4. Run the same preset as a post-party batch process.

---

## 10. Visual Design System

The app should look like an extension of the physical party materials, not a generic modern web app.

### Direction
- warm parchment / cream background;
- stronger paper grain;
- deep brown / charcoal ink;
- dusty rose / mauve accents;
- lavender, peach, ochre and muted olive secondary accents;
- editorial serif headings;
- handwritten/script accents;
- imperfect borders and hand-drawn lines;
- floral, light-string, mountain/sunset and scribble motifs;
- selective sticker-inspired language and visual details.

### Copy density
Keep screens concise. Especially on the hub, avoid repeating copy already visible on the physical QR card.

---

## 11. Non-goals for the Party MVP
- Native iOS/Android app.
- Email/password accounts.
- Social feed.
- Likes/comments.
- Public live gallery during the party.
- Guest-side manual filters/editing.
- Camera-roll upload as the main flow.

---

## 12. Next Priorities

### P0 — party critical
- Test full registration → camera → unlimited retake → caption → Drive upload flow on iPhone Safari.
- Test the same flow on Android Chrome.
- Verify returning guest behavior.
- Verify the 15-shot server-side limit.
- Test large/high-resolution photos on cellular or weak Wi-Fi.
- Confirm no shot is consumed on discarded retakes or failed uploads.

### P1
- Implement automatic processed-image generation while preserving originals.
- Save derivatives into each guest's processed Drive folder.

### P2
- Host/admin view for guests, shots used, captions and upload failures.
- Optional post-party gallery/export experience.

---

## 13. Acceptance Criteria

A guest can:
- scan one QR code;
- choose Photo Booth or Song Requests;
- open Dekk.fm with no app install;
- register with a name/alias;
- return using that identity;
- grant camera permission;
- switch front/rear camera;
- capture a high-quality image;
- preview it;
- retake an unlimited number of times without using a shot;
- keep a photo;
- optionally add a caption;
- submit it to Google Drive;
- consume exactly one of their 15 shots only after successful finalization;
- repeat until all 15 submitted photos are used.

The hosts receive each successfully submitted original photo in Google Drive, organized by guest, with the corresponding guest/caption metadata retained in the application database.
