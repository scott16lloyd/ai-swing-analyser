'use client';
import { DominantHandSelector } from '@/components/dominant-hand-selector';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { getSupportedMimeType } from '@/lib/videoUtils';
import { createClient } from '@/utils/supabase/client';
import { useRouter } from 'next/navigation';
import Webcam from 'react-webcam';

type DominantHand = 'left' | 'right';

function AnalysePage() {
  // Webcam component
  const webcamRef = useRef<Webcam | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [dominantHand, setDominantHand] = useState<DominantHand>('right');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const router = useRouter();

  // Check authentication on component mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          // Use client-side navigation instead of server-side redirect
          router.push('/sign-in');
          return;
        }

        // User is authenticated, we can proceed
        setIsLoading(false);
      } catch (error) {
        console.error('Error checking authentication:', error);
        router.push('/sign-in');
      }
    };

    checkAuth();
  }, [router]);

  // Handler for changing dominant hand
  const handleDominantHandChange = useCallback((hand: DominantHand) => {
    setDominantHand(hand);
  }, []);

  const toggleCamera = useCallback(() => {
    setFacingMode((prevMode) => (prevMode === 'user' ? 'environment' : 'user'));
  }, []);

  const handleStartCaptureClick = useCallback(() => {
    setCapturing(true);
    if (webcamRef.current && webcamRef.current.stream) {
      const mimeType = getSupportedMimeType();
      mediaRecorderRef.current = new MediaRecorder(webcamRef.current.stream, {
        mimeType: mimeType,
      });

      mediaRecorderRef.current?.addEventListener(
        'dataavailable',
        handleDataAvailable
      );
      mediaRecorderRef.current.start();
    }
  }, [webcamRef, setCapturing, mediaRecorderRef]);

  const handleDataAvailable = useCallback(
    ({ data }: { data: Blob }) => {
      console.log('Data available, size:', data.size);
      if (data.size > 0) {
        setRecordedChunks((prev) => prev.concat(data));

        // Check if capturing is stopped
        if (!capturing) {
          console.log('Creating blob and navigating');

          // Create new blob, convert to data URI and navigate to edit page
          const blob = new Blob([data], { type: data.type });

          // Store the blob in IndexedDB
          const request = indexedDB.open('VideoDatabase', 1);

          request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('videos')) {
              db.createObjectStore('videos', { keyPath: 'id' });
            }
          };

          request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const transaction = db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');

            // Store the video with ID 'currentVideo'
            store.put({ id: 'currentVideo', blob: blob, type: data.type });

            transaction.oncomplete = () => {
              sessionStorage.setItem('videoMimeType', data.type);
              sessionStorage.setItem('needsRefresh', 'true');
              sessionStorage.setItem('videoStored', 'true'); // Flag to indicate video is in IndexedDB
              router.push('/analyse/edit');
            };
          };

          request.onerror = (event) => {
            console.error('IndexedDB error:', event);
            // Fallback for very small videos
            try {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUri = reader.result as string;
                sessionStorage.setItem('recordedVideo', dataUri);
                router.push('/analyse/edit');
              };
              reader.readAsDataURL(blob);
            } catch (e) {
              console.error('Failed to store video: ', e);
            }
          };
        }
      }
    },
    [setRecordedChunks, capturing, router]
  );

  const handleStopCaptureClick = useCallback(() => {
    console.log('Stop button clicked');
    if (mediaRecorderRef.current) {
      try {
        // First update UI state so the button appears disabled
        setCapturing(false);

        // Store dominantHand in sessionStorage
        sessionStorage.setItem('dominantHand', dominantHand);
        console.log(`Stored dominant hand: ${dominantHand}`);

        // Then stop the recorder
        mediaRecorderRef.current.stop();
        console.log('MediaRecorder stopped');

        // Set refresh flag now rather than in the data handler
        sessionStorage.setItem('needsRefresh', 'true');
      } catch (err) {
        console.error('Error stopping recording:', err);
      }
    }
  }, [mediaRecorderRef, setCapturing, dominantHand]);

  const handleDownload = useCallback(() => {
    if (recordedChunks.length) {
      const blob = new Blob(recordedChunks, {
        type: 'video/',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      a.href = url;
      a.download = 'react-webcam-stream-capture.webm';
      a.click();
      window.URL.revokeObjectURL(url);
      setRecordedChunks([]);
    }
  }, [recordedChunks]);

  // Caputre duration timer
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (capturing) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedTime(0);
    }

    return () => clearInterval(interval);
  });

  // Format the timer
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden touch-none p-4">
      {/* Webcam component */}
      <Webcam
        audio={false}
        ref={webcamRef}
        className="rounded-lg h-full w-auto object-cover overscroll-none"
        mirrored={facingMode === 'user'}
        videoConstraints={{
          facingMode: facingMode,
        }}
      />

      {/* Frame Corner Indicators */}
      {/* Top Left Corner */}
      <div className="absolute top-8 left-8 pointer-events-none">
        <div className="w-16 h-16 border-t-4 border-l-4 border-white rounded-tl-lg"></div>
      </div>

      {/* Silhouette image under top left corner - with cache busting and direct style */}
      <div className="absolute top-14 left-8 pointer-events-none">
        <img
          src="/player-driver-silhoutte-min.png"
          alt="Player/Driver Silhouette"
          width={100}
          height={160}
        />
      </div>

      {/* Top Right Corner */}
      <div className="absolute top-8 right-8 pointer-events-none">
        <div className="w-16 h-16 border-t-4 border-r-4 border-white rounded-tr-lg"></div>
      </div>

      {/* Bottom Left Corner */}
      <div className="absolute bottom-32 left-8 pointer-events-none">
        <div className="w-16 h-16 border-b-4 border-l-4 border-white rounded-bl-lg"></div>
      </div>

      {/* Bottom Right Corner */}
      <div className="absolute bottom-32 right-8 pointer-events-none">
        <div className="w-16 h-16 border-b-4 border-r-4 border-white rounded-br-lg"></div>
      </div>

      {/* Timer component */}
      {capturing && (
        <div className="absolute top-4 right-4 bg-red-500 bg-opacity-90 text-white px-3 py-1 rounded-full text-md m-2">
          {formatTime(elapsedTime)}
        </div>
      )}
      <div className="absolute bottom-40 pb-2 left-0 right-0 flex justify-center pointer-events-auto">
        <DominantHandSelector
          value={dominantHand}
          onChange={handleDominantHandChange}
          className="max-w-sm"
        />
      </div>
      {/* Record button components */}
      <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-auto">
        {/* Camera toggle button */}
        <button
          onClick={toggleCamera}
          className="relative flex items-center justify-center w-16 h-16 rounded-full transition-colors duration-300 border-2 bg-white border-gray-300 mr-2"
          aria-label={
            facingMode === 'user'
              ? 'Switch to back camera'
              : 'Switch to front camera'
          }
          type="button"
          style={{ touchAction: 'manipulation' }}
          disabled={capturing}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="black"
            className="w-8 h-8"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
        {capturing ? (
          <button
            onClick={handleStopCaptureClick}
            className="relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 bg-red-500 border-red-600"
            aria-label="Stop recording"
            style={{ touchAction: 'manipulation' }}
            type="button"
          >
            <div className="w-8 h-8 rounded-sm bg-white animate-pulse"></div>
          </button>
        ) : (
          <button
            onClick={handleStartCaptureClick}
            className="relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 bg-white border-gray-300"
            aria-label="Start recording"
          >
            <div className="w-12 h-12 rounded-full bg-red-500"></div>
          </button>
        )}
      </div>
    </div>
  );
}

export default AnalysePage;
