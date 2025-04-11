'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'react-camera-pro';
import { getSupportedMimeType } from '@/lib/videoUtils';

// Type definitions
type CameraType = {
  takePhoto: () => string;
  switchCamera: () => 'user' | 'environment';
  getNumberOfCameras: () => number;
};

type ErrorMessagesType = {
  noCameraAccessible?: string;
  permissionDenied?: string;
  switchCamera?: string;
  canvas?: string;
};

function AnalysePage() {
  const cameraRef = useRef<CameraType | null>(null);
  const [numberOfCameras, setNumberOfCameras] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // This function gets the camera stream for recording
  const getCameraStream = useCallback(async (): Promise<MediaStream | null> => {
    try {
      // Get user media directly since react-camera-pro doesn't expose the stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });

      streamRef.current = stream;

      // Set up video element to display the stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      return stream;
    } catch (err) {
      console.error('Error accessing camera:', err);
      return null;
    }
  }, []);

  const handleStartCaptureClick = useCallback(async () => {
    setCapturing(true);

    // For video recording, we need to get the stream directly
    const stream = streamRef.current || (await getCameraStream());

    if (stream) {
      const mimeType = getSupportedMimeType();
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: mimeType,
      });

      mediaRecorderRef.current.addEventListener(
        'dataavailable',
        handleDataAvailable
      );
      mediaRecorderRef.current.start();
    }
  }, [getCameraStream, setCapturing]);

  const handleDataAvailable = useCallback(
    ({ data }: BlobEvent) => {
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

          request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('videos')) {
              db.createObjectStore('videos', { keyPath: 'id' });
            }
          };

          request.onsuccess = (event: Event) => {
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

          request.onerror = (event: Event) => {
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

  // Take a photo using react-camera-pro
  const takePhoto = useCallback(() => {
    if (cameraRef.current) {
      const photo = cameraRef.current.takePhoto();
      console.log('Photo taken:', photo);
      // You can use this photo if needed
    }
  }, [cameraRef]);

  // Switch camera if multiple cameras are available
  const switchCamera = useCallback(() => {
    if (cameraRef.current && numberOfCameras > 1) {
      const newMode = cameraRef.current.switchCamera();
      console.log('Camera switched to:', newMode);
    }
  }, [cameraRef, numberOfCameras]);

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

  // Initialize stream when component mounts
  useEffect(() => {
    getCameraStream();

    // Cleanup function to stop streams when component unmounts
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [getCameraStream]);

  // Format the timer
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const errorMessages: ErrorMessagesType = {
    noCameraAccessible:
      'No camera device accessible. Please connect your camera or try a different browser.',
    permissionDenied:
      'Permission denied. Please refresh and give camera permission.',
    switchCamera:
      'It is not possible to switch camera to different one because there is only one video device accessible.',
    canvas: 'Canvas is not supported.',
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden touch-none p-4">
      {/* Hidden video element to handle the stream for recording */}
      <video
        ref={videoRef}
        style={{ display: 'none' }}
        autoPlay
        playsInline
        muted
      />

      {/* Camera component from react-camera-pro */}
      <Camera
        ref={cameraRef}
        facingMode="user"
        aspectRatio="cover"
        numberOfCamerasCallback={setNumberOfCameras}
        errorMessages={errorMessages}
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

      {/* Camera switch button (only shown if multiple cameras are available) */}
      {numberOfCameras > 1 && (
        <button
          onClick={switchCamera}
          className="absolute top-4 left-4 bg-gray-800 bg-opacity-70 text-white p-2 rounded-full"
          aria-label="Switch camera"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default AnalysePage;
