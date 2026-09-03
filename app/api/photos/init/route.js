import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { getCurrentGuest } from '../../../../lib/session';
import { createResumableUpload, ensureGuestFolders } from '../../../../lib/google-drive';

export const runtime = 'nodejs';

function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'guest';
}

export async function POST(request) {
  try {
    const guest = await getCurrentGuest();
    if (!guest) return NextResponse.json({ error: 'Session expired' }, { status: 401 });

    const { mimeType, size, caption, retakeCount = 0 } = await request.json();
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMime.includes(mimeType) || !Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: 'Invalid image metadata' }, { status: 400 });
    }
    if (String(caption || '').length > 220) {
      return NextResponse.json({ error: 'Caption is too long' }, { status: 400 });
    }
    if (retakeCount < 0 || retakeCount > 1) {
      return NextResponse.json({ error: 'Only one retake is allowed per shot' }, { status: 400 });
    }

    const sql = db();
    const current = await sql`
      SELECT id, username, photo_limit, photos_used, originals_folder_id, processed_folder_id
        FROM guests
       WHERE id = ${guest.id}
       LIMIT 1
    `;
    const freshGuest = current[0];
    if (!freshGuest || freshGuest.photos_used >= freshGuest.photo_limit) {
      return NextResponse.json({ error: 'Your camera roll is finished' }, { status: 409 });
    }

    const folders = await ensureGuestFolders(freshGuest);
    if (!freshGuest.originals_folder_id || !freshGuest.processed_folder_id) {
      await sql`
        UPDATE guests
           SET originals_folder_id = ${folders.originalsFolderId},
               processed_folder_id = ${folders.processedFolderId}
         WHERE id = ${freshGuest.id}
      `;
    }

    const shotNumber = freshGuest.photos_used + 1;
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const filename = `${String(shotNumber).padStart(2, '0')}-${safeFileName(freshGuest.username)}-${Date.now()}.${extension}`;

    const photoRows = await sql`
      INSERT INTO photos (
        guest_id, shot_number, caption, retake_count, original_filename,
        mime_type, file_size_bytes, processing_status
      ) VALUES (
        ${freshGuest.id}, ${shotNumber}, ${caption || null}, ${retakeCount}, ${filename},
        ${mimeType}, ${size}, 'uploading'
      )
      ON CONFLICT (guest_id, shot_number) DO UPDATE SET
        caption = EXCLUDED.caption,
        retake_count = EXCLUDED.retake_count,
        original_filename = EXCLUDED.original_filename,
        mime_type = EXCLUDED.mime_type,
        file_size_bytes = EXCLUDED.file_size_bytes,
        processing_status = 'uploading'
      WHERE photos.submitted_at IS NULL
      RETURNING id
    `;

    if (!photoRows[0]) {
      return NextResponse.json({ error: 'This shot has already been submitted' }, { status: 409 });
    }

    const uploadUrl = await createResumableUpload({
      name: filename,
      mimeType,
      folderId: folders.originalsFolderId,
      size,
    });

    return NextResponse.json({
      photoId: photoRows[0].id,
      shotNumber,
      uploadUrl,
      filename,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not prepare photo upload' }, { status: 500 });
  }
}
