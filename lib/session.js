import crypto from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';

const COOKIE_NAME = 'golden_hour_session';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSessionForGuest(guestId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date('2026-09-07T23:59:59+02:00');
  const sql = db();

  await sql`
    INSERT INTO sessions (guest_id, token_hash, expires_at)
    VALUES (${guestId}, ${tokenHash}, ${expiresAt.toISOString()})
  `;

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function getCurrentGuest() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const sql = db();
  const rows = await sql`
    SELECT g.id, g.username, g.photo_limit, g.photos_used,
           g.originals_folder_id, g.processed_folder_id
      FROM sessions s
      JOIN guests g ON g.id = s.guest_id
     WHERE s.token_hash = ${hashToken(token)}
       AND s.expires_at > now()
     LIMIT 1
  `;

  if (!rows[0]) return null;

  await sql`
    UPDATE sessions
       SET last_used_at = now()
     WHERE token_hash = ${hashToken(token)}
  `;

  return rows[0];
}
