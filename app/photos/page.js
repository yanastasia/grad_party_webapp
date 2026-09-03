'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_SHOTS = 15;

function blobFromCanvas(canvas, type = 'image/jpeg', quality = 1) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export default function PhotosPage() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [guest, setGuest] = useState(null);
  const [name, setName] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const [facingMode, setFacingMode] = useState('environment');
  const [cameraError, setCameraError] = useState('');
  const [cameraLoading, setCameraLoading] = useState(false);

  const [stage, setStage] = useState('camera');
  const [photoBlob, setPhotoBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [retakeUsed, setRetakeUsed] = useState(false);
  const [sendError, setSendError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError('');
    setCameraLoading(true);

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
      setCameraError('Camera access is needed to take photos. Please allow camera access in your browser settings.');
    } finally {
      setCameraLoading(false);
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    fetch('/api/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.guest) {
          setGuest(data.guest);
          if (data.guest.photosUsed >= data.guest.photoLimit) setStage('exhausted');
        }
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!guest || stage !== 'camera' || guest.photosUsed >= guest.photoLimit) return;
    startCamera();
    return stopCamera;
  }, [guest, stage, facingMode, startCamera, stopCamera]);

  useEffect(() => () => {
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl, stopCamera]);

  async function handleStart(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    setAuthError('');

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: cleanName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start your camera.');
      setGuest(data.guest);
      setName('');
      setStage(data.guest.photosUsed >= data.guest.photoLimit ? 'exhausted' : 'camera');
    } catch (error) {
      setAuthError(error.message);
    }
  }

  async function mirrorBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = canvasRef.current;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    bitmap.close?.();
    return blobFromCanvas(canvas, 'image/jpeg', 1);
  }

  async function capturePhoto() {
    const track = streamRef.current?.getVideoTracks?.()[0];
    let blob = null;

    if (track && typeof window !== 'undefined' && 'ImageCapture' in window) {
      try {
        const capture = new window.ImageCapture(track);
        blob = await capture.takePhoto();
      } catch {}
    }

    if (!blob) {
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
      blob = await blobFromCanvas(canvas, 'image/jpeg', 1);
    } else if (facingMode === 'user') {
      blob = await mirrorBlob(blob);
    }

    if (!blob) return;
    stopCamera();

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(blob);
    setPhotoBlob(blob);
    setPreviewUrl(url);
    setCaption('');
    setStage('preview');
  }

  function retake() {
    if (retakeUsed) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPhotoBlob(null);
    setCaption('');
    setSendError('');
    setRetakeUsed(true);
    setStage('camera');
  }

  async function savePhoto() {
    if (!photoBlob || isSaving) return;
    setIsSaving(true);
    setSendError('');
    setStage('sending');

    try {
      const initResponse = await fetch('/api/photos/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mimeType: photoBlob.type || 'image/jpeg',
          size: photoBlob.size,
          caption: caption.trim() || null,
          retakeCount: retakeUsed ? 1 : 0,
        }),
      });
      const init = await initResponse.json();
      if (!initResponse.ok) throw new Error(init.error || 'Could not prepare upload.');

      const driveResponse = await fetch(init.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': photoBlob.type || 'image/jpeg' },
        body: photoBlob,
      });
      if (!driveResponse.ok) throw new Error('The photo could not be uploaded to the party drive.');
      const driveFile = await driveResponse.json();

      const completeResponse = await fetch('/api/photos/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photoId: init.photoId, driveFileId: driveFile.id }),
      });
      const complete = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(complete.error || 'Could not finish saving the photo.');

      setGuest(complete.guest);
      setStage(complete.guest.photosUsed >= complete.guest.photoLimit ? 'exhausted' : 'success');
    } catch (error) {
      console.error(error);
      setSendError(error.message || 'Could not save photo. Please try again.');
      setStage('caption');
    } finally {
      setIsSaving(false);
    }
  }

  function anotherPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPhotoBlob(null);
    setCaption('');
    setRetakeUsed(false);
    setSendError('');
    setStage('camera');
  }

  if (authLoading) {
    return <main className="page"><section className="centerStage"><p className="eyebrow">A&amp;L</p><p className="script">one second...</p></section></main>;
  }

  if (!guest) {
    return (
      <main className="page">
        <section className="centerStage">
          <div className="authWrap">
            <p className="eyebrow">Disposable camera</p>
            <h1 className="authTitle">Help us remember the night.</h1>
            <p className="muted">You get 15 shots, one retake for each, and an optional little note.</p>

            <form className="authForm" onSubmit={handleStart}>
              <label className="fieldLabel" htmlFor="guest-name">Your name</label>
              <input
                id="guest-name"
                className="textInput"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={60}
                required
              />
              <button className="primaryBtn fullBtn" type="submit">Start my camera</button>
            </form>

            {authError && <p className="errorText">{authError}</p>}
            <Link className="textBtn small" href="/">← Back to party home</Link>
          </div>
        </section>
      </main>
    );
  }

  const photosLeft = Math.max(0, guest.photoLimit - guest.photosUsed);

  if (stage === 'exhausted' || photosLeft <= 0) {
    return (
      <main className="page">
        <section className="exhaustedStage">
          <p className="successMark">♡</p>
          <p className="eyebrow">{guest.photoLimit} / {guest.photoLimit}</p>
          <h1>That's your roll.</h1>
          <p className="muted">{guest.photoLimit} moments captured. Thanks for helping us remember the night.</p>
          <Link className="secondaryBtn fullBtn" href="/">Back to party home</Link>
        </section>
      </main>
    );
  }

  if (stage === 'sending') {
    return (
      <main className="page">
        <section className="sendingStage">
          <div className="developing">developing...</div>
          <div className="developDot" aria-hidden="true" />
          <p className="muted" style={{ textAlign: 'center', marginTop: 18 }}>Sending your photo.</p>
        </section>
      </main>
    );
  }

  if (stage === 'success') {
    return (
      <main className="page">
        <section className="successStage">
          <p className="successMark">♡</p>
          <p className="eyebrow">Sent</p>
          <h1>One for the memories.</h1>
          <p className="muted">Your photo is safely in the party collection.</p>
          <p className="successCounter"><strong>{photosLeft} / {guest.photoLimit}</strong><br /><span className="eyebrow">shots left</span></p>
          <p className="inspiration">feeling inspired?</p>
          <button className="primaryBtn fullBtn" type="button" onClick={anotherPhoto}>Take another</button>
          <Link className="textBtn small" href="/">Back to party home</Link>
        </section>
      </main>
    );
  }

  if (stage === 'caption') {
    return (
      <main className="page">
        <section className="captionStage">
          <p className="script">say something...</p>
          <h1>Add something to this one.</h1>
          <p className="eyebrow">Optional</p>
          <textarea
            className="captionInput"
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 220))}
            placeholder="A note, an inside joke, anything."
            maxLength={220}
          />
          <div className="captionCount">{caption.length}/220</div>
          {sendError && <p className="errorText">{sendError}</p>}
          <div className="captionActions">
            <button className="secondaryBtn" type="button" onClick={() => setStage('preview')}>Back</button>
            <button className="primaryBtn" type="button" onClick={savePhoto} disabled={isSaving}>{isSaving ? 'Saving…' : 'Send photo'}</button>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'preview') {
    return (
      <main className="page">
        <section className="cameraShell">
          <div className="cameraTop">
            <div className="counter"><strong>{photosLeft} / {guest.photoLimit}</strong><span>shots left</span></div>
          </div>
          <div className="cameraViewport">
            <div className="cameraFrame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Your captured photo preview" />
            </div>
          </div>
          <div className="previewActions">
            <button className="secondaryBtn" type="button" onClick={retake} disabled={retakeUsed}>{retakeUsed ? 'Retake used' : 'Retake'}</button>
            <button className="primaryBtn" type="button" onClick={() => setStage('caption')}>Keep photo</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="cameraShell">
        <div className="cameraTop">
          <div className="counter"><strong>{photosLeft} / {guest.photoLimit}</strong><span>shots left</span></div>
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
            {cameraLoading && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff8ee', fontSize: 13 }}>opening camera…</div>}
            <canvas ref={canvasRef} hidden />
          </div>
        </div>

        {cameraError && <p className="errorText">{cameraError}</p>}

        <div className="cameraControls">
          <Link className="controlBtn" href="/">← Back</Link>
          <button className="shutterBtn" type="button" aria-label="Take photo" onClick={capturePhoto} disabled={cameraLoading || !!cameraError} />
          <button className="controlBtn" type="button" onClick={() => setFacingMode((mode) => mode === 'environment' ? 'user' : 'environment')}>↻ Switch</button>
        </div>

        {retakeUsed && <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>retake used for this shot</p>}
      </section>
    </main>
  );
}
