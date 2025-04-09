'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Webcam from 'react-webcam';

function AnalysePage() {
  // Webcam component
  const webcamRef = useRef<Webcam | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [capturing, setCapturing] = useState(false);
  const recordedChunksRef = useRef<Blob[]>([]); // Use ref instead of state for chunks
  const [elapsedTime, setElapsedTime] = useState(0);
  const router = useRouter();
  const isProcessingRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);

  // Function to determine supported MIME type - prioritize WebM over MP4
  // since WebM has better compatibility across browsers
  const getSupportedMimeType = useCallback(() => {
    // WebM format is more widely supported for playback
    const mimeTypes = [
      'video/webm',
      'video/webm;codecs=vp8',
      'video/webm;codecs=vp9',
      'video/webm;codecs=h264',
      // Only try MP4 if WebM is not available
      'video/mp4',
      'video/mp4;codecs=h264',
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

  // Function to start recording
  const handleStartCaptureClick = useCallback(() => {
    console.log('Start button clicked');

    // Prevent multiple clicks
    if (capturing || isProcessingRef.current) {
      console.log('Already capturing or processing, ignoring click');
      return;
    }

    isProcessingRef.current = true;

    try {
      if (!webcamRef.current || !webcamRef.current.stream) {
        throw new Error('Webcam stream not available');
      }

      // Clear previous chunks
      recordedChunksRef.current = [];

      // Get the stream
      const stream = webcamRef.current.stream;

      // Log stream details
      console.log(
        'Stream tracks:',
        stream.getTracks().map((t) => `${t.kind} (${t.readyState})`)
      );

      // Get supported MIME type
      const mimeType = getSupportedMimeType();

      // Create options object
      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
        console.log('Using MIME type:', mimeType);
      } else {
        console.log('Using browser default MIME type');
      }

      // Use a lower bitrate for better compatibility - especially for Android
      (options as any).videoBitsPerSecond = 1000000; // 1 Mbps

      // Create recorder
      const recorder = new MediaRecorder(stream, options);
      console.log('MediaRecorder created with state:', recorder.state);
      console.log('Using recorder MIME type:', recorder.mimeType);

      // Set up data handler
      recorder.ondataavailable = (event) => {
        console.log(
          `Data available: size=${event.data.size}, type=${event.data.type}`
        );
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          console.log(
            `Added chunk, now have ${recordedChunksRef.current.length} chunks`
          );
        }
      };

      // Error handler
      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
      };

      // On stop handler
      recorder.onstop = () => {
        console.log('MediaRecorder stopped, processing data...');
        setTimeout(() => {
          processRecordedData();
        }, 300);
      };

      // Start with a smaller timeslice for Android - more frequent chunks
      recorder.start(200);
      console.log('MediaRecorder started');

      // Store reference and update state
      mediaRecorderRef.current = recorder;
      setCapturing(true);

      // Request data immediately to ensure we get something
      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.requestData();
          console.log('Requested initial data');
        }
      }, 500);
    } catch (err) {
      console.error('Error starting recording:', err);
      setCapturing(false);

      if (err instanceof Error) {
        alert(`Failed to start recording: ${err.message}`);
      } else {
        alert('Failed to start recording. Please try again.');
      }
    }

    // Reset processing flag
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 500);
  }, [capturing, webcamRef, getSupportedMimeType]);

  // Function to stop recording
  const handleStopCaptureClick = useCallback(() => {
    console.log('Stop button clicked');

    // Prevent multiple clicks
    if (!capturing || isProcessingRef.current) {
      console.log('Not capturing or already processing, ignoring click');
      return;
    }

    isProcessingRef.current = true;

    // Update UI first
    setCapturing(false);

    try {
      if (!mediaRecorderRef.current) {
        console.error('MediaRecorder not available');
        processRecordedData(); // Try to process anyway
        return;
      }

      // Request final data
      if (mediaRecorderRef.current.state === 'recording') {
        console.log('Requesting final data chunk');
        mediaRecorderRef.current.requestData();

        // Small delay to ensure we get the data
        setTimeout(() => {
          try {
            console.log('Stopping MediaRecorder');
            mediaRecorderRef.current?.stop();
            // No need to call processRecordedData here as it's called in onstop
          } catch (err) {
            console.error('Error stopping recorder:', err);
            // Try to process anyway
            processRecordedData();
          }
        }, 300);
      } else {
        console.log('MediaRecorder not recording, processing data');
        processRecordedData();
      }
    } catch (err) {
      console.error('Error in stop process:', err);
      // Try to process anyway
      processRecordedData();
    }
  }, [capturing]);

  // Process recorded data and navigate to edit page
  const processRecordedData = useCallback(() => {
    console.log(
      `Processing ${recordedChunksRef.current.length} chunks of recorded data`
    );

    // Reset processing flag after we're done
    const resetProcessing = () => {
      setTimeout(() => {
        isProcessingRef.current = false;
      }, 500);
    };

    if (recordedChunksRef.current.length === 0) {
      console.error('No recorded data available');
      alert(
        'No video data recorded. Please try again and record for at least 2-3 seconds.'
      );
      resetProcessing();
      return;
    }

    try {
      // Android workaround - sometimes the first chunk is empty or corrupt
      const validChunks = recordedChunksRef.current.filter(
        (chunk) => chunk.size > 100
      );

      if (validChunks.length === 0) {
        console.error('No valid chunks available');
        alert(
          'Recording failed. Please try again and record for longer (3-5 seconds).'
        );
        resetProcessing();
        return;
      }

      // Get the type from the first valid chunk
      const firstValidChunk = validChunks[0];
      const type = firstValidChunk.type || 'video/webm';
      console.log(`Using MIME type for blob: ${type}`);

      // Create a blob from all valid chunks
      const blob = new Blob(validChunks, { type });
      console.log(`Created blob: size=${blob.size} bytes, type=${blob.type}`);

      if (blob.size < 1000) {
        console.warn('Blob is very small, might be invalid');
        alert(
          'Recording is too short. Please try again and record for longer.'
        );
        resetProcessing();
        return;
      }

      // Store video data and navigate
      storeVideoAndNavigate(blob, type);
    } catch (err) {
      console.error('Error processing video:', err);
      alert('Error processing video. Please try again.');
      resetProcessing();
    }
  }, []);

  // Store video and navigate
  const storeVideoAndNavigate = useCallback(
    (blob: Blob, type: string) => {
      console.log(`Storing video: size=${blob.size}, type=${type}`);

      // Debug: Check if video is playable
      const debugVideo = () => {
        try {
          const videoURL = URL.createObjectURL(blob);
          const video = document.createElement('video');
          video.style.display = 'none';
          document.body.appendChild(video);

          // Log video metadata when loaded
          video.onloadedmetadata = () => {
            console.log(
              `Video metadata loaded - Duration: ${video.duration}s, Size: ${video.videoWidth}x${video.videoHeight}`
            );
            document.body.removeChild(video);
          };

          // Log playback errors
          video.onerror = (e) => {
            console.error('Video playback error during debug check:', e);
            document.body.removeChild(video);
          };

          video.src = videoURL;
          video.load();
        } catch (e) {
          console.error('Error checking video playability:', e);
        }
      };

      // Try to debug the video first
      debugVideo();

      // Ensure we're always using a format that works for storage/playback
      const storageType = type.includes('webm') ? type : 'video/webm';

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
        const videoData = {
          id: 'currentVideo',
          blob: blob,
          type: storageType,
          timestamp: new Date().toISOString(),
          size: blob.size,
        };

        store.put(videoData);

        transaction.oncomplete = () => {
          // Save metadata in session storage
          sessionStorage.setItem('videoMimeType', storageType);
          sessionStorage.setItem('needsRefresh', 'true');
          sessionStorage.setItem('videoStored', 'true');
          sessionStorage.setItem('videoSize', blob.size.toString());

          console.log('Video stored successfully, navigating to edit page');
          router.push('/analyse/edit');
        };
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event);

        // Try alternative storage method - as base64 data URI
        try {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUri = reader.result as string;
            sessionStorage.setItem('recordedVideo', dataUri);
            sessionStorage.setItem('videoMimeType', storageType);
            console.log('Video stored as data URI');
            router.push('/analyse/edit');
          };
          reader.readAsDataURL(blob);
        } catch (e) {
          console.error('Failed to store video:', e);
          alert('Failed to save video. Please try again.');

          // Reset processing flag
          setTimeout(() => {
            isProcessingRef.current = false;
          }, 500);
        }
      };
    },
    [router]
  );

  // Get minimum required recording time
  const getMinRecordingTime = useCallback(() => {
    // Android usually needs longer recording time
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('android') ? 3 : 1; // 3 seconds for Android, 1 for others
  }, []);

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
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        .then((stream) => {
          console.log('Camera permission granted');

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

  // Auto-stop for safety and to enforce minimum recording time
  useEffect(() => {
    let safetyTimeout: NodeJS.Timeout;

    if (capturing) {
      // Force data request periodically
      const dataInterval = setInterval(() => {
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state === 'recording'
        ) {
          mediaRecorderRef.current.requestData();
          console.log('Periodic data request');
        }
      }, 1000);

      // Auto-stop after 2 minutes for safety
      safetyTimeout = setTimeout(() => {
        if (capturing && mediaRecorderRef.current) {
          console.log(
            'Safety timeout triggered - stopping recording after 2 minutes'
          );
          handleStopCaptureClick();
        }
      }, 120000); // 2 minutes

      return () => {
        clearInterval(dataInterval);
        clearTimeout(safetyTimeout);
      };
    }

    return () => {};
  }, [capturing, handleStopCaptureClick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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
  }, []);

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
