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

  // Simpler, more reliable implementation
  const handleStartCaptureClick = useCallback(() => {
    console.log('Start button clicked');

    // Prevent multiple clicks
    if (capturing || isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      if (webcamRef.current && webcamRef.current.stream) {
        // Get supported MIME type
        const mimeType = getSupportedMimeType();
        console.log('Using MIME type:', mimeType);

        // Create a new MediaRecorder instance
        const recorder = new MediaRecorder(webcamRef.current.stream, {
          mimeType: mimeType,
        });

        // Clear previous chunks
        setRecordedChunks([]);

        // Set up event listeners
        recorder.ondataavailable = function (event) {
          console.log('Data available, size:', event.data.size);
          if (event.data.size > 0) {
            setRecordedChunks((prev) => [...prev, event.data]);
          }
        };

        // Start recording - collect data every second
        recorder.start(1000);
        console.log('MediaRecorder started');

        // Store the recorder reference
        mediaRecorderRef.current = recorder;

        // Update UI state
        setCapturing(true);
      } else {
        console.error('Webcam stream not available');
        alert(
          'Camera access is required. Please allow camera permissions and try again.'
        );
      }
    } catch (err) {
      console.error('Error starting recording:', err);
      alert('Failed to start recording. Please try again.');
    }

    // Reset processing flag after a delay
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 500);
  }, [capturing, webcamRef]);

  const handleStopCaptureClick = useCallback(() => {
    console.log('Stop button clicked');

    // Prevent multiple clicks
    if (!capturing || isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      // Update UI state first
      setCapturing(false);

      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        console.log('Stopping MediaRecorder...');

        // Request final data before stopping
        mediaRecorderRef.current.requestData();

        // Add a small delay before stopping to ensure we get the data
        setTimeout(() => {
          if (mediaRecorderRef.current) {
            // Stop the recorder
            mediaRecorderRef.current.stop();
            console.log('MediaRecorder stopped');

            // Process the recorded data after a short delay
            setTimeout(() => {
              processRecordedData();
            }, 300);
          }
        }, 100);
      } else {
        console.log('MediaRecorder not active, processing existing data');
        processRecordedData();
      }
    } catch (err) {
      console.error('Error stopping recording:', err);
      // Try to process what we have even if there's an error
      processRecordedData();
    }

    // Reset processing flag after a delay
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 500);
  }, [capturing]);

  // Process recorded data and navigate to edit page
  const processRecordedData = useCallback(() => {
    console.log(`Processing ${recordedChunks.length} chunks of recorded data`);

    if (recordedChunks.length === 0) {
      console.error('No recorded data available');
      alert('No video data recorded. Please try again.');
      return;
    }

    // Get the type from the first chunk
    const type = recordedChunks[0].type;

    // Create a blob from all chunks
    const blob = new Blob(recordedChunks, { type });
    console.log(`Created blob with size: ${blob.size} bytes`);

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
      store.put({ id: 'currentVideo', blob: blob, type: type });

      transaction.oncomplete = () => {
        // Save metadata in session storage
        sessionStorage.setItem('videoMimeType', type);
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
  }, [recordedChunks, router]);

  // Safety timeout to prevent endless recording
  useEffect(() => {
    let safetyTimeout: NodeJS.Timeout;

    if (capturing) {
      // Auto-stop after 2 minutes for safety
      safetyTimeout = setTimeout(() => {
        if (capturing && mediaRecorderRef.current) {
          console.log(
            'Safety timeout triggered - stopping recording after 2 minutes'
          );
          handleStopCaptureClick();
        }
      }, 120000); // 2 minutes
    }

    return () => {
      clearTimeout(safetyTimeout);
      // Clean up recording on unmount
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch (err) {
          console.error('Error stopping MediaRecorder on unmount:', err);
        }
      }
    };
  }, [capturing, handleStopCaptureClick]);

  // Timer for recording duration
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

  // Format the timer display
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
