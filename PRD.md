# Graduation Party Web App — PRD v1

## Goal
A zero-install mobile web app accessed through one QR code. Guests land on a party hub with two actions:
1. Request and vote for songs via Dekk.fm.
2. Open a custom disposable-camera experience.

The product should remain simple and mobile-first. Visual styling can evolve separately from the functional requirements below.

## Hub
### Route: `/`
Requirements:
- This is the URL encoded in the printed party QR code.
- Link to the Dekk.fm party room for song requests and voting.
- Link to `/photos` for the disposable camera.
- Functional on mobile first, with desktop compatibility.

## Disposable Camera
### Entry
Route: `/photos`
- No app download.
- Guest identifies themselves by name.
- No email or social account required.
- Guest identity must persist so returning guests keep the same photo allowance.
- Names must distinguish guests reliably enough to prevent accidental reuse.

### Photo allowance
- Default: 15 accepted photos per guest.
- Count is enforced server-side, not only in browser state.
- A retake does not consume a shot.
- Only a photo that is kept/sent counts toward the 15-photo limit.
- Future admin controls may grant additional shots.

### Camera capture
- Request browser camera permission.
- Support front and rear camera switching.
- Capture directly from the camera rather than the existing photo library.
- Optimize for the highest practical source quality supported by the device/browser.
- Request high ideal camera resolution without deliberately imposing a low cap.
- Prefer a true still-photo capture API such as `ImageCapture.takePhoto()` when available.
- Fall back to capturing the highest-resolution available video frame when required.
- Avoid unnecessary lossy re-encoding or resizing of the archival original.
- Preserve image orientation/mirroring correctly, including front-camera selfies.

### Review and retake
After pressing the shutter:
- Show the captured image preview.
- Actions:
  - `Retake`
  - `Keep photo`
- Retake returns to the camera without decrementing the guest's allowance.
- Keep photo proceeds to the optional caption/message step.

### Optional caption / message
After keeping a photo, the guest may add a short optional caption/message.
- Caption is optional.
- Empty caption is valid.
- Suggested maximum: 200–280 characters.
- Caption is stored with the photo.
- Guest can send quickly without writing anything.

### Upload sequence
Preferred flow:
1. Guest captures photo locally.
2. Guest reviews it.
3. Guest retakes or keeps it.
4. Guest optionally adds a caption/message.
5. Server validates/reserves the available shot.
6. Original image uploads.
7. Photo metadata and caption are saved.
8. Upload is finalized and the guest's remaining count is updated.
9. Guest receives a clear success state.

If an upload fails after reservation, the system must support retry/reconciliation rather than silently losing the guest's allowance.

### Upload quality
- Originals should be stored at the highest practical capture quality.
- No intentional low-resolution compression before archival upload.
- Any future display/effect version must be a separate derivative.
- The original must remain recoverable.

### Weak reception / resilience
Target behavior for a later hardening phase:
- Preserve pending accepted photos locally using IndexedDB if an upload cannot complete.
- Retry when connectivity returns.
- Never store image blobs in localStorage.
- Clearly communicate pending vs successfully uploaded states.

## Photo data
Suggested fields:

### Guests
- id
- username/name
- session token
- photo limit
- photos used
- created at
- last active at

### Photos
- id
- guest id
- shot number
- original storage identifier/path
- optional processed storage identifier/path
- caption nullable
- captured at
- uploaded at
- upload/processing status
- width
- height
- MIME type
- byte size

## Automatic visual effect
A party-film treatment may be applied automatically later.

Requirements:
- Original image remains untouched.
- Effect is applied to a derivative copy only.
- Effect should be automatic, not manually applied photo by photo.
- Treatment should remain subtle and compatible with the party visual identity, for example:
  - warm film balance
  - restrained grain
  - softened highlights
  - subtle vignette
- No beauty filter or AI face alteration.
- Processing configuration should be reproducible so the same treatment can be applied later in a fallback batch process if live processing fails.

### Processing fallback
If live processing fails:
1. Keep every original upload safely stored.
2. Mark derivative processing as pending/failed.
3. Run a deterministic batch-processing script after the party.
4. Generate final processed copies without modifying the originals.

## Gallery
Not required for the initial functional flow.

Future options:
- delayed reveal after the party
- host-only gallery
- guest gallery
- captions displayed with images
- download/export originals
- download/export processed variants

## Admin — later
- Host-only access.
- Guest list.
- Photos used / allowance.
- Increase photo limit.
- Photo gallery.
- Failed upload/processing status.
- Export and download tools.

## Current technical direction
- Next.js App Router.
- Vercel deployment through GitHub integration.
- Server-side guest/photo state.
- Google Drive archival/upload flow is supported by the current implementation.
- Runtime storage/database implementation may evolve, but original-quality preservation and server-side shot enforcement are non-negotiable requirements.

## Acceptance criteria for the core photo flow
- Guest can reach the site by QR code with no install.
- Guest can identify/register themselves by name.
- Returning guest can resume their allowance.
- Guest can grant camera permission and switch cameras.
- Guest can take a high-quality photo.
- Guest can preview and retake without losing a shot.
- Guest can keep a photo and optionally add a caption/message.
- Successful upload consumes exactly one shot.
- Maximum is 15 accepted photos per guest by default.
- Uploaded originals are preserved at the highest practical quality.
- Host receives the uploaded photo and associated caption/guest metadata.
