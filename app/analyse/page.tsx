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

  /**
   * Handles video data chunks as they become available
   */
  const handleDataAvailable = useCallback(
    ({ data }: BlobEvent) => {
      console.log(
        `Data available, size: ${data.size} bytes, type: ${data.type}`
      );

      if (data.size > 0) {
        // Check if this is the first chunk (for iOS diagnosis)
        const isFirstChunk = recordedChunks.length === 0;
        if (isFirstChunk) {
          console.log('First data chunk received:', data.type);
        }

        setRecordedChunks((prev) => prev.concat(data));

        // Check if capturing is stopped
        if (!capturing) {
          console.log('Creating blob and navigating');

          // Make sure we can detect iOS Safari using TypeScript-safe methods
          const isIOS: boolean =
            /iPad|iPhone|iPod/.test(navigator.userAgent) &&
            !(
              navigator.userAgent.includes('Windows') ||
              navigator.userAgent.includes('Android')
            );
          const isSafari: boolean = /^((?!chrome|android).)*safari/i.test(
            navigator.userAgent
          );
          // const isIOSSafari: boolean = isIOS && isSafari;

          // Create new blob with the correct type
          // For iOS, explicitly use mp4 container
          const blobType: string = isIOS ? 'video/mp4' : data.type;
          const blob = new Blob([data], { type: blobType });
          console.log(
            `Created final blob, size: ${blob.size / 1024} KB, type: ${blobType}`
          );

          // Define IndexedDB related types
          interface IDBVideoData {
            id: string;
            blob: Blob;
            type: string;
            isIOS: boolean;
            isSafari: boolean;
            timestamp: number;
          }

          // Store the blob in IndexedDB
          const request: IDBOpenDBRequest = indexedDB.open('VideoDatabase', 1);

          request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            const db: IDBDatabase = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('videos')) {
              db.createObjectStore('videos', { keyPath: 'id' });
            }
          };

          request.onsuccess = (event: Event) => {
            const db: IDBDatabase = (event.target as IDBOpenDBRequest).result;
            const transaction: IDBTransaction = db.transaction(
              ['videos'],
              'readwrite'
            );
            const store: IDBObjectStore = transaction.objectStore('videos');

            // Store both the video and device information
            const videoData: IDBVideoData = {
              id: 'currentVideo',
              blob: blob,
              type: blobType,
              isIOS: isIOS,
              isSafari: isSafari,
              timestamp: Date.now(),
            };

            store.put(videoData);

            transaction.oncomplete = () => {
              sessionStorage.setItem('videoMimeType', blobType);
              sessionStorage.setItem('needsRefresh', 'true');
              sessionStorage.setItem('videoStored', 'true');

              // Add a small delay for iOS before navigation
              if (isIOS) {
                console.log('Adding iOS delay before navigation');
                setTimeout(() => {
                  router.push('/analyse/edit');
                }, 500);
              } else {
                router.push('/analyse/edit');
              }
            };
          };

          request.onerror = (event: Event) => {
            console.error('IndexedDB error:', event);
            // Fallback for very small videos
            try {
              const reader = new FileReader();
              reader.onload = (e: ProgressEvent<FileReader>) => {
                const dataUri = e.target?.result as string;
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
    [setRecordedChunks, capturing, router, recordedChunks.length]
  );

  /**
   * Handles starting video capture with browser-specific optimizations
   */
  const handleStartCaptureClick = useCallback(() => {
    setCapturing(true);
    if (webcamRef.current && webcamRef.current.stream) {
      // Get device info
      const isIOS: boolean =
        /iPad|iPhone|iPod/.test(navigator.userAgent) &&
        !(
          navigator.userAgent.includes('Windows') ||
          navigator.userAgent.includes('Android')
        );
      const isSafari: boolean = /^((?!chrome|android).)*safari/i.test(
        navigator.userAgent
      );

      console.log(
        `Starting capture - Device: iOS: ${isIOS}, Safari: ${isSafari}`
      );

      // Import and use the improved functions
      try {
        // Dynamic import with TypeScript
        import('@/lib/videoUtils')
          .then(({ getSupportedMimeType, createMediaRecorder }) => {
            const mimeType = getSupportedMimeType();

            // Make sure we still have the stream when imports finish
            if (!webcamRef.current || !webcamRef.current.stream) {
              console.error('Stream no longer available');
              setCapturing(false);
              return;
            }

            // Use the enhanced MediaRecorder creation function
            mediaRecorderRef.current = createMediaRecorder(
              webcamRef.current.stream,
              mimeType
            );

            if (mediaRecorderRef.current) {
              mediaRecorderRef.current.addEventListener(
                'dataavailable',
                handleDataAvailable
              );

              // For iOS Safari, request data more frequently to avoid buffer issues
              if (isIOS && isSafari) {
                console.log('Using iOS-optimized recording settings');
                mediaRecorderRef.current.start(1000); // Get data every second
              } else {
                mediaRecorderRef.current.start();
              }

              // Log that recording has started successfully
              console.log(
                'Recording started successfully with MIME type:',
                mimeType
              );
            } else {
              console.error('Failed to create MediaRecorder');
              setCapturing(false);
            }
          })
          .catch((err) => {
            console.error('Error importing video utilities:', err);
            setCapturing(false);
          });
      } catch (err) {
        console.error('Error starting recording:', err);
        setCapturing(false);
      }
    } else {
      console.error('Webcam stream not available');
      setCapturing(false);
    }
  }, [webcamRef, setCapturing, mediaRecorderRef, handleDataAvailable]);

  /**
   * Handles stopping the video capture process
   */
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
