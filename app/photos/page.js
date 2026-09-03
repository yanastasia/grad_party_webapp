'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_SHOTS = 15;

export default function PhotosPage() {
  const [step, setStep] = useState('loading');
  const [name, setName] = useState('');
  const [shotsUsed, setShotsUsed] = useState(0);
  const [maxShots, setMaxShots] = useState(DEFAULT_MAX_SHOTS);
  const [facingMode, setFacingMode] = useState('environment');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoBlob, setPhotoBlob] = useState(null);
  const [caption, setCaption] = useState('');
  const [retakeUsed, setRetakeUsed] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [formError, setFormError] = useState('');
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const shotsLeft = maxShots - shotsUsed;

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      const data = await response.json();
      if (data.guest) {
        setName(data.guest.name);
        setShotsUsed(data.guest.photosUsed);
        setMaxShots(data.guest.photoLimit);
        setStep(data.guest.photosUsed >= data.guest.photoLimit ? 'finished' : 'camera');
      } else {
        setStep('name');
      }
    } catch {
      setStep('name');
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const startCamera = useCallback(async (mode = facingMode) => {
    stopCamera();
    setCameraError('');
    setIsStartingCamera(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
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
        } catch {
          // Keep the best resolution the browser already selected.
        }
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      console.error(error);
      setCameraError('Camera access is needed to take your party photos. Please allow camera permission and try again.');
    } finally {
      setIsStartingCamera(false);
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (step === 'camera') startCamera();
    return () => stopCamera();
  }, [step, facingMode, startCamera, stopCamera]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const handleStart = async (event) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    setFormError('');

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start camera');

      setName(data.guest.name);
      setShotsUsed(data.guest.photosUsed);
      setMaxShots(data.guest.photoLimit);
      setStep(data.guest.photosUsed >= data.guest.photoLimit ? 'finished' : 'camera');
    } catch (error) {
      setFormError(error.message);
    }
  };

  const switchCamera = () => {
    setFacingMode((current) => current === 'environment' ? 'user' : 'environment');
  };

  const mirrorBlob = async (blob) => {
    const bitmap = await createImageBitmap(blob);
    const canvas = canvasRef.current;
    if (!canvas) return blob;

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: false });
    context.setTransform(-1, 0, 0, 1, canvas.width, 0);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    context.setTransform(1, 0, 0, 1, 0, 0);

    return new Promise((resolve) => canvas.toBlob((result) => resolve(result || blob), 'image/jpeg', 1));
  };

  const captureBlob = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];

    if (track && typeof window !== 'undefined' && 'ImageCapture' in window) {
      try {
        const imageCapture = new window.ImageCapture(track);
        const blob = await imageCapture.takePhoto();
        if (blob?.size) return facingMode === 'user' ? await mirrorBlob(blob) : blob;
      } catch {
        // Safari/iOS often does not support ImageCapture; canvas is the fallback below.
      }
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { alpha: false });
    context.setTransform(1, 0, 0, 1, 0, 0);

    if (facingMode === 'user') {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    context.setTransform(1, 0, 0, 1, 0, 0);

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 1));
  };

  const takePhoto = async () => {
    if (shotsLeft <= 0) return;
    const blob = await captureBlob();
    if (!blob) return;

    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoBlob(blob);
    setPhotoUrl(URL.createObjectURL(blob));
    setCaption('');
    stopCamera();
    setStep('preview');
  };

  const retakePhoto = () => {
    if (retakeUsed) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoBlob(null);
    setCaption('');
    setRetakeUsed(true);
    setStep('camera');
  };

  const savePhoto = async () => {
    if (!photoBlob || isSaving) return;
    setIsSaving(true);
    setFormError('');

    try {
      const initResponse = await fetch('/api/photos/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mimeType: photoBlob.type || 'image/jpeg',
          size: photoBlob.size,
          caption: caption.trim() || null,
          retakeCount: retakeUsed ? 1 : 0,
        }),
      });
      const init = await initResponse.json();
      if (!initResponse.ok) throw new Error(init.error || 'Could not prepare upload');

      const driveResponse = await fetch(init.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': photoBlob.type || 'image/jpeg',
        },
        body: photoBlob,
      });
      if (!driveResponse.ok) throw new Error('The photo could not be uploaded to the party drive');
      const driveFile = await driveResponse.json();

      const completeResponse = await fetch('/api/photos/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: init.photoId, driveFileId: driveFile.id }),
      });
      const complete = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(complete.error || 'Could not finish saving the photo');

      setShotsUsed(complete.guest.photosUsed);
      setMaxShots(complete.guest.photoLimit);
      setStep(complete.guest.photosUsed >= complete.guest.photoLimit ? 'finished' : 'success');
    } catch (error) {
      console.error(error);
      setFormError(error.message || 'Could not save photo. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const takeAnother = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoBlob(null);
    setCaption('');
    setRetakeUsed(false);
    setFormError('');
    setStep('camera');
  };

  return (
    <main className="page-shell photo-page">
      <section className={`paper-card camera-card camera-card--${step}`}>
        <header className="camera-header">
          <Link className="text-link" href="/">← party menu</Link>
          {!['name', 'loading'].includes(step) && (
            <span className="shot-count">{shotsLeft} / {maxShots} shots left</span>
          )}
        </header>

        {step === 'loading' && <div className="intro-panel"><p className="script-line">loading your camera…</p></div>}

        {step === 'name' && (
          <div className="intro-panel">
            <p className="eyebrow">Disposable camera</p>
            <h1>Help us remember the night.</h1>
            <p className="script-line">fifteen little chances to catch it</p>
            <div className="camera-rules"><span>15 shots</span><span>1 retake each</span><span>optional note</span></div>
            <form className="name-form" onSubmit={handleStart}>
              <label htmlFor="guest-name">Your name</label>
              <input id="guest-name" name="guest-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ana" autoComplete="name" maxLength={60} required />
              {formError && <p className="form-error">{formError}</p>}
              <button className="primary-button" type="submit">Start my camera</button>
            </form>
            <p className="fine-print">No account. No app download. Photos go straight into our private party collection.</p>
          </div>
        )}

        {step === 'camera' && (
          <div className="camera-panel">
            <div className="camera-title-row">
              <div><p className="eyebrow">{name}&apos;s camera</p><h1>Make it count.</h1></div>
              <span className="handwritten-number">#{shotsUsed + 1}</span>
            </div>
            <div className="viewfinder-wrap">
              <div className="viewfinder">
                <video
                  ref={videoRef}
                  className="camera-video"
                  style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
                  autoPlay
                  playsInline
                  muted
                />
                {isStartingCamera && <div className="camera-overlay">opening camera…</div>}
                <span className="viewfinder-corner viewfinder-corner--tl" aria-hidden="true" /><span className="viewfinder-corner viewfinder-corner--tr" aria-hidden="true" /><span className="viewfinder-corner viewfinder-corner--bl" aria-hidden="true" /><span className="viewfinder-corner viewfinder-corner--br" aria-hidden="true" />
              </div>
              <p className="camera-hint">{facingMode === 'user' ? 'front camera · mirrored' : 'back camera'} · highest available camera quality</p>
            </div>
            {cameraError && <div className="error-box"><p>{cameraError}</p><button type="button" className="secondary-button" onClick={() => startCamera(facingMode)}>Try again</button></div>}
            <div className="camera-controls">
              <button className="icon-button" type="button" onClick={switchCamera} aria-label="Switch camera">↻</button>
              <button className="shutter-button" type="button" onClick={takePhoto} disabled={isStartingCamera || !!cameraError} aria-label="Take photo"><span /></button>
              <span className="control-spacer" aria-hidden="true" />
            </div>
            {retakeUsed && <p className="camera-hint">retake used for this shot</p>}
          </div>
        )}

        {step === 'preview' && photoUrl && (
          <div className="preview-panel">
            <div className="camera-title-row">
              <div><p className="eyebrow">Shot {shotsUsed + 1} of {maxShots}</p><h1>Keep this one?</h1></div>
              <span className="script-mini">{retakeUsed ? 'final take' : 'one retake'}</span>
            </div>
            <div className="photo-print">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="Your captured party photo" />
              <div className="photo-print-caption">05 · 09 · 26</div>
            </div>
            <label className="caption-field" htmlFor="caption">
              <span>Add a message or caption <em>optional</em></span>
              <textarea id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="leave a little note…" maxLength={220} rows={3} />
              <small>{caption.length} / 220</small>
            </label>
            {formError && <p className="form-error">{formError}</p>}
            <div className="preview-actions">
              <button className="secondary-button" type="button" onClick={retakePhoto} disabled={retakeUsed}>Retake</button>
              <button className="primary-button" type="button" onClick={savePhoto} disabled={isSaving}>{isSaving ? 'Saving…' : 'Keep photo'}</button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="success-panel">
            <div className="success-stamp" aria-hidden="true">✓</div><p className="eyebrow">Saved to the party drive</p><h1>That one&apos;s ours.</h1>
            <p className="script-line">developing somewhere behind the scenes</p>
            <div className="big-shot-count"><strong>{maxShots - shotsUsed}</strong><span>shots left</span></div>
            <button className="primary-button" type="button" onClick={takeAnother}>Take another</button>
            <Link className="text-link centered-link" href="/">Back to party menu</Link>
          </div>
        )}

        {step === 'finished' && (
          <div className="success-panel">
            <div className="success-stamp success-stamp--star" aria-hidden="true">✦</div><p className="eyebrow">Roll finished</p><h1>You used all {maxShots}.</h1>
            <p className="script-line">now go make more memories off-camera</p><p className="fine-print">Your photos are safely in the party collection.</p>
            <Link className="primary-button link-button" href="/">Back to party menu</Link>
          </div>
        )}

        <canvas ref={canvasRef} className="capture-canvas" aria-hidden="true" />
      </section>
    </main>
  );
}
