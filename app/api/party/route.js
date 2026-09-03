import { NextResponse, after } from 'next/server';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { addCaptionToPhoto, processPartyPhoto } from '../../../lib/photo-processing';

const sql = neon(process.env.DATABASE_URL);
const COOKIE_NAME = 'al_party_session';
const SESSION_DAYS = 7;
const CAPTIONED_FOLDER_ID = process.env.GOOGLE_CAPTIONED_FOLDER_ID || '1PeTblY4B_kkxdKXARmbi58tvcA2JuYa2';

export const maxDuration = 60;

function normalizeUsername(value = '') {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function validUsername(value = '') {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length >= 2 && trimmed.length <= 30 && /^[\p{L}\p{N}_\- ]+$/u.test(trimmed);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sessionCookie(token) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

async function getGuestFromRequest(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await sql`
    select g.id, g.username, g.photo_limit, g.photos_used,
           g.originals_folder_id, g.processed_folder_id
    from sessions s
    join guests g on g.id = s.guest_id
    where s.token_hash = ${tokenHash}
      and s.expires_at > now()
    limit 1
  `;
  if (!rows[0]) return null;
  await sql`update sessions set last_used_at = now() where token_hash = ${tokenHash}`;
  return rows[0];
}

async function createSession(guestId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  await sql`
    insert into sessions (guest_id, token_hash, expires_at)
    values (${guestId}, ${tokenHash}, now() + interval '7 days')
  `;
  return token;
}

async function googleAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth failed: ${data.error_description || data.error || response.status}`);
  }
  return data.access_token;
}

async function ensureDriveFolder({ accessToken, parentId, name }) {
  const safeName = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(`'${parentId}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const lookup = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const lookupData = await lookup.json();
  if (!lookup.ok) throw new Error(`Drive folder lookup failed: ${lookupData.error?.message || lookup.status}`);
  if (lookupData.files?.[0]?.id) return lookupData.files[0].id;

  const create = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const createData = await create.json();
  if (!create.ok) throw new Error(`Drive folder creation failed: ${createData.error?.message || create.status}`);
  return createData.id;
}

async function downloadDriveFile(accessToken, fileId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive download failed (${response.status}): ${text.slice(0, 240)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function uploadJpegToDrive({ accessToken, folderId, filename, buffer }) {
  const boundary = `al_party_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, buffer, tail]);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,mimeType', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    throw new Error(`Drive upload failed (${response.status}): ${data.error?.message || 'unknown error'}`);
  }
  return data;
}

async function createDerivedCopies({ driveFileId, processedFolderId, captionedFolderId, filename, photoId, caption }) {
  try {
    if (!processedFolderId) throw new Error('Processed folder is not configured for this guest.');

    const accessToken = await googleAccessToken();
    const originalBuffer = await downloadDriveFile(accessToken, driveFileId);
    const processed = await processPartyPhoto(originalBuffer, { seed: photoId });

    await uploadJpegToDrive({
      accessToken,
      folderId: processedFolderId,
      filename,
      buffer: processed.buffer,
    });

    const cleanCaption = String(caption || '').trim();
    if (cleanCaption && captionedFolderId) {
      const captionedBuffer = await addCaptionToPhoto(processed.buffer, cleanCaption);
      if (captionedBuffer) {
        await uploadJpegToDrive({
          accessToken,
          folderId: captionedFolderId,
          filename,
          buffer: captionedBuffer,
        });
      }
    }

    console.log(`Processed ${filename} with ${processed.preset} preset (luminance ${processed.luminance}). Captioned copy: ${cleanCaption ? 'yes' : 'no'}.`);
  } catch (processingError) {
    console.error('Automatic derived-copy generation failed:', processingError);
  }
}

function guestPayload(guest) {
  return {
    id: guest.id,
    username: guest.username,
    photoLimit: guest.photo_limit,
    photosUsed: guest.photos_used,
    photosLeft: Math.max(0, guest.photo_limit - guest.photos_used),
  };
}

function partyTimeStamp(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Skopje',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/:/g, '-');
}

export async function GET(request) {
  try {
    const guest = await getGuestFromRequest(request);
    return NextResponse.json({ guest: guest ? guestPayload(guest) : null });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  try {
    if (body.action === 'register') {
      const username = String(body.username || '').trim().replace(/\s+/g, ' ');
      if (!validUsername(username)) {
        return NextResponse.json({ error: 'Use 2–30 letters, numbers, spaces, _ or -.' }, { status: 400 });
      }
      const normalized = normalizeUsername(username);
      const existing = await sql`select id from guests where username_normalized = ${normalized} limit 1`;
      if (existing[0]) {
        return NextResponse.json({ error: 'That name is already registered. Log in if it is yours.' }, { status: 409 });
      }
      const rows = await sql`
        insert into guests (username, username_normalized, last_login_at)
        values (${username}, ${normalized}, now())
        returning id, username, photo_limit, photos_used
      `;
      const token = await createSession(rows[0].id);
      const response = NextResponse.json({ guest: guestPayload(rows[0]) });
      response.cookies.set(sessionCookie(token));
      return response;
    }

    if (body.action === 'login') {
      const normalized = normalizeUsername(String(body.username || ''));
      const rows = await sql`
        select id, username, photo_limit, photos_used
        from guests where username_normalized = ${normalized} limit 1
      `;
      if (!rows[0]) {
        return NextResponse.json({ error: "We couldn't find that name. Register first if you haven't joined yet." }, { status: 404 });
      }
      await sql`update guests set last_login_at = now() where id = ${rows[0].id}`;
      const token = await createSession(rows[0].id);
      const response = NextResponse.json({ guest: guestPayload(rows[0]) });
      response.cookies.set(sessionCookie(token));
      return response;
    }

    if (body.action === 'logout') {
      const token = request.cookies.get(COOKIE_NAME)?.value;
      if (token) await sql`delete from sessions where token_hash = ${hashToken(token)}`;
      const response = NextResponse.json({ ok: true });
      response.cookies.set({ name: COOKIE_NAME, value: '', path: '/', maxAge: 0 });
      return response;
    }

    const guest = await getGuestFromRequest(request);
    if (!guest) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 });

    if (body.action === 'startUpload') {
      if (guest.photos_used >= guest.photo_limit) {
        return NextResponse.json({ error: 'Your roll is finished.' }, { status: 409 });
      }

      const mimeType = String(body.mimeType || 'image/jpeg');
      const fileSize = Number(body.fileSize || 0);
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        return NextResponse.json({ error: 'Invalid photo size.' }, { status: 400 });
      }

      const accessToken = await googleAccessToken();
      let originalsFolderId = guest.originals_folder_id;
      let processedFolderId = guest.processed_folder_id;

      if (!originalsFolderId) {
        originalsFolderId = await ensureDriveFolder({
          accessToken,
          parentId: process.env.GOOGLE_ORIGINALS_FOLDER_ID,
          name: guest.username,
        });
      }
      if (!processedFolderId) {
        processedFolderId = await ensureDriveFolder({
          accessToken,
          parentId: process.env.GOOGLE_PROCESSED_FOLDER_ID,
          name: guest.username,
        });
      }
      if (!guest.originals_folder_id || !guest.processed_folder_id) {
        await sql`
          update guests
          set originals_folder_id = ${originalsFolderId}, processed_folder_id = ${processedFolderId}
          where id = ${guest.id}
        `;
      }

      const shotNumber = guest.photos_used + 1;
      const photoId = crypto.randomUUID();
      const filename = `${guest.username}_${partyTimeStamp()}.jpg`;

      await sql`
        insert into photos (id, guest_id, shot_number, caption, original_filename, mime_type, file_size_bytes, processing_status)
        values (${photoId}, ${guest.id}, ${shotNumber}, ${String(body.caption || '').slice(0, 200) || null}, ${filename}, ${mimeType}, ${fileSize}, 'uploading')
      `;

      const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,mimeType', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': mimeType,
          'x-upload-content-length': String(fileSize),
        },
        body: JSON.stringify({ name: filename, parents: [originalsFolderId] }),
      });

      if (!init.ok) {
        const text = await init.text();
        await sql`update photos set processing_status = 'failed' where id = ${photoId}`;
        throw new Error(`Drive upload session failed (${init.status}): ${text.slice(0, 300)}`);
      }
      const uploadUrl = init.headers.get('location');
      if (!uploadUrl) throw new Error('Google Drive did not return an upload session URL.');

      return NextResponse.json({ photoId, uploadUrl, filename, shotNumber });
    }

    if (body.action === 'finalizeUpload') {
      const photoId = String(body.photoId || '');
      const driveFileId = String(body.driveFileId || '');
      if (!photoId || !driveFileId) return NextResponse.json({ error: 'Missing upload result.' }, { status: 400 });

      const photoRows = await sql`
        select id, guest_id, shot_number, processing_status, original_filename, caption
        from photos where id = ${photoId} and guest_id = ${guest.id} limit 1
      `;
      if (!photoRows[0]) return NextResponse.json({ error: 'Photo record not found.' }, { status: 404 });

      let shouldProcess = false;
      if (photoRows[0].processing_status !== 'ready') {
        await sql`
          update photos
          set original_drive_file_id = ${driveFileId}, submitted_at = now(), processing_status = 'ready'
          where id = ${photoId}
        `;
        await sql`
          update guests
          set photos_used = least(photo_limit, photos_used + 1)
          where id = ${guest.id}
        `;
        shouldProcess = true;
      }

      const updated = await sql`
        select id, username, photo_limit, photos_used from guests where id = ${guest.id} limit 1
      `;

      if (shouldProcess) {
        const processedFolderId = guest.processed_folder_id;
        const filename = photoRows[0].original_filename;
        const caption = photoRows[0].caption;
        after(() => createDerivedCopies({
          driveFileId,
          processedFolderId,
          captionedFolderId: CAPTIONED_FOLDER_ID,
          filename,
          photoId,
          caption,
        }));
      }

      return NextResponse.json({ guest: guestPayload(updated[0]) });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Something went wrong.' }, { status: 500 });
  }
}
