'use client';
import React, { useState, useRef, useEffect } from 'react';

const SimpleSwingDetector: React.FC = () => {
  // Refs for elements
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // State
  const [isRecording, setIsRecording] = useState(false);
  const [motionLevel, setMotionLevel] = useState(0);
  const [recordedVideo, setRecordedVideo] = useState<string | null>(null);
  const [message, setMessage] = useState('Ready to record');
  const [sensitivity, setSensitivity] = useState(30); // Default sensitivity

  // Refs for tracking state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const previousPixelsRef = useRef<Uint8ClampedArray | null>(null);

  // Set up camera
  useEffect(() => {
    async function setupCamera() {
      try {
        // Try to use the environment-facing camera (rear camera) on mobile
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Initialize canvas once video metadata is loaded
        if (videoRef.current) {
          videoRef.current.onloadedmetadata = () => {
            if (canvasRef.current && videoRef.current) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
            }
          };
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        setMessage(
          'Camera error: ' +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    setupCamera();

    // Clean up on unmount
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Start recording and motion detection
  const startRecording = () => {
    if (!videoRef.current || !videoRef.current.srcObject) {
      setMessage('Camera not ready');
      return;
    }

    // Reset state
    setRecordedVideo(null);
    recordedChunksRef.current = [];
    previousPixelsRef.current = null;
    setMotionLevel(0);

    try {
      // Set up media recorder
      const stream = videoRef.current.srcObject as MediaStream;
      const options = { mimeType: 'video/webm' };

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: 'video/webm',
        });
        const url = URL.createObjectURL(blob);
        setRecordedVideo(url);
        setMessage('Recording complete!');
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      setMessage('Recording... swing when ready');

      // Start motion detection
      detectMotion();
    } catch (error) {
      console.error('Error starting recording:', error);
      setMessage(
        'Recording error: ' +
          (error instanceof Error ? error.message : String(error))
      );
    }
  };

  // Detect motion between frames
  const detectMotion = () => {
    if (!isRecording || !videoRef.current || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      return;
    }

    // Draw current video frame to canvas
    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    // Get current pixel data
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const currentPixels = imageData.data;

    // If we have previous pixels to compare
    if (previousPixelsRef.current) {
      let diffCount = 0;

      // Sample every 10th pixel for performance (adjust as needed)
      for (let i = 0; i < currentPixels.length; i += 40) {
        const rdiff = Math.abs(currentPixels[i] - previousPixelsRef.current[i]);
        const gdiff = Math.abs(
          currentPixels[i + 1] - previousPixelsRef.current[i + 1]
        );
        const bdiff = Math.abs(
          currentPixels[i + 2] - previousPixelsRef.current[i + 2]
        );

        // Sum of differences exceeds threshold
        if (rdiff + gdiff + bdiff > sensitivity) {
          diffCount++;
        }
      }

      // Calculate motion level (normalize by dividing by potential total pixels)
      const pixelSamples = Math.floor(currentPixels.length / 40);
      const newMotionLevel = Math.min(
        100,
        Math.floor((diffCount / pixelSamples) * 1000)
      );

      // Update UI with motion level
      setMotionLevel(newMotionLevel);

      // Detect impact based on motion level threshold
      if (newMotionLevel > 25) {
        // Significant motion detected
        setMessage('Motion detected! Processing...');

        // Continue recording for 1 more second after impact
        setTimeout(() => {
          stopRecording();
        }, 1000);

        return; // Stop the animation loop
      }
    }

    // Store current pixels for next comparison
    previousPixelsRef.current = currentPixels;

    // Continue loop if still recording
    if (isRecording) {
      animationFrameRef.current = requestAnimationFrame(detectMotion);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setMessage('Processing video...');

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  };

  // Adjust sensitivity
  const handleSensitivityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSensitivity(Number(e.target.value));
  };

  return (
    <div className="flex flex-col items-center p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Golf Swing Detector</h1>

      {/* Status message */}
      <p className="text-lg mb-4">{message}</p>

      {/* Video feed */}
      <div className="relative w-full mb-4">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full border border-gray-300 rounded"
        />

        {/* Hidden analysis canvas */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Motion level indicator */}
        {isRecording && (
          <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 rounded p-2">
            <div className="text-white text-sm mb-1">
              Motion Level: {motionLevel}
            </div>
            <div className="w-full bg-gray-700 rounded-full h-4">
              <div
                className="bg-green-600 h-4 rounded-full transition-all duration-200"
                style={{ width: `${motionLevel}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-4 w-full mb-4">
        <button
          onClick={startRecording}
          disabled={isRecording}
          className="px-4 py-3 bg-green-600 text-white rounded font-bold disabled:bg-gray-400"
        >
          Start Recording
        </button>

        <button
          onClick={stopRecording}
          disabled={!isRecording}
          className="px-4 py-3 bg-red-600 text-white rounded font-bold disabled:bg-gray-400"
        >
          Stop Recording
        </button>
      </div>

      {/* Sensitivity slider */}
      <div className="w-full mb-6">
        <label className="block text-sm font-medium mb-1">
          Detection Sensitivity: {sensitivity}
        </label>
        <input
          type="range"
          min="10"
          max="100"
          value={sensitivity}
          onChange={handleSensitivityChange}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Less Sensitive</span>
          <span>More Sensitive</span>
        </div>
      </div>

      {/* Recorded video */}
      {recordedVideo && (
        <div className="w-full">
          <h2 className="text-lg font-semibold mb-2">Your Golf Swing</h2>
          <video
            src={recordedVideo}
            controls
            className="w-full border border-gray-300 rounded mb-2"
          />
          <a
            href={recordedVideo}
            download="golf-swing.webm"
            className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded"
          >
            Download Video
          </a>
        </div>
      )}
    </div>
  );
};

export default SimpleSwingDetector;
