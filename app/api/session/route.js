import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';
import { createSessionForGuest, getCurrentGuest } from '../../../lib/session';

export const runtime = 'nodejs';

function normalizeName(value) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export async function GET() {
  try {
    const guest = await getCurrentGuest();
    if (!guest) return NextResponse.json({ guest: null });
    return NextResponse.json({
      guest: {
        id: guest.id,
        name: guest.username,
        photoLimit: guest.photo_limit,
        photosUsed: guest.photos_used,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not load session' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) {
      return NextResponse.json({ error: 'Please enter a valid name' }, { status: 400 });
    }

    const normalized = normalizeName(name);
    const sql = db();
    const rows = await sql`
      INSERT INTO guests (username, username_normalized, last_login_at)
      VALUES (${name}, ${normalized}, now())
      ON CONFLICT (username_normalized)
      DO UPDATE SET last_login_at = now()
      RETURNING id, username, photo_limit, photos_used
    `;

    const guest = rows[0];
    await createSessionForGuest(guest.id);

    return NextResponse.json({
      guest: {
        id: guest.id,
        name: guest.username,
        photoLimit: guest.photo_limit,
        photosUsed: guest.photos_used,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not start your camera' }, { status: 500 });
  }
}
