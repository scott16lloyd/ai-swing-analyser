'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';

function AnalysePage() {
  // Webcam component
  const webcamRef = useRef<Webcam | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);

  const handleStartCaptureClick = useCallback(() => {
    setCapturing(true);
    if (webcamRef.current && webcamRef.current.stream) {
      mediaRecorderRef.current = new MediaRecorder(webcamRef.current.stream, {
        mimeType: 'video/webm',
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
      if (data.size > 0) {
        setRecordedChunks((prev) => prev.concat(data));
      }
    },
    [setRecordedChunks]
  );

  const handleStopCaptureClick = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setCapturing(false);
    }
    // handleDownload();
  }, [mediaRecorderRef, webcamRef, setCapturing]);

  const handleDownload = useCallback(() => {
    if (recordedChunks.length) {
      const blob = new Blob(recordedChunks, {
        type: 'video/webm',
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
    <>
      {/* Webcam component */}
      <Webcam
        audio={false}
        ref={webcamRef}
        className="rounded-lg h-full w-auto object-cover"
        mirrored={false}
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
            className="relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 bg-red-500 border-red-600"
            aria-label="Stop recording"
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
    </>
  );
}

export default AnalysePage;
