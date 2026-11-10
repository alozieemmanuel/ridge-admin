"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A live camera view that reads QR codes inside the page, so staff never leave the browser. Uses the browser's own QR reader where there
 * is one (Chrome on Android) and the small jsQR decoder everywhere else (iPhone, Windows, Mac). The camera stays on, so the next guest can be
 * scanned straight away; the same code is not reported again for a few seconds.
 * Needs a secure page (https) and the camera permission.
 */

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const REPEAT_MS = 4_000;
const FRAME_MS = 110;

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The camera is blocked. Allow the camera for this site in the browser's address bar, then press Scan again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return "The camera could not be started.";
}

export default function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const last = { text: "", at: 0 };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(window.isSecureContext ? "This browser cannot use the camera here." : "The camera only works on a secure (https) page.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (err) {
        setError(describeCameraError(err));
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const el = video.current!;
      el.srcObject = stream;
      el.setAttribute("playsinline", "true");
      await el.play().catch(() => {});
      setReady(true);

      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      let native: Detector | null = null;
      if (Native) {
        try {
          native = new Native({ formats: ["qr_code"] });
        } catch {
          native = null;
        }
      }
      const jsQR = native ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (stopped) return;
        try {
          if (el.readyState >= 2 && el.videoWidth) {
            let text = "";
            if (native) {
              text = (await native.detect(el))[0]?.rawValue ?? "";
            } else if (jsQR && ctx) {
              // A smaller picture is much faster to decode and is plenty for a QR code held in front of the camera.
              const scale = Math.min(1, 640 / el.videoWidth);
              canvas.width = Math.round(el.videoWidth * scale);
              canvas.height = Math.round(el.videoHeight * scale);
              ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? "";
            }
            const now = Date.now();
            if (text && (text !== last.text || now - last.at > REPEAT_MS)) {
              last.text = text;
              last.at = now;
              try {
                navigator.vibrate?.(80);
              } catch {
                // not available everywhere
              }
              handler.current(text);
            }
          }
        } catch {
          // a frame that cannot be read is skipped
        }
        timer = setTimeout(tick, FRAME_MS);
      };
      tick();
    }

    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="border border-border rounded-2xl overflow-hidden mb-6 bg-black">
      <div className="relative aspect-[4/3] sm:aspect-video">
        <video ref={video} muted playsInline className="absolute inset-0 w-full h-full object-cover" aria-label="Camera view" />
        {ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
            <div className="w-1/2 aspect-square rounded-2xl border-2 border-white/80" />
          </div>
        )}
        {!ready && !error && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting the camera…</p>}
        {error && <p className="absolute inset-0 flex items-center justify-center text-sm text-red-300 text-center p-6">{error}</p>}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-cardbg text-sm">
        <span className="text-muted">Hold the ticket&apos;s QR code in the frame. The next guest can be scanned straight after.</span>
        <button onClick={onClose} className="px-4 py-2 rounded-full border border-border hover:border-gold whitespace-nowrap">
          Stop camera
        </button>
      </div>
    </div>
  );
}
