'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const CHUNK_SIZE = 2 * 1024 * 1024;

function ArrowLeftIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SwitchCameraIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d="M4.5 8.5A8 8 0 0 1 18 5.6L20 8M20 8V3.5M20 8h-4.5M19.5 15.5A8 8 0 0 1 6 18.4L4 16M4 16v4.5M4 16h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

async function api(body) {
  const response = await fetch('/api/party', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export default function PhotosPage() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [guest, setGuest] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [authError, setAuthError] = useState('');

  const [facingMode, setFacingMode] = useState('environment');
  const [cameraError, setCameraError] = useState('');
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [stage, setStage] = useState('camera');
  const [caption, setCaption] = useState('');
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    if (!guest || stage !== 'camera' || guest.photosLeft <= 0) return;
    startCamera();
    return stopCamera;
  }, [guest, facingMode, stage]);

  useEffect(() => () => {
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }

  async function startCamera() {
    setCameraError('');
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 7680 },
          height: { ideal: 4320 },
        },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.();
      if (capabilities?.width?.max && capabilities?.height?.max) {
        try {
          await track.applyConstraints({
            width: { ideal: capabilities.width.max },
            height: { ideal: capabilities.height.max },
          });
        } catch {}
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      console.error(error);
      setCameraError('Camera access is needed for your honorary photographer duties. Please allow it in your browser settings.');
    }
  }

  async function handleAuth(event) {
    event.preventDefault();
    setAuthError('');
    try {
      const data = await api({ action: authMode, username });
      setGuest(data.guest);
      setUsername('');
      setStage(data.guest.photosLeft > 0 ? 'camera' : 'exhausted');
    } catch (error) {
      setAuthError(error.message);
    }
  }

  async function logout() {
    await api({ action: 'logout' }).catch(() => {});
    stopCamera();
    setGuest(null);
    setAuthMode('login');
    setStage('camera');
    setCaption('');
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    stopCamera();

    canvas.toBlob(blob => {
      if (!blob) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setCapturedBlob(blob);
      setPreviewUrl(url);
      setStage('preview');
    }, 'image/jpeg', 1);
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setCapturedBlob(null);
    setCaption('');
    setSendError('');
    setStage('camera');
  }

  async function uploadInChunks(uploadUrl, blob) {
    let driveFile = null;
    for (let start = 0; start < blob.size; start += CHUNK_SIZE) {
      const endExclusive = Math.min(start + CHUNK_SIZE, blob.size);
      const chunk = blob.slice(start, endExclusive);
      const response = await fetch('/api/upload-chunk', {
        method: 'PUT',
        headers: {
          'x-upload-url': uploadUrl,
          'content-range': `bytes ${start}-${endExclusive - 1}/${blob.size}`,
          'content-type': blob.type || 'image/jpeg',
        },
        body: chunk,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
      if (data.done) driveFile = data.file;
    }
    if (!driveFile?.id) throw new Error('Google Drive did not confirm the uploaded file.');
    return driveFile;
  }

  async function sendPhoto() {
    if (!capturedBlob) return;
    setSendError('');
    setStage('sending');
    try {
      const started = await api({
        action: 'startUpload',
        caption,
        mimeType: capturedBlob.type || 'image/jpeg',
        fileSize: capturedBlob.size,
      });
      const driveFile = await uploadInChunks(started.uploadUrl, capturedBlob);
      const finalized = await api({
        action: 'finalizeUpload',
        photoId: started.photoId,
        driveFileId: driveFile.id,
      });
      setGuest(finalized.guest);
      setStage(finalized.guest.photosLeft > 0 ? 'success' : 'exhausted');
    } catch (error) {
      setSendError(error.message);
      setStage('caption');
    }
  }

  function anotherPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setCapturedBlob(null);
    setCaption('');
    setSendError('');
    setStage('camera');
  }

  if (!guest) {
    return (
      <main className="page partyPage">
        <div className="doodle doodleFlowers" aria-hidden="true" />
        <div className="scribble scribbleOne" aria-hidden="true" />
        <section className="centerStage">
          <div className="authWrap">
            <p className="eyebrow">Disposable camera · 15 shots</p>
            <h1 className="authTitle">{authMode === 'login' ? 'Back for more?' : 'Join the roll.'}</h1>
            <p className="muted">{authMode === 'login' ? 'Enter the name you registered with.' : 'Pick a name or alias. Mostly for credit. Slightly for accountability.'}</p>

            <form className="authForm" onSubmit={handleAuth}>
              <label className="fieldLabel" htmlFor="username">Who’s behind the camera?</label>
              <input
                id="username"
                className="textInput"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="off"
                inputMode="text"
                maxLength={30}
                required
              />
              <button className="primaryBtn fullBtn" type="submit">{authMode === 'login' ? 'Continue' : 'Start my roll'}</button>
            </form>

            {authError && <p className="errorText">{authError}</p>}

            <p className="authSwitch muted">
              {authMode === 'login' ? "First time here? " : 'Already joined? '}
              <button className="textBtn" type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>
                {authMode === 'login' ? 'Register' : 'Log in'}
              </button>
            </p>
            <Link className="textBtn small" href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeftIcon />Back to party home</Link>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'exhausted' || guest.photosLeft <= 0) {
    return (
      <main className="page partyPage">
        <section className="centerStage">
          <div className="exhaustedStage">
            <p className="successMark">♡</p>
            <p className="eyebrow">15 / 15 · final boss defeated</p>
            <h1>Your roll is finished.</h1>
            <p className="muted">Camera duties completed. May at least half of these be iconic.</p>
            <p className="script">thank you for your service</p>
            <Link className="secondaryBtn fullBtn" href="/">Back to the party</Link>
            <button className="textBtn small" type="button" onClick={logout}>Not {guest.username}? Log out</button>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'sending') {
    return (
      <main className="page partyPage">
        <section className="centerStage">
          <div className="sendingStage">
            <div className="developing">still processing...</div>
            <div className="developDot" aria-hidden="true" />
            <p className="muted" style={{ textAlign: 'center', marginTop: 18 }}>Sending the evidence somewhere safe.</p>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'success') {
    return (
      <main className="page partyPage">
        <section className="centerStage">
          <div className="successStage">
            <p className="successMark">♡</p>
            <p className="eyebrow">Proof of attendance</p>
            <h1>One for the archives.</h1>
            <p className="muted">Saved. No context required, but appreciated.</p>
            <p className="successCounter"><strong>{guest.photosLeft} / {guest.photoLimit}</strong><br /><span className="eyebrow">shots left</span></p>
            <p className="inspiration">one more for the plot?</p>
            <button className="primaryBtn fullBtn" type="button" onClick={anotherPhoto}>Take another</button>
            <Link className="textBtn small" href="/">Back to party home</Link>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'caption') {
    return (
      <main className="page partyPage">
        <section className="centerStage">
          <div className="captionStage">
            <p className="script">for the record...</p>
            <h1>Add a little context.</h1>
            <p className="eyebrow">Optional, naturally</p>
            <textarea
              className="captionInput"
              value={caption}
              onChange={e => setCaption(e.target.value.slice(0, 200))}
              placeholder="A note, an inside joke, a weak alibi..."
              maxLength={200}
            />
            <div className="captionCount">{caption.length}/200</div>
            {sendError && <p className="errorText">{sendError}</p>}
            <div className="captionActions">
              <button className="secondaryBtn" type="button" onClick={() => setStage('preview')}>Back</button>
              <button className="primaryBtn" type="button" onClick={sendPhoto}>Send it</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'preview') {
    return (
      <main className="page partyPage">
        <section className="cameraShell">
          <div className="cameraTop">
            <div className="counter"><strong>{guest.photosLeft} / {guest.photoLimit}</strong><span>shots left</span></div>
          </div>
          <div className="cameraViewport">
            <div className="cameraFrame"><img src={previewUrl} alt="Your captured photo preview" /></div>
          </div>
          <div className="previewActions">
            <button className="secondaryBtn" type="button" onClick={retake}>Retake</button>
            <button className="primaryBtn" type="button" onClick={() => setStage('caption')}>Keep this one</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page partyPage">
      <section className="cameraShell">
        <div className="cameraTop">
          <div className="counter"><strong>{guest.photosLeft} / {guest.photoLimit}</strong><span>shots left</span></div>
        </div>

        <div className="cameraViewport">
          <div className="cameraFrame">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
            />
            <canvas ref={canvasRef} hidden />
          </div>
        </div>

        {cameraError && <p className="errorText">{cameraError}</p>}

        <div className="cameraControls">
          <Link className="controlBtn" href="/" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><ArrowLeftIcon />Party</Link>
          <button className="shutterBtn" type="button" aria-label="Take photo" onClick={capturePhoto} />
          <button className="controlBtn" type="button" onClick={() => setFacingMode(mode => mode === 'environment' ? 'user' : 'environment')} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><SwitchCameraIcon />Switch</button>
        </div>

        <button className="textBtn small" type="button" onClick={logout}>Not {guest.username}? Log out</button>
      </section>
    </main>
  );
}