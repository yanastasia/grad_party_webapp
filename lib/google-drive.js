let cachedToken = null;
let tokenExpiresAt = 0;

function getCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const originalsFolderId = process.env.GOOGLE_ORIGINALS_FOLDER_ID;
  const processedFolderId = process.env.GOOGLE_PROCESSED_FOLDER_ID;
  const sharedDriveId = process.env.GOOGLE_SHARED_DRIVE_ID;

  if (!clientId || !clientSecret || !refreshToken || !originalsFolderId || !processedFolderId) {
    throw new Error('Google Drive OAuth environment variables are not configured');
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    originalsFolderId,
    processedFolderId,
    sharedDriveId,
  };
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const { clientId, clientSecret, refreshToken } = getCredentials();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google OAuth refresh failed: ${response.status} ${detail}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function driveFetch(url, options = {}) {
  const token = await getAccessToken();
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
}

function driveQuery(params = {}) {
  const { sharedDriveId } = getCredentials();
  const query = new URLSearchParams({ supportsAllDrives: 'true', ...params });
  if (sharedDriveId) query.set('driveId', sharedDriveId);
  return query;
}

export async function createFolder(name, parentId) {
  const query = driveQuery({ fields: 'id,name' });
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Drive folder creation failed: ${response.status} ${detail}`);
  }
  return response.json();
}

export async function ensureGuestFolders(guest) {
  if (guest.originals_folder_id && guest.processed_folder_id) {
    return {
      originalsFolderId: guest.originals_folder_id,
      processedFolderId: guest.processed_folder_id,
    };
  }

  const { originalsFolderId, processedFolderId } = getCredentials();
  const [originals, processed] = await Promise.all([
    guest.originals_folder_id ? Promise.resolve({ id: guest.originals_folder_id }) : createFolder(guest.username, originalsFolderId),
    guest.processed_folder_id ? Promise.resolve({ id: guest.processed_folder_id }) : createFolder(guest.username, processedFolderId),
  ]);

  return {
    originalsFolderId: originals.id,
    processedFolderId: processed.id,
  };
}

export async function createResumableUpload({ name, mimeType, folderId, size }) {
  const token = await getAccessToken();
  const query = driveQuery({ uploadType: 'resumable', fields: 'id,name,size,mimeType' });
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files?${query}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, mimeType, parents: [folderId] }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Drive resumable upload initialization failed: ${response.status} ${detail}`);
  }

  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) throw new Error('Drive did not return a resumable upload URL');
  return uploadUrl;
}
