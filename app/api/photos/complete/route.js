import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { getCurrentGuest } from '../../../../lib/session';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const guest = await getCurrentGuest();
    if (!guest) return NextResponse.json({ error: 'Session expired' }, { status: 401 });

    const { photoId, driveFileId } = await request.json();
    if (!photoId || !driveFileId) {
      return NextResponse.json({ error: 'Missing upload details' }, { status: 400 });
    }

    const sql = db();
    const rows = await sql`
      UPDATE photos
         SET original_drive_file_id = ${driveFileId},
             submitted_at = now(),
             processing_status = 'uploaded'
       WHERE id = ${photoId}
         AND guest_id = ${guest.id}
         AND submitted_at IS NULL
      RETURNING shot_number
    `;

    if (rows[0]) {
      await sql`
        UPDATE guests
           SET photos_used = GREATEST(photos_used, ${rows[0].shot_number})
         WHERE id = ${guest.id}
      `;
    }

    const current = await sql`
      SELECT username, photo_limit, photos_used
        FROM guests
       WHERE id = ${guest.id}
       LIMIT 1
    `;

    return NextResponse.json({
      guest: {
        name: current[0].username,
        photoLimit: current[0].photo_limit,
        photosUsed: current[0].photos_used,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not finalize photo upload' }, { status: 500 });
  }
}
