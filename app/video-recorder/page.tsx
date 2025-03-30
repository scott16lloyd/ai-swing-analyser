'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';

function VideoRecorderPlayer() {
  // States
  const [mode, setMode] = useState<'record' | 'preview'>('record');
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Refs
  const webcamRef = useRef<Webcam | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Handle recording start
  const handleStartCapture = useCallback(() => {
    setCapturing(true);
    if (webcamRef.current && webcamRef.current.stream) {
      // Check for supported MIME types
      const mimeType = getSupportedMimeType();
      console.log('Using MIME type:', mimeType);

      mediaRecorderRef.current = new MediaRecorder(webcamRef.current.stream, {
        mimeType: mimeType,
      });

      mediaRecorderRef.current.addEventListener('dataavailable', ({ data }) => {
        if (data.size > 0) {
          console.log('Video data available:', data.size, 'bytes');

          // Create a blob URL directly (no page navigation)
          const blob = new Blob([data], { type: data.type });
          const url = URL.createObjectURL(blob);
          setVideoSrc(url);

          // Switch to preview mode
          setMode('preview');
        }
      });

      mediaRecorderRef.current.start();
    }
  }, []);

  // Handle recording stop
  const handleStopCapture = useCallback(() => {
    setCapturing(false);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Handle return to recording mode
  const handleRetake = useCallback(() => {
    // Clean up existing video
    if (videoSrc) {
      URL.revokeObjectURL(videoSrc);
      setVideoSrc(null);
    }
    setMode('record');
  }, [videoSrc]);

  // Helper function to find supported MIME type
  const getSupportedMimeType = () => {
    const types = [
      'video/mp4',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return ''; // Let browser choose default
  };

  // Recording timer
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (capturing) {
      interval = setInterval(() => {
        setElapsedTime((prevTime) => prevTime + 1);
      }, 1000);
    } else {
      setElapsedTime(0);
    }

    return () => clearInterval(interval);
  }, [capturing]);

  // Format time for display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {mode === 'record' ? (
        /* Recording interface */
        <div className="flex-1 flex flex-col">
          {/* Camera view */}
          <Webcam
            audio={false}
            ref={webcamRef}
            className="rounded-lg h-full w-auto object-cover"
            mirrored={true}
            videoConstraints={{
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }}
          />

          {/* Timer */}
          {capturing && (
            <div className="absolute top-4 right-4 bg-red-500 bg-opacity-90 text-white px-3 py-1 rounded-full">
              {formatTime(elapsedTime)}
            </div>
          )}

          {/* Record button */}
          <div className="absolute bottom-24 left-0 right-0 flex justify-center">
            {capturing ? (
              <button
                onClick={handleStopCapture}
                className="flex items-center justify-center w-24 h-16 rounded-full bg-red-500 border-2 border-red-600"
                aria-label="Stop recording"
              >
                <div className="w-8 h-8 rounded-sm bg-white animate-pulse"></div>
              </button>
            ) : (
              <button
                onClick={handleStartCapture}
                className="flex items-center justify-center w-24 h-16 rounded-full bg-white border-2 border-gray-300"
                aria-label="Start recording"
              >
                <div className="w-12 h-12 rounded-full bg-red-500"></div>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Playback interface */
        <div className="flex-1 flex flex-col items-center p-4">
          {/* Video playback */}
          <div className="relative w-full h-full flex justify-center items-center">
            <video
              ref={videoRef}
              src={videoSrc || undefined}
              className="max-h-full max-w-full rounded-lg"
              controls
              playsInline
              webkit-playsinline="true"
              autoPlay
            />
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex space-x-4">
            <button
              onClick={handleRetake}
              className="px-6 py-2 bg-gray-200 rounded-full text-gray-800"
            >
              Retake
            </button>

            <a
              href={videoSrc || '#'}
              download="my-video.mp4"
              className="px-6 py-2 bg-blue-500 rounded-full text-white"
            >
              Download
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoRecorderPlayer;
