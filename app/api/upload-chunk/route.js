import { NextResponse } from 'next/server';

export async function PUT(request) {
  try {
    const uploadUrl = request.headers.get('x-upload-url');
    const contentRange = request.headers.get('content-range');
    const contentType = request.headers.get('content-type') || 'application/octet-stream';

    if (!uploadUrl || !contentRange) {
      return NextResponse.json({ error: 'Missing upload session headers.' }, { status: 400 });
    }

    const body = await request.arrayBuffer();
    const google = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-length': String(body.byteLength),
        'content-range': contentRange,
        'content-type': contentType,
      },
      body,
      redirect: 'manual',
    });

    if (google.status === 308) {
      return NextResponse.json({ done: false, range: google.headers.get('range') }, { status: 200 });
    }

    const text = await google.text();
    if (!google.ok) {
      return NextResponse.json({ error: `Google Drive chunk failed (${google.status}): ${text.slice(0, 500)}` }, { status: 502 });
    }

    let file = null;
    try { file = JSON.parse(text); } catch {}
    return NextResponse.json({ done: true, file });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Chunk upload failed.' }, { status: 500 });
  }
}
