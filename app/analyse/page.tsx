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
  const isProcessingRef = useRef(false);
  const stoppingRef = useRef(false);

  useEffect(() => {
    // This ensures we're requesting the right permissions on mount
    // and on some Android devices helps initialize the camera correctly
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: true })
        .catch((err) => console.error('Error accessing camera:', err));
    }

    // Add a safety timeout - if someone is unable to stop recording, stop it after 2 minutes
    const safetyTimeout = setTimeout(() => {
      if (capturing && mediaRecorderRef.current) {
        console.log('Safety timeout triggered - stopping recording');
        handleStopCaptureClick();
      }
    }, 120000); // 2 minutes

    return () => {
      clearTimeout(safetyTimeout);
      // Clean up any recording in progress when component unmounts
      if (mediaRecorderRef.current && capturing) {
        try {
          mediaRecorderRef.current.stop();
        } catch (err) {
          console.error('Error stopping MediaRecorder on unmount:', err);
        }
      }
    };
  }, [capturing]);

  const handleStartCaptureClick = useCallback(() => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    stoppingRef.current = false;

    try {
      setCapturing(true);
      setRecordedChunks([]);

      if (webcamRef.current && webcamRef.current.stream) {
        const mimeType = getSupportedMimeType();
        const recorder = new MediaRecorder(webcamRef.current.stream, {
          mimeType: mimeType,
        });

        // Set up the event handler before starting
        recorder.addEventListener('dataavailable', handleDataAvailable);

        // Set an ondataavailable handler that will fire when stop() is called
        recorder.ondataavailable = (event) => {
          console.log(
            'Direct ondataavailable handler called, size:',
            event.data.size
          );
        };

        recorder.onstop = () => {
          console.log('MediaRecorder onstop event triggered');
        };

        recorder.onerror = (event) => {
          console.error('MediaRecorder error:', event);
        };

        // Start recording with a 1000ms timeslice to ensure we get data chunks periodically
        recorder.start(1000);
        console.log('MediaRecorder started');
        mediaRecorderRef.current = recorder;
      } else {
        console.error('Webcam stream not available');
        setCapturing(false);
      }
    } catch (err) {
      console.error('Error starting recording:', err);
      setCapturing(false);
    }

    // Reset the processing flag after a small delay
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 500);
  }, []);

  const handleDataAvailable = useCallback(({ data }: { data: Blob }) => {
    console.log('Data available, size:', data.size);
    if (data.size > 0) {
      setRecordedChunks((prev) => {
        const newChunks = prev.concat(data);
        console.log(`Added chunk, now have ${newChunks.length} chunks`);
        return newChunks;
      });

      // If we're in stopping mode and receive data, process it
      if (stoppingRef.current) {
        console.log('Processing final data chunk after stop request');

        // Create blob from all chunks, not just the current data
        const processFinalData = () => {
          setRecordedChunks((prevChunks) => {
            const finalChunks = prevChunks.concat(data);
            console.log(`Processing ${finalChunks.length} chunks`);

            // Combine all chunks into a single blob
            const blob = new Blob(finalChunks, { type: data.type });
            console.log(`Created final blob, size: ${blob.size}`);

            // Store in IndexedDB
            storeVideoAndNavigate(blob, data.type);

            return finalChunks;
          });
        };

        // Slight delay to ensure all chunks are collected
        setTimeout(processFinalData, 100);
      }
    }
  }, []);

  // Separate function to store video and navigate
  const storeVideoAndNavigate = useCallback(
    (blob: Blob, mimeType: string) => {
      console.log('Storing video and navigating');

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
        store.put({ id: 'currentVideo', blob: blob, type: mimeType });

        transaction.oncomplete = () => {
          sessionStorage.setItem('videoMimeType', mimeType);
          sessionStorage.setItem('needsRefresh', 'true');
          sessionStorage.setItem('videoStored', 'true');
          console.log('Video stored successfully, navigating to edit page');
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
    },
    [router]
  );

  const handleStopCaptureClick = useCallback(() => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    stoppingRef.current = true;

    console.log('Stop button clicked');
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      try {
        // First update UI state so the button appears disabled
        setCapturing(false);

        // Request a final dataavailable event
        mediaRecorderRef.current.requestData();

        // Small delay before stopping to ensure data is collected
        setTimeout(() => {
          // Then stop the recorder
          if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            console.log('MediaRecorder stopped');
          }

          // If no data was received after a timeout, try to force navigation
          setTimeout(() => {
            if (stoppingRef.current && recordedChunks.length > 0) {
              console.log(
                'Timeout reached - forcing processing of existing chunks'
              );
              const lastChunk = recordedChunks[recordedChunks.length - 1];
              const blob = new Blob(recordedChunks, { type: lastChunk.type });
              storeVideoAndNavigate(blob, lastChunk.type);
            }
          }, 2000);
        }, 100);

        // Set refresh flag now rather than in the data handler
        sessionStorage.setItem('needsRefresh', 'true');
      } catch (err) {
        console.error('Error stopping recording:', err);
        // Even if there's an error, try to process what we have
        if (recordedChunks.length > 0) {
          const lastChunk = recordedChunks[recordedChunks.length - 1];
          const blob = new Blob(recordedChunks, { type: lastChunk.type });
          storeVideoAndNavigate(blob, lastChunk.type);
        }
      }
    } else {
      console.log('MediaRecorder not active or not initialized');
      setCapturing(false);
    }

    // Reset the processing flag after a delay
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 500);
  }, [storeVideoAndNavigate, recordedChunks]);

  // Capture duration timer
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
  }, [capturing]);

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
      <div className="absolute bottom-24 left-0 right-0 flex justify-center">
        {capturing ? (
          <button
            onClick={handleStopCaptureClick}
            className="relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 bg-red-500 border-red-600 active:bg-red-700 pointer-events-auto z-50"
            aria-label="Stop recording"
            style={{ touchAction: 'manipulation' }}
            type="button"
          >
            <div className="w-8 h-8 rounded-sm bg-white"></div>
          </button>
        ) : (
          <button
            onClick={handleStartCaptureClick}
            className="relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 bg-white border-gray-300 active:bg-gray-100 pointer-events-auto z-50"
            aria-label="Start recording"
            style={{ touchAction: 'manipulation' }}
            type="button"
          >
            <div className="w-12 h-12 rounded-full bg-red-500"></div>
          </button>
        )}
      </div>
    </div>
  );
}

export default AnalysePage;
