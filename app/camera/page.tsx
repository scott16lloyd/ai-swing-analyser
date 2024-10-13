'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CameraIcon, Download } from 'lucide-react';

export default function VideoCapturePage() {
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>(
    'environment'
  );
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [cameraFacing]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing },
        audio: true,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError(null);
    } catch (err) {
      console.error('Error accessing the camera:', err);
      setError(
        `No ${cameraFacing === 'user' ? 'front' : 'back'} camera available. Please check your device settings or try switching cameras.`
      );
      stopCamera();
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    const tracks = stream?.getTracks();
    tracks?.forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const toggleCamera = () => {
    setCameraFacing((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  const startRecording = () => {
    setRecordedVideoBlob(null);
    const stream = videoRef.current?.srcObject as MediaStream;
    if (stream) {
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setRecordedVideoBlob(blob);
      };
      mediaRecorder.start();
      setIsRecording(true);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const downloadVideo = () => {
    if (recordedVideoBlob) {
      const url = URL.createObjectURL(recordedVideoBlob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      a.href = url;
      a.download = 'captured-video.webm';
      a.click();
      window.URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="h-[calc(100vh-2.5rem)] w-full flex flex-col bg-black text-white">
      <div className="relative flex-grow">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center p-4">
              <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
              <p className="text-lg font-semibold mb-2">Camera Error</p>
              <p>{error}</p>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            style={{
              transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none', // Mirror front camera
            }}
          />
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-[calc(1rem+1.25rem)] flex justify-center items-center">
        <Button
          className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors mr-4"
          onClick={toggleCamera}
          disabled={isRecording}
        >
          <CameraIcon className="h-6 w-6" />
        </Button>
        <Button
          className={`rounded-full p-4 ${
            isRecording
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-white hover:bg-gray-200'
          } transition-colors`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!!error}
        >
          <div
            className={`${
              isRecording
                ? 'h-6 w-6 bg-white rounded-sm'
                : 'h-8 w-8 bg-red-500 rounded-full'
            }`}
          />
        </Button>
        {recordedVideoBlob && (
          <Button
            className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors ml-4"
            onClick={downloadVideo}
          >
            <Download className="h-6 w-6" />
          </Button>
        )}
      </div>
    </div>
  );
}
