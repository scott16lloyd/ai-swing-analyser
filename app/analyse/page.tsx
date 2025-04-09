'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Webcam from 'react-webcam';

function AnalysePage() {
  // Webcam component
  const webcamRef = useRef<Webcam | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const router = useRouter();
  const isProcessingRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const dataAvailableRef = useRef(false);

  // Function to determine supported MIME type
  const getSupportedMimeType = useCallback(() => {
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
      'video/x-matroska',
    ];

    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`Browser supports MIME type: ${type}`);
        return type;
      }
    }

    console.warn('No preferred MIME types supported, falling back to default');
    return ''; // Let the browser choose
  }, []);

  // Handle webcam initialization
  const handleUserMedia = useCallback(() => {
    console.log('Camera is ready and accessible');
    setCameraReady(true);
  }, []);

  const handleUserMediaError = useCallback((error: string | DOMException) => {
    console.error('Error accessing camera:', error);
    setCameraReady(false);
    alert(
      'Unable to access camera. Please check your permissions and try again.'
    );
  }, []);

  const handleStartCaptureClick = useCallback(() => {
    console.log('Start button clicked');

    // Prevent multiple clicks
    if (capturing || isProcessingRef.current) {
      console.log('Already capturing or processing, ignoring click');
      return;
    }

    isProcessingRef.current = true;

    try {
      if (!webcamRef.current) {
        throw new Error('Webcam reference not available');
      }

      if (!webcamRef.current.stream) {
        throw new Error('Webcam stream not available');
      }

      console.log(
        'Webcam stream tracks:',
        webcamRef.current.stream.getTracks().map((t) => t.kind)
      );

      // Reset the data available flag
      dataAvailableRef.current = false;

      // Clear previous chunks
      setRecordedChunks([]);

      // Get supported MIME type
      const mimeType = getSupportedMimeType();
      console.log('Using MIME type:', mimeType);

      // Create MediaRecorder options
      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }

      // Create a new MediaRecorder instance
      const recorder = new MediaRecorder(webcamRef.current.stream, options);

      console.log('MediaRecorder created with state:', recorder.state);
      console.log('MediaRecorder mimeType:', recorder.mimeType);

      // Set up event listeners
      recorder.ondataavailable = (event) => {
        console.log('Data available event, size:', event.data.size);
        if (event.data && event.data.size > 0) {
          dataAvailableRef.current = true;
          setRecordedChunks((prev) => {
            console.log('Adding chunk, current count:', prev.length);
            return [...prev, event.data];
          });
        }
      };

      recorder.onstop = () => {
        console.log('MediaRecorder stopped');
      };

      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
      };

      // Start recording with a timeslice to ensure we get regular data chunks
      // Use a smaller timeslice for more frequent data chunks
      recorder.start(500);
      console.log('MediaRecorder started with state:', recorder.state);

      // Store the recorder reference
      mediaRecorderRef.current = recorder;

      // Update UI state
      setCapturing(true);
    } catch (err) {
      console.error('Error starting recording:', err);
      setCapturing(false);

      // Show more specific error message
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          alert(
            'Camera permission denied. Please allow camera access and try again.'
          );
        } else if (err.name === 'NotReadableError') {
          alert(
            'Camera is in use by another application. Please close other apps using the camera.'
          );
        } else if (err.message && err.message.includes('MIME')) {
          alert(
            'Your device does not support the required video format. Try a different browser.'
          );
        } else {
          alert(`Failed to start recording: ${err.message}. Please try again.`);
        }
      } else {
        alert('Failed to start recording. Please try again.');
      }
    } finally {
      // Reset processing flag after a delay
      setTimeout(() => {
        isProcessingRef.current = false;
      }, 500);
    }
  }, [capturing, webcamRef, getSupportedMimeType]);

  const handleStopCaptureClick = useCallback(() => {
    console.log('Stop button clicked');

    // Prevent multiple clicks
    if (!capturing || isProcessingRef.current) {
      console.log('Not capturing or already processing, ignoring click');
      return;
    }

    isProcessingRef.current = true;

    try {
      // Update UI state first
      setCapturing(false);

      if (!mediaRecorderRef.current) {
        console.error('MediaRecorder reference not available');
        throw new Error('Recording device not available');
      }

      console.log(
        'MediaRecorder state before stopping:',
        mediaRecorderRef.current.state
      );

      if (mediaRecorderRef.current.state === 'recording') {
        // Request data one more time before stopping
        mediaRecorderRef.current.requestData();

        // Small delay to ensure data is processed
        setTimeout(() => {
          if (mediaRecorderRef.current) {
            try {
              // Stop the recorder
              mediaRecorderRef.current.stop();
              console.log('MediaRecorder stopped successfully');
            } catch (stopErr) {
              console.error('Error stopping MediaRecorder:', stopErr);
            }

            // Process data after a delay to ensure all chunks are collected
            setTimeout(() => {
              console.log(
                'Processing data after stop, chunks:',
                recordedChunks.length
              );
              console.log('Data available flag:', dataAvailableRef.current);

              if (recordedChunks.length > 0) {
                processRecordedData(recordedChunks);
              } else {
                console.error('No chunks collected during recording');
                alert(
                  'No video data was captured. Please try again and record for at least 1-2 seconds.'
                );
              }
            }, 1000);
          }
        }, 200);
      } else {
        console.log('MediaRecorder not in recording state, cannot stop');
        // Try to process any data we might have
        if (recordedChunks.length > 0) {
          processRecordedData(recordedChunks);
        } else {
          console.error(
            'No chunks collected and recorder not in recording state'
          );
          alert(
            'Recording failed. Please try again and record for at least 1-2 seconds.'
          );
        }
      }
    } catch (err) {
      console.error('Error in stop capture process:', err);
      // Try to process what we have even if there's an error
      if (recordedChunks.length > 0) {
        processRecordedData(recordedChunks);
      } else {
        alert(
          'Failed to capture video. Please try again and record for at least 1-2 seconds.'
        );
      }
    } finally {
      // Reset processing flag after a delay
      setTimeout(() => {
        isProcessingRef.current = false;
      }, 1000);
    }
  }, [capturing, recordedChunks]);

  // Process recorded data and navigate to edit page
  const processRecordedData = useCallback(
    (chunks: Blob[]) => {
      console.log(`Processing ${chunks.length} chunks of recorded data`);

      if (chunks.length === 0) {
        console.error('No recorded data available');
        alert(
          'No video data recorded. Please try again and record for at least 1-2 seconds.'
        );
        return;
      }

      try {
        // Get the type from the first chunk or use a default
        const type = chunks[0].type || 'video/webm';
        console.log('Chunk mime type:', type);

        // Create a blob from all chunks
        const blob = new Blob(chunks, { type });
        console.log(
          `Created blob with size: ${blob.size} bytes and type: ${type}`
        );

        if (blob.size < 100) {
          console.error('Blob size too small, likely invalid recording');
          alert(
            'Recording too short or failed. Please try again and record for at least 1-2 seconds.'
          );
          return;
        }

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
      } catch (err) {
        console.error('Error processing recorded data:', err);
        alert('Error processing the recorded video. Please try again.');
      }
    },
    [router]
  );

  // Request camera permissions at component mount
  useEffect(() => {
    // Check if MediaRecorder is supported
    if (typeof MediaRecorder === 'undefined') {
      console.error('MediaRecorder not supported in this browser');
      alert(
        'Recording is not supported in your browser. Please try a different browser.'
      );
      return;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: true,
          audio: false,
        })
        .then((stream) => {
          console.log('Camera permission granted');
          // We don't need to do anything with the stream here
          // Webcam component will handle it

          // Clean up stream when component unmounts
          return () => {
            stream.getTracks().forEach((track) => track.stop());
          };
        })
        .catch((err) => {
          console.error('Error requesting camera permission:', err);
          setCameraReady(false);
        });
    }
  }, []);

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
        mediaRecorderRef.current.state === 'recording'
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
        onUserMedia={handleUserMedia}
        onUserMediaError={handleUserMediaError}
        videoConstraints={{
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }}
      />

      {/* Timer component */}
      {capturing && (
        <div className="absolute top-4 right-4 bg-red-500 bg-opacity-90 text-white px-3 py-1 rounded-full text-md m-2">
          {formatTime(elapsedTime)}
        </div>
      )}

      {/* Camera not ready message */}
      {!cameraReady && !capturing && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black bg-opacity-75 text-white px-6 py-4 rounded-lg text-center">
          <p className="text-lg">Camera initializing...</p>
          <p className="text-sm mt-2">Please allow camera access if prompted</p>
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
            disabled={!cameraReady}
            className={`relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 ${
              cameraReady
                ? 'bg-white border-gray-300 active:bg-gray-100'
                : 'bg-gray-300 border-gray-400 opacity-70'
            } pointer-events-auto z-50`}
            aria-label="Start recording"
            style={{ touchAction: 'manipulation' }}
            type="button"
          >
            <div
              className={`w-12 h-12 rounded-full ${cameraReady ? 'bg-red-500' : 'bg-gray-500'}`}
            ></div>
          </button>
        )}
      </div>
    </div>
  );
}

export default AnalysePage;
