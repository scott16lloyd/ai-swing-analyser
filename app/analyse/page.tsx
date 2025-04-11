'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Webcam from 'react-webcam';
import { getSupportedMimeType } from '@/lib/videoUtils';

function AnalysePage() {
  // Webcam component
  const webcamRef = useRef<Webcam | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const router = useRouter();

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

        // Then stop the recorder
        mediaRecorderRef.current.stop();
        console.log('MediaRecorder stopped');

        // Set refresh flag now rather than in the data handler
        sessionStorage.setItem('needsRefresh', 'true');
      } catch (err) {
        console.error('Error stopping recording:', err);
      }
    }
  }, [mediaRecorderRef, setCapturing]);

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
        mirrored={true}
      />
      {/* Timer component */}
      {capturing && (
        <div className="absolute top-4 right-4 bg-red-500 bg-opacity-90 text-white px-3 py-1 rounded-full text-md m-2">
          {formatTime(elapsedTime)}
        </div>
      )}
      {/* Record button components */}
      <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-auto">
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
