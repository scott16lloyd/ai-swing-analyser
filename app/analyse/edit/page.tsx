'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import getBlobDuration from 'get-blob-duration';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Activity } from 'lucide-react';
import { uploadVideoToGCS, generateSignedUrl } from '@/app/actions/storage';
import { standardTrimVideo } from '@/lib/videoUtils';

function EditPage() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mobileDebugLogs, setMobileDebugLogs] = useState<string[]>([]);
  const [showDebugger, setShowDebugger] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingLeftRef = useRef(false);
  const isDraggingRightRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Debug log for mobile
  const mobileLog = useCallback((message: string) => {
    console.log(message);
    setMobileDebugLogs((prev) => [message, ...prev].slice(0, 20));
  }, []);

  useEffect(() => {
    // Check if we need a fresh page load
    const needsRefresh = sessionStorage.getItem('needsRefresh');

    if (needsRefresh === 'true') {
      // Clear the flag
      sessionStorage.removeItem('needsRefresh');

      // Force a page refresh
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    console.log = (...args) => {
      originalConsoleLog(...args);
      setMobileDebugLogs((prev) =>
        [`LOG: ${args.map((a) => JSON.stringify(a)).join(' ')}`, ...prev].slice(
          0,
          20
        )
      );
    };

    console.error = (...args) => {
      originalConsoleError(...args);
      setMobileDebugLogs((prev) =>
        [
          `ERROR: ${args.map((a) => JSON.stringify(a)).join(' ')}`,
          ...prev,
        ].slice(0, 20)
      );
    };

    return () => {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    };
  }, []);

  // Split the logic into two separate useEffects

  // First useEffect: Just handle getting the video source
  useEffect(() => {
    // Reset state
    setVideoDuration(0);
    setStartTime(0);
    setEndTime(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setThumbnails([]);
    setIsLoading(true);

    // Clear previous video
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    // Clear previous URL
    if (videoSrc) {
      URL.revokeObjectURL(videoSrc);
      setVideoSrc(null);
    }

    mobileLog('Cleared previous metadata and state');

    const videoStored = sessionStorage.getItem('videoStored');

    if (videoStored === 'true') {
      // Get from IndexedDB
      const request = indexedDB.open('VideoDatabase', 1);

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['videos'], 'readonly');
        const store = transaction.objectStore('videos');
        const getRequest = store.get('currentVideo');

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            const blob = getRequest.result.blob;
            const url = URL.createObjectURL(blob);
            setVideoSrc(url);
            mobileLog('Set video source from IndexedDB');
          } else {
            mobileLog('No video found in IndexedDB');
          }
        };

        getRequest.onerror = (error) => {
          mobileLog(`Error retrieving from IndexedDB: ${error}`);
        };
      };
      request.onerror = (event) => {
        mobileLog(`Error opening IndexedDB: ${event}`);
      };
    } else {
      // Try sessionStorage as fallback
      const recordedVideo = sessionStorage.getItem('recordedVideo');
      if (recordedVideo) {
        setVideoSrc(recordedVideo);
        mobileLog('Set video source from sessionStorage');
      } else {
        mobileLog('No video found in storage');
      }
    }

    // Cleanup function
    return () => {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
      }
    };
  }, []); // Empty dependency array - run once on mount

  // Second useEffect: Handle duration detection AFTER video source is set
  useEffect(() => {
    // Only run this effect if we have a video source
    if (!videoSrc) return;

    mobileLog(`Starting duration detection for video: ${videoSrc}`);

    // Method 1: Try getBlobDuration
    getBlobDuration(videoSrc)
      .then((duration) => {
        mobileLog(`getBlobDuration result: ${duration}`);
        if (duration && isFinite(duration) && duration > 0) {
          setVideoDuration(duration);
          setEndTime(duration);
          setIsLoading(false);
          mobileLog(`Duration set from getBlobDuration: ${duration}`);
        }
      })
      .catch((error) => {
        mobileLog(`getBlobDuration failed: ${error.message}`);
      });

    // Method 2: Wait for the video element's metadata to load
    const handleTimeUpdate = () => {
      if (videoRef.current && videoRef.current.duration) {
        const duration = videoRef.current.duration;
        if (isFinite(duration) && duration > 0 && videoDuration <= 0) {
          console.log(`Duration detected from timeupdate: ${duration}`);
          setVideoDuration(duration);
          setEndTime(duration);
          setIsLoading(false);
          videoRef.current.removeEventListener('timeupdate', handleTimeUpdate);
        }
      }
    };

    if (videoRef.current) {
      videoRef.current.addEventListener('timeupdate', handleTimeUpdate);
      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('timeupdate', handleTimeUpdate);
        }
      };
    }
  }, [videoSrc]); // This effect runs whenever videoSrc changes

  // Update current time as video plays
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);

      // If playing and current time is past end time, reset to start time
      if (videoRef.current.currentTime >= endTime) {
        videoRef.current.currentTime = startTime;

        if (isPlaying) {
          videoRef.current.play().catch((err) => {
            console.error('Error restarting playback:', err);
            setIsPlaying(false);
          });
        }
      }
    }
  }, [startTime, endTime, isPlaying]);

  // Ensure generateThumbnauls is called at the right time
  useEffect(() => {
    if (
      videoSrc &&
      videoDuration > 0 &&
      !isLoading &&
      thumbnails.length === 0
    ) {
      console.log('Attempting to generate thumbnails...');
      generateThumbnails();
    }
  }, [videoSrc, videoDuration, isLoading, thumbnails.length]);

  // Generate thumbnails for the timeline
  const generateThumbnails = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || videoDuration <= 0) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 120;
    canvas.height = 90;

    const numThumbnails = 10;
    const newThumbnails: string[] = [];

    // Store original time to restore later
    const originalTime = video.currentTime;

    for (let i = 0; i < numThumbnails; i++) {
      const time = (videoDuration / numThumbnails) * i;
      console.log(`Generating thumbnail at ${time}s`);

      try {
        // Set video to specific time
        video.currentTime = time;

        // Wait for the video to seek to that time
        await new Promise<void>((resolve, reject) => {
          const seekHandler = () => {
            video.removeEventListener('seeked', seekHandler);
            video.removeEventListener('error', errorHandler);
            resolve();
          };

          const errorHandler = () => {
            video.removeEventListener('seeked', seekHandler);
            video.removeEventListener('error', errorHandler);
            reject(new Error('Error seeking video'));
          };

          video.addEventListener('seeked', seekHandler);
          video.addEventListener('error', errorHandler);

          // Add timeout in case event never fires
          setTimeout(() => {
            video.removeEventListener('seeked', seekHandler);
            video.removeEventListener('error', errorHandler);
            resolve(); // Resolve anyway to continue
          }, 1000);
        });

        // Draw the current frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL('image/jpeg', 0.7);
        newThumbnails.push(dataURL);
        console.log(`Generated thumbnail ${i + 1}/${numThumbnails}`);
      } catch (err) {
        console.error('Error generating thumbnail:', err);
      }
    }

    // Reset video position
    try {
      video.currentTime = originalTime;
    } catch (e) {
      console.error('Error resetting video time:', e);
    }

    console.log(`Generated ${newThumbnails.length} thumbnails`);
    setThumbnails(newThumbnails);
  }, [videoDuration]);

  // Handle play/pause
  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      // If outside trim range, reset to start
      if (
        videoRef.current.currentTime < startTime ||
        videoRef.current.currentTime >= endTime
      ) {
        videoRef.current.currentTime = startTime;
      }
      videoRef.current.play();
    }

    setIsPlaying(!isPlaying);
  }, [isPlaying, startTime, endTime]);

  // Format time display
  const formatTime = (time: number): string => {
    if (!isFinite(time) || isNaN(time)) {
      return '0:00';
    }
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle drag events for trim handles
  useEffect(() => {
    if (!containerRef.current || !videoRef.current || videoDuration <= 0)
      return;

    const container = containerRef.current;
    const videoElement = videoRef.current;
    const containerWidth = container.offsetWidth;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const containerRect = container.getBoundingClientRect();

      // Get x position relative to container
      let clientX: number;
      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      } else if ('clientX' in e) {
        clientX = e.clientX;
      } else {
        return; // Exit if position cant be found
      }

      const relativeX = clientX - containerRect.left;
      const percentage = Math.max(0, Math.min(1, relativeX / containerWidth));
      const timePosition = percentage * videoDuration;

      // Update state based on which handle is being dragged
      if (isDraggingLeftRef.current) {
        const newStartTime = Math.min(timePosition, endTime - 0.5);
        setStartTime(Math.max(0, newStartTime));
        videoElement.currentTime = newStartTime;
        setCurrentTime(newStartTime);
      } else if (isDraggingRightRef.current) {
        const newEndTime = Math.max(timePosition, startTime + 0.5);
        setEndTime(Math.min(videoDuration, newEndTime));
        videoElement.currentTime = newEndTime;
        setCurrentTime(newEndTime);
      }
    };

    const handleMouseUp = () => {
      isDraggingLeftRef.current = false;
      isDraggingRightRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [startTime, endTime, videoDuration]);

  // Handle mouse/touch down on left handle
  const handleLeftHandleDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingLeftRef.current = true;
    },
    [videoDuration]
  );

  // Handle mouse/touch down on right handle
  const handleRightHandleDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRightRef.current = true;
    },
    [videoDuration]
  );

  // Handle direct clicks on timeline
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || !videoRef.current || videoDuration <= 0)
        return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left;
      const percentage = Math.max(
        0,
        Math.min(1, relativeX / containerRect.width)
      );
      const newTime = percentage * videoDuration;

      // Only update if within trim range
      if (newTime >= startTime && newTime <= endTime) {
        videoRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      }
    },
    [startTime, endTime, videoDuration]
  );

  const handleVideoEnded = useCallback((): void => {
    mobileLog('Video playback ended');

    // Update playing state
    setIsPlaying(false);

    // Reset to start of trim range
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
      setCurrentTime(startTime);
      mobileLog(`Reset to trim start position: ${startTime}s`);
    }
  }, [startTime]);

  interface VideoBlob {
    size: number;
  }

  const isValidVideoBlob = async (blob: VideoBlob | null): Promise<boolean> => {
    if (!blob || blob.size < 10000) {
      return false;
    }

    // Create an object URL from the blob
    const url = URL.createObjectURL(blob as Blob);

    // Create a video element to test the blob
    const video = document.createElement('video');

    try {
      // Try load video metadata
      const result = await new Promise<boolean>((resolve) => {
        video.onloadedmetadata = () => resolve(true);
        video.onerror = () => resolve(false);

        // Set timeout in case it hangs
        setTimeout(() => resolve(false), 3000);

        video.src = url;
        video.load();
      });

      return result;
    } catch (e) {
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  interface UploadMetadata {
    duration: string;
    originalStart: string;
    originalEnd: string;
    trimmed: string;
    width: string;
    height: string;
  }

  interface GenerateSignedUrlResponse {
    url: string;
    publicUrl: string;
  }

  async function uploadBlobToGCS(
    blob: Blob,
    width: number,
    height: number,
    duration: number
  ): Promise<void> {
    mobileLog(`Uploading video, size: ${blob.size / 1024} KB`);

    const timestamp = Date.now();
    const fullPath = `unprocessed_video/user/trim-${timestamp}.mp4`;

    const { url, publicUrl }: GenerateSignedUrlResponse =
      await generateSignedUrl({
        filename: fullPath,
        contentType: 'video/mp4',
        metadata: {
          duration: duration.toString(),
          originalStart: startTime.toString(),
          originalEnd: endTime.toString(),
          trimmed: 'true',
          width: width.toString(),
          height: height.toString(),
        } as UploadMetadata,
      });

    // Upload with explicit content type
    mobileLog(`Starting upload to signed URL`);

    // Before uploading
    if (blob.size < 10000) {
      setUploadError('Video file is too small (less than 10KB)');
      return;
    }

    if (blob.size > 104857600) {
      // 100MB
      setUploadError('Video file is too large (more than 100MB)');
      return;
    }

    const uploadResponse: Response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      const errorText: string = await uploadResponse
        .text()
        .catch(() => 'Unknown error');
      mobileLog(`Upload failed: ${uploadResponse.status} - ${errorText}`);
      throw new Error(
        `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
      );
    }

    mobileLog(`Upload completed successfully`);

    setUploadProgress(100);
    setUploadedVideoUrl(publicUrl);

    // Store trim information for reference
    sessionStorage.setItem(
      'trimInfo',
      JSON.stringify({
        videoUrl: publicUrl,
        fileName: fullPath,
        startTime: 0,
        endTime: duration,
        duration: duration,
      })
    );
  }

  // Enhanced iOS video trimming and compression functions
  async function processVideoForIOS(
    sourceVideo: HTMLVideoElement,
    startTime: number,
    endTime: number
  ): Promise<Blob | null> {
    mobileLog(
      `Starting iOS-optimized video processing: ${startTime}s to ${endTime}s`
    );

    // Lower resolution for better iOS compatibility
    const compressionSettings = {
      targetWidth: Math.min(480, sourceVideo.videoWidth || 480),
      targetHeight: Math.min(320, sourceVideo.videoHeight || 320),
      framerate: 20, // Lower framerate for better iOS compatibility
      videoBitrate: 1500000, // Lower bitrate for iOS
      keyframeInterval: 20,
    };

    // Calculate dimensions while preserving aspect ratio
    const aspectRatio =
      (sourceVideo.videoWidth || 16) / (sourceVideo.videoHeight || 9);
    let targetWidth = compressionSettings.targetWidth;
    let targetHeight = compressionSettings.targetHeight;

    if (aspectRatio > targetWidth / targetHeight) {
      targetHeight = Math.round(targetWidth / aspectRatio);
    } else {
      targetWidth = Math.round(targetHeight * aspectRatio);
    }

    // Make dimensions even (required for some encoders)
    targetWidth = targetWidth - (targetWidth % 2);
    targetHeight = targetHeight - (targetHeight % 2);

    mobileLog(`Compression dimensions: ${targetWidth}x${targetHeight}`);

    // Create compression canvas
    const compressionCanvas = document.createElement('canvas');
    compressionCanvas.width = targetWidth;
    compressionCanvas.height = targetHeight;
    const compCtx = compressionCanvas.getContext('2d', { alpha: false });

    if (!compCtx) {
      throw new Error('Could not create compression canvas context');
    }

    // For iOS, we'll use a simpler approach - direct frame capture method
    try {
      mobileLog('Using simplified frame capture method for iOS');

      // Determine the safest mime type and codec
      let mimeType = 'video/mp4';

      // Test for codec support - use a series of iOS-friendly formats
      for (const type of [
        'video/mp4',
        'video/webm;codecs=h264',
        'video/webm',
      ]) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          mobileLog(`iOS compatible mime type found: ${type}`);
          break;
        }
      }

      // Create a MediaRecorder with basic settings
      const stream = compressionCanvas.captureStream(
        compressionSettings.framerate
      );
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: compressionSettings.videoBitrate,
      });

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);

      // Set up recording completion promise
      const recordingPromise = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          try {
            const blob = new Blob(chunks, { type: mimeType });
            mobileLog(`Recording complete: ${blob.size / 1024}KB`);
            resolve(blob);
          } catch (e) {
            reject(e);
          }
        };

        recorder.onerror = (event: Event) => {
          reject(
            new Error(
              `MediaRecorder error: ${event instanceof ErrorEvent ? event.message : 'Unknown error'}`
            )
          );
        };
      });

      // Start recording with small time slices for more reliable operation on iOS
      recorder.start(100);

      // Position video at start
      sourceVideo.currentTime = startTime;

      // Wait for seeking to complete with timeout
      await new Promise<void>((resolve) => {
        const seekHandler = () => {
          sourceVideo.removeEventListener('seeked', seekHandler);
          resolve();
        };

        sourceVideo.addEventListener('seeked', seekHandler, { once: true });
        setTimeout(resolve, 1000); // Timeout fallback
      });

      // Extract frames manually - critical for iOS
      const duration = endTime - startTime;
      const totalFrames = Math.ceil(duration * compressionSettings.framerate);

      mobileLog(`Starting frame extraction: ${totalFrames} frames`);

      for (let i = 0; i < totalFrames; i++) {
        // Calculate time for this frame
        const frameTime = startTime + i / compressionSettings.framerate;

        // Don't go past the end time
        if (frameTime > endTime) break;

        // Update video position (less frequent seeking for better stability)
        if (i % 5 === 0) {
          sourceVideo.currentTime = frameTime;

          // Short delay to allow seeking
          await new Promise((r) => setTimeout(r, 50));
        }

        // Draw the current frame
        compCtx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);

        // Log progress periodically
        if (i % 10 === 0) {
          mobileLog(`Captured frame ${i}/${totalFrames}`);
        }

        // Small delay to allow UI updates
        await new Promise((r) => setTimeout(r, 10));
      }

      // Stop recording after a slight delay
      setTimeout(() => {
        try {
          recorder.stop();
        } catch (e) {
          mobileLog(
            `Error stopping recorder: ${e instanceof Error ? e.message : 'Unknown error'}`
          );
        }
      }, 500);

      // Return the recorded blob
      return await recordingPromise;
    } catch (e) {
      mobileLog(
        `iOS frame capture error: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
      return null;
    }
  }

  interface CompressionSettings {
    targetWidth: number;
    targetHeight: number;
    framerate: number;
    videoBitrate: number;
    keyframeInterval: number;
  }

  async function singlePassIOSExtraction(
    sourceVideo: HTMLVideoElement,
    startTime: number,
    endTime: number
  ): Promise<Blob | null> {
    mobileLog(
      `Starting iOS-compatible extraction: ${startTime}s to ${endTime}s`
    );

    // Create a smaller canvas for higher compatibility
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(360, sourceVideo.videoWidth || 360);
    canvas.height = Math.min(240, sourceVideo.videoHeight || 240);
    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      mobileLog('Failed to create canvas context');
      return null;
    }

    try {
      // Find the most compatible recording options
      let mimeType = '';
      let recorder: MediaRecorder;

      // Test MIME types in order of preference
      const mimeTypes = [
        'video/mp4',
        'video/webm',
        'video/webm;codecs=h264',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        '',
      ];

      for (const type of mimeTypes) {
        if (!type || MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          mobileLog(`Using mime type: ${type || 'browser default'}`);
          break;
        }
      }

      // Create recorder with the most basic options possible
      const stream = canvas.captureStream(15); // Lower framerate for iOS

      try {
        recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined
        );
      } catch (e) {
        mobileLog(`Failed to create recorder with mime type, using default`);
        recorder = new MediaRecorder(stream);
      }

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);

      // Start recording
      recorder.start(200); // Smaller chunks for iOS

      // Set up promise to track recording completion
      const recordingPromise = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
          mobileLog(`Recording completed, size: ${blob.size / 1024}KB`);
          resolve(blob);
        };
        recorder.onerror = (e) => reject(e);
      });

      // Position video at start time
      sourceVideo.currentTime = startTime;

      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        const seekHandler = () => {
          sourceVideo.removeEventListener('seeked', seekHandler);
          resolve();
        };
        sourceVideo.addEventListener('seeked', seekHandler, { once: true });
        setTimeout(resolve, 1000); // Fallback
      });

      // Instead of relying on video.play(), manually step through frames
      const frameInterval = 1000 / 15; // 15fps
      const duration = endTime - startTime;
      const totalFrames = Math.ceil(duration * 15);

      for (let i = 0; i < totalFrames; i++) {
        const currentTime = startTime + i * (1 / 15);

        if (currentTime > endTime) break;

        // Update video position (less frequent for stability)
        if (i % 3 === 0) {
          sourceVideo.currentTime = currentTime;
          await new Promise((r) => setTimeout(r, 30));
        }

        // Draw current frame
        ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);

        // Wait for next frame time
        await new Promise((r) => setTimeout(r, 30));
      }

      // Stop recording
      setTimeout(() => {
        try {
          recorder.stop();
        } catch (e) {
          mobileLog(
            `Error stopping recorder: ${e instanceof Error ? e.message : 'Unknown error'}`
          );
        }
      }, 500);

      return await recordingPromise;
    } catch (e) {
      mobileLog(
        `Single pass extraction error: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
      return null;
    }
  }

  async function imageSequenceIOSWorkaround(
    sourceVideo: HTMLVideoElement,
    startTime: number,
    endTime: number
  ): Promise<Blob | null> {
    mobileLog('Using image sequence workaround for iOS');

    try {
      // Capture a series of JPEG images
      const framerate = 10; // Lower for compatibility
      const duration = endTime - startTime;
      const frameCount = Math.ceil(duration * framerate);
      const images: string[] = [];

      // Create temporary canvas for frame capture
      const canvas = document.createElement('canvas');
      const width = Math.min(360, sourceVideo.videoWidth || 360);
      const height = Math.min(240, sourceVideo.videoHeight || 240);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });

      if (!ctx) {
        throw new Error('Failed to create canvas context');
      }

      // Capture frames
      for (let i = 0; i < frameCount; i++) {
        const frameTime = startTime + i / framerate;

        // Set video position
        sourceVideo.currentTime = frameTime;

        // Wait for seeking to complete
        await new Promise<void>((resolve) => {
          const seekHandler = () => {
            sourceVideo.removeEventListener('seeked', seekHandler);
            resolve();
          };
          sourceVideo.addEventListener('seeked', seekHandler, { once: true });
          setTimeout(resolve, 200); // Fallback
        });

        // Draw and capture frame
        ctx.drawImage(sourceVideo, 0, 0, width, height);
        const imageData = canvas.toDataURL('image/jpeg', 0.7);
        images.push(imageData);

        // Log progress
        if (i % 5 === 0) {
          mobileLog(`Captured frame ${i + 1}/${frameCount}`);
        }
      }

      mobileLog(`Captured ${images.length} frames as images`);

      // Now build a video from these images
      const videoCanvas = document.createElement('canvas');
      videoCanvas.width = width;
      videoCanvas.height = height;
      const videoCtx = videoCanvas.getContext('2d');

      if (!videoCtx) {
        throw new Error('Failed to create video canvas context');
      }

      // Use MediaRecorder to create a video
      let mimeType = '';
      for (const type of ['video/mp4', 'video/webm', '']) {
        if (!type || MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      const stream = videoCanvas.captureStream(framerate);
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);

      // Create promise for recording completion
      const recordingPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
          mobileLog(`Video created from images: ${blob.size / 1024}KB`);
          resolve(blob);
        };
      });

      // Start recording
      recorder.start(100);

      // Play back the image sequence
      let frameIndex = 0;
      const playImages = async () => {
        if (frameIndex < images.length) {
          // Load the image
          const img = new Image();
          img.onload = () => {
            // Draw the image to canvas
            videoCtx.drawImage(img, 0, 0, width, height);

            // Move to next frame
            frameIndex++;

            // Schedule next frame
            setTimeout(playImages, 1000 / framerate);
          };
          img.src = images[frameIndex];
        } else {
          // All frames done, stop recording
          setTimeout(() => {
            try {
              recorder.stop();
            } catch (e) {
              mobileLog(
                `Error stopping recorder: ${e instanceof Error ? e.message : 'Unknown error'}`
              );
            }
          }, 200);
        }
      };

      // Start playback
      playImages();

      // Return the resulting video blob
      return await recordingPromise;
    } catch (e) {
      mobileLog(
        `Image sequence error: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
      return null;
    }
  }

  // Approach B: Frame-by-frame extraction (for devices with good seeking)
  async function frameByFrameExtraction(
    sourceVideo: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    startTime: number,
    endTime: number,
    width: number,
    height: number,
    settings: CompressionSettings
  ): Promise<Blob | null> {
    const trimDuration = endTime - startTime;
    const framerate = settings.framerate;
    const frameCount = Math.ceil(trimDuration * framerate);

    mobileLog(`Capturing ${frameCount} frames at ${framerate}fps`);

    // Capture frames approach
    let frames: ImageData[] = [];
    for (let i = 0; i < frameCount; i++) {
      const frameTime = startTime + i / framerate;

      // Seek to specific time
      sourceVideo.currentTime = frameTime;

      // Wait for seek with timeout
      await new Promise<void>((resolve) => {
        const seekHandler = () => {
          sourceVideo.removeEventListener('seeked', seekHandler);
          resolve();
        };

        sourceVideo.addEventListener('seeked', seekHandler, { once: true });

        // Timeout fallback
        setTimeout(resolve, 500);
      });

      // Draw and capture frame
      ctx.drawImage(sourceVideo, 0, 0, width, height);
      frames.push(ctx.getImageData(0, 0, width, height));

      // Log progress periodically
      if (i % 10 === 0) {
        mobileLog(`Captured frame ${i + 1}/${frameCount}`);
      }
    }

    mobileLog(`All ${frames.length} frames captured, creating video...`);

    // Set up MediaRecorder
    let mimeType = '';
    const codecOptions: Record<string, any> = {};

    // Find supported codec with fallbacks
    for (const type of [
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
      '',
    ]) {
      if (!type || MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        if (type) {
          codecOptions.mimeType = type;
          codecOptions.videoBitsPerSecond = settings.videoBitrate;
        }
        mobileLog(`Using codec: ${type || 'browser default'}`);
        break;
      }
    }

    // Create stream from canvas
    const canvasStream = canvas.captureStream(framerate);

    // Set up recorder
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        canvasStream,
        codecOptions as MediaRecorderOptions
      );
    } catch (e) {
      mobileLog(
        `MediaRecorder creation failed with options: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
      try {
        recorder = new MediaRecorder(canvasStream);
        mobileLog('Created MediaRecorder with default options');
      } catch (e2) {
        mobileLog(
          `MediaRecorder creation completely failed: ${e2 instanceof Error ? e2.message : 'Unknown error'}`
        );
        throw new Error('Cannot create MediaRecorder on this device');
      }
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);

    // Set up recording promise
    const recordingPromise = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        try {
          const videoType = mimeType || 'video/webm';
          const blob = new Blob(chunks, { type: videoType });
          mobileLog(`Recording completed: ${blob.size / 1024}KB`);
          resolve(blob);
        } catch (e) {
          reject(e);
        }
      };

      recorder.onerror = (e: Event) => {
        if (e instanceof ErrorEvent) {
          reject(new Error(`MediaRecorder error: ${e.message}`));
        } else {
          reject(new Error(`MediaRecorder error: Unknown error`));
        }
      };
    });

    // Start recording
    recorder.start(Math.ceil(1000 / framerate) * settings.keyframeInterval);

    // Play back the frames at the correct rate
    let frameIndex = 0;
    const interval = setInterval((): void => {
      if (frameIndex < frames.length) {
        ctx.putImageData(frames[frameIndex], 0, 0);
        frameIndex++;
      } else {
        clearInterval(interval);
        // Wait a bit to ensure last frame is captured
        setTimeout(() => {
          try {
            recorder.stop();
          } catch (e) {
            mobileLog(
              `Error stopping recorder: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
          }
        }, 200);
      }
    }, 1000 / framerate);

    // Wait for recording to complete
    return await recordingPromise;
  }

  // Simple extraction fallback function (last resort before using original)
  async function extractVideoSegmentFallback(
    videoUrl: string,
    startTime: number,
    endTime: number
  ): Promise<Blob | null> {
    const video = document.createElement('video');
    video.src = videoUrl;

    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve();
      video.load();
      setTimeout(resolve, 2000); // Failsafe
    });

    // Create a low-res canvas for higher compatibility
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(480, video.videoWidth || 480);
    canvas.height = Math.min(320, video.videoHeight || 320);
    const ctx = canvas.getContext('2d');

    // Try to use captureStream for more direct recording
    const stream = canvas.captureStream(15); // Lower framerate for compatibility

    try {
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);

      const recordingPromise = new Promise<Blob>((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;

        recorder.onstop = () => {
          clearTimeout(timeoutId);
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve(blob);
        };

        recorder.onerror = (e: Event) => {
          clearTimeout(timeoutId);
          if (e instanceof ErrorEvent) {
            reject(new Error(`Recorder error: ${e.message}`));
          } else {
            reject(new Error('Unknown recorder error'));
          }
        };

        // Safety timeout
        timeoutId = setTimeout(
          () => {
            try {
              if (recorder.state === 'recording') recorder.stop();
            } catch (e) {
              reject(e);
            }
          },
          (endTime - startTime) * 1000 + 3000
        );
      });

      // Start recording
      recorder.start(1000);

      // Position and play video
      video.currentTime = startTime;

      // Wait a moment to ensure seeking completes
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      // Function to draw frames
      const drawFrame = (): void => {
        if (video.currentTime < endTime) {
          ctx!.drawImage(video, 0, 0, canvas.width, canvas.height);
          requestAnimationFrame(drawFrame);
        } else {
          setTimeout(() => {
            try {
              recorder.stop();
            } catch (e: unknown) {
              mobileLog(
                `Error stopping fallback recorder: ${e instanceof Error ? e.message : 'Unknown error'}`
              );
            }
          }, 200);
        }
      };

      // Start playback and drawing
      await video.play();
      drawFrame();

      // Wait for recording to complete
      return await recordingPromise;
    } catch (e) {
      if (e instanceof Error) {
        mobileLog(`Fallback extraction error: ${e.message}`);
      } else {
        mobileLog('Fallback extraction error: Unknown error');
      }
      return null;
    }
  }

  // Upload trimmed video to GCS
  async function uploadTrimmedVideo() {
    // Reset states
    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    setUploadedVideoUrl(null);

    // Track progress outside React state to avoid conflicts
    let lastProgress = 0;

    // Function to safely update progress (never go backwards)
    const updateProgress = (newProgress: number): void => {
      if (newProgress > lastProgress) {
        lastProgress = newProgress;
        setUploadProgress(Math.round(newProgress));
      }
    };

    // Create smooth progress simulation
    const simulationInterval = setInterval((): void => {
      // Different acceleration rates for different phases
      if (lastProgress < 30) {
        updateProgress(lastProgress + 0.3);
      } else if (lastProgress < 70) {
        updateProgress(lastProgress + 0.15);
      } else if (lastProgress < 90) {
        updateProgress(lastProgress + 0.1);
      } else if (lastProgress < 98) {
        updateProgress(lastProgress + 0.05);
      }
    }, 200);

    try {
      // 1. Validate we have what we need
      if (!videoRef.current || !videoSrc) {
        throw new Error('Video not available for trimming');
      }

      mobileLog(`Starting video processing`);

      // 2. Set up video for processing
      const sourceVideo: HTMLVideoElement = document.createElement('video');
      sourceVideo.src = videoSrc;
      sourceVideo.muted = true;

      // Wait for video metadata to load and validate source
      const sourceValid = await new Promise<boolean>((resolve) => {
        sourceVideo.onloadedmetadata = () => {
          mobileLog(
            `Source video metadata loaded: ${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`
          );
          resolve(true);
        };
        sourceVideo.onerror = () => {
          mobileLog('Error loading source video');
          resolve(false);
        };
        setTimeout(() => resolve(false), 3000);
      });

      if (!sourceValid) {
        throw new Error('Source video could not be loaded');
      }

      // 3. Check trim duration
      const trimDuration = endTime - startTime;
      if (trimDuration > 8) {
        clearInterval(simulationInterval);
        setUploadError(
          'Video must be less than 8 seconds for analysis, please trim the video shorter.'
        );
        setIsUploading(false);
        return;
      }

      // 4. Detect iOS
      const isiOSDevice =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      mobileLog(`Device detected as iOS: ${isiOSDevice}`);

      if (isiOSDevice) {
        mobileLog('Using iOS-specific processing approaches');

        // Try multiple approaches in sequence until one works
        let processedBlob: Blob | null = null;

        // Approach 1: Try the improved processVideoForIOS function
        try {
          mobileLog('Trying primary iOS method');
          processedBlob = await processVideoForIOS(
            sourceVideo,
            startTime,
            endTime
          );

          if (processedBlob && processedBlob.size >= 10000) {
            mobileLog(
              `Primary method successful: ${processedBlob.size / 1024}KB`
            );
          } else {
            mobileLog('Primary method failed or produced too small output');
            processedBlob = null;
          }
        } catch (e) {
          mobileLog(
            `Primary method error: ${e instanceof Error ? e.message : 'Unknown error'}`
          );
        }

        // Approach 2: Try single pass extraction if first method failed
        if (!processedBlob) {
          try {
            mobileLog('Trying secondary iOS method');
            processedBlob = await singlePassIOSExtraction(
              sourceVideo,
              startTime,
              endTime
            );

            if (processedBlob && processedBlob.size >= 10000) {
              mobileLog(
                `Secondary method successful: ${processedBlob.size / 1024}KB`
              );
            } else {
              mobileLog('Secondary method failed or produced too small output');
              processedBlob = null;
            }
          } catch (e) {
            mobileLog(
              `Secondary method error: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
          }
        }

        // Approach 3: Try image sequence workaround if previous methods failed
        if (!processedBlob) {
          try {
            mobileLog('Trying image sequence method');
            processedBlob = await imageSequenceIOSWorkaround(
              sourceVideo,
              startTime,
              endTime
            );

            if (processedBlob && processedBlob.size >= 10000) {
              mobileLog(
                `Image sequence method successful: ${processedBlob.size / 1024}KB`
              );
            } else {
              mobileLog(
                'Image sequence method failed or produced too small output'
              );
              processedBlob = null;
            }
          } catch (e) {
            mobileLog(
              `Image sequence method error: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
          }
        }

        // If we have a processed blob, upload it
        if (processedBlob && processedBlob.size >= 10000) {
          await uploadBlobToGCS(
            processedBlob,
            sourceVideo.videoWidth > 0
              ? Math.min(sourceVideo.videoWidth, 640)
              : 640,
            sourceVideo.videoHeight > 0
              ? Math.min(sourceVideo.videoHeight, 360)
              : 360,
            endTime - startTime
          );
          clearInterval(simulationInterval);
          return;
        }

        // Last resort: Use original video with warning
        mobileLog('⚠️ WARNING: All iOS methods failed, using original video');
        const response = await fetch(videoSrc);
        const originalBlob = await response.blob();

        setUploadError(
          'Video processing not supported on this device. Using original video for analysis.'
        );

        await uploadBlobToGCS(
          originalBlob,
          sourceVideo.videoWidth || 640,
          sourceVideo.videoHeight || 480,
          endTime - startTime
        );

        clearInterval(simulationInterval);
        return;
      }

      // ----- Standard approach for non-iOS devices -----
      mobileLog(`Starting standard trim from ${startTime}s to ${endTime}s`);

      // Call the standardTrimVideo function
      const trimmedBlob = await standardTrimVideo(
        sourceVideo,
        canvasRef.current!,
        canvasRef.current?.getContext('2d')!,
        startTime,
        endTime
      );

      // Compress the trimmed video before upload
      console.log('Original size:', trimmedBlob.size / (1024 * 1024), 'MB');

      // Import ffmpeg only when needed (dynamic import)
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');

      // Create FFmpeg instance
      const ffmpeg = new FFmpeg();
      console.log('Loading FFmpeg...');
      mobileLog('Loading FFmpeg for compression...');

      await ffmpeg.load();
      console.log('FFmpeg loaded');
      mobileLog('FFmpeg loaded successfully');

      // Write input file
      const inputFileName = 'input.mp4';
      const outputFileName = 'compressed.mp4';
      console.log('Writing file to FFmpeg...');
      mobileLog('Writing input file to FFmpeg...');

      await ffmpeg.writeFile(inputFileName, await fetchFile(trimmedBlob));
      console.log('File written to FFmpeg');
      mobileLog('Input file written successfully');

      updateProgress(40);

      // Set compression parameters - adjust these for quality vs size
      await ffmpeg.exec([
        '-i',
        inputFileName,
        '-c:v',
        'libx264',
        '-profile:v',
        'baseline',
        '-level',
        '3.0',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'fast',
        '-crf',
        '28',
        '-an', // Remove audio
        '-movflags',
        '+faststart',
        outputFileName,
      ]);

      updateProgress(70);

      const timestamp = Date.now();
      const fullPath = `unprocessed_video/user/trim-${timestamp}.mp4`;

      const { url, publicUrl } = await generateSignedUrl({
        filename: fullPath,
        contentType: 'video/mp4',
        metadata: {
          duration: trimDuration.toString(),
          originalStart: startTime.toString(),
          originalEnd: endTime.toString(),
          trimmed: 'true',
          width: canvasRef.current?.width.toString() || '0',
          height: canvasRef.current?.height.toString() || '0',
        },
      });

      // Read the compressed file
      const data = await ffmpeg.readFile(outputFileName);
      const compressedBlob = new Blob([data], { type: 'video/mp4' });
      console.log(
        'Compressed size:',
        compressedBlob.size / (1024 * 1024),
        'MB'
      );

      updateProgress(80);

      // Before uploading
      if (compressedBlob.size < 10000) {
        setUploadError('Video file is too small (less than 10KB)');
        return;
      }

      if (compressedBlob.size > 104857600) {
        // 100MB
        setUploadError('Video file is too large (more than 100MB)');
        return;
      }

      // 6. Upload the trimmed video to GCS using signed URL
      const uploadResponse = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: compressedBlob,
      });

      if (!uploadResponse.ok) {
        throw new Error(
          `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
        );
      }

      clearInterval(simulationInterval);
      setUploadProgress(100);
      setUploadedVideoUrl(publicUrl);

      // Store trim information for reference
      const trimInfo = {
        videoUrl: publicUrl,
        fileName: fullPath,
        startTime: 0, // Since we've already trimmed, the new video starts at 0
        endTime: trimDuration,
        duration: trimDuration,
      };

      sessionStorage.setItem(
        'trimInfo',
        JSON.stringify({
          videoUrl: publicUrl,
          fileName: fullPath,
          startTime: 0,
          endTime: endTime - startTime,
          duration: endTime - startTime,
        })
      );

      // Redirect to results page
      // router.push('/analyse/results');
    } catch (error) {
      console.error('Error creating or uploading trimmed video:', error);
      setUploadError((error as Error).message);
    } finally {
      clearInterval(simulationInterval);
      setIsUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black overflow-hidden touch-none bg-opacity-90">
      {videoSrc ? (
        <>
          {/* Video preview */}
          <div className="flex-1 flex justify-center items-center relative mb-4 rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={videoSrc}
              className="max-w-full max-h-fit object-contain rounded-lg"
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleVideoEnded}
              onClick={handlePlayPause}
              preload="metadata"
              playsInline
              muted
              controls={false}
              autoPlay={false}
              disablePictureInPicture
              webkit-playsinline="true"
              onLoadedMetadata={() => {
                mobileLog(
                  `onLoadedMetadata fired, duration: ${videoRef.current?.duration}`
                );
                if (
                  videoRef.current &&
                  videoRef.current.duration &&
                  isFinite(videoRef.current.duration)
                ) {
                  setVideoDuration(videoRef.current.duration);
                  setEndTime(videoRef.current.duration);
                  setIsLoading(false);
                }
              }}
            />
          </div>
          {/* Play/Pause button */}
          <div className="flex justify-center mt-8 mb-4 relative z-10">
            <button
              onClick={handlePlayPause}
              className="w-10 h-10 bg-white/80 rounded-full flex items-center justify-center shadow-lg"
            >
              {isPlaying ? (
                /* Pause icon */
                <div className="flex space-x-1">
                  <div className="w-1 h-4 bg-black rounded-sm"></div>
                  <div className="w-1 h-4 bg-black rounded-sm"></div>
                </div>
              ) : (
                /* Play icon */
                <div className="w-8 h-8 flex justify-center items-center">
                  <div
                    className="w-0 h-0 ml-1"
                    style={{
                      borderTop: '8px solid transparent',
                      borderBottom: '8px solid transparent',
                      borderLeft: '14px solid black',
                    }}
                  ></div>
                </div>
              )}
            </button>
          </div>

          {/* Hidden canvas for thumbnails */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Timeline with iOS-style trim handles */}
          <div className="mb-20 rounded-xl bg-gray-700/80 p-2">
            {/* Time displays */}
            <div className="flex justify-between text-white text-xs mb-1 px-4">
              <span>{formatTime(startTime)}</span>
              <span>{formatTime(endTime)}</span>
            </div>

            {/* Thumbnails timeline */}
            <div
              ref={containerRef}
              className="relative h-16 mx-8 rounded-lg overflow-hidden"
              onClick={handleTimelineClick}
            >
              {/* Thumbnails */}
              <div className="flex h-full w-full bg-gray-900 rounded-lg">
                {thumbnails.length > 0 ? (
                  thumbnails.map((thumbnail, index) => (
                    <div
                      key={index}
                      className="h-full"
                      style={{ width: `${100 / thumbnails.length}%` }}
                    >
                      <img
                        src={thumbnail}
                        alt={`Thumbnail ${index}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))
                ) : (
                  // Fallback gradient if no thumbnails
                  <div className="h-full w-full bg-gradient-to-r from-blue-400 to-purple-500 flex items-center justify-center rounded-lg">
                    <div className="text-white text-sm">
                      Generating previews...
                    </div>
                  </div>
                )}
              </div>

              {/* Selected trim area */}
              <div
                className="absolute top-0 left-0 right-0 bottom-0 border-2 border-yellow-400 bg-yellow-400/20"
                style={{
                  left: `${(startTime / videoDuration) * 100}%`,
                  right: `${100 - (endTime / videoDuration) * 100}%`,
                }}
              ></div>

              {/* Left trim handle */}
              <div
                className="absolute top-0 bottom-0 w-6 bg-yellow-400 cursor-col-resize flex flex-col justify-between items-center py-1 touch-manipulation z-10"
                style={{
                  left: `calc(${(startTime / videoDuration) * 100}% - 8px)`,
                }}
                onMouseDown={handleLeftHandleDown}
                onTouchStart={handleLeftHandleDown}
              >
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
              </div>

              {/* Right trim handle */}
              <div
                className="absolute top-0 bottom-0 w-6 bg-yellow-400 cursor-col-resize flex flex-col justify-between items-center py-1 touch-manipulation z-10"
                style={{
                  right: `calc(${100 - (endTime / videoDuration) * 100}% - 8px)`,
                }}
                onMouseDown={handleRightHandleDown}
                onTouchStart={handleRightHandleDown}
              >
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
              </div>

              {/* Current time indicator */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
                style={{ left: `${(currentTime / videoDuration) * 100}%` }}
              ></div>
            </div>
            <div className="w-full flex items-center justify-center pt-4">
              {/* Analyse button */}
              <Button
                onClick={uploadTrimmedVideo}
                disabled={isUploading || !videoSrc || isLoading}
                className="text-md p-5"
              >
                {isUploading ? 'Uploading...' : 'Analyse Swing'}
              </Button>
            </div>

            {/* Loading indicator */}
            {isUploading && (
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-200 mt-1">
                  {uploadProgress < 30
                    ? 'Preparing video...'
                    : uploadProgress < 70
                      ? 'Compressing video...'
                      : uploadProgress < 90
                        ? 'Uploading video...'
                        : uploadProgress < 100
                          ? 'Finalizing...'
                          : 'Processing complete!'}
                  {` (${uploadProgress}%)`}
                </p>
              </div>
            )}

            {/* Error message */}
            {uploadError && (
              <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                <p>Error: {uploadError}</p>
              </div>
            )}

            {/* Success message */}
            {uploadedVideoUrl && (
              <div className="mt-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
                <p>
                  Video uploaded successfully! Your analysis will be ready soon.
                </p>
              </div>
            )}
          </div>

          {showDebugger && (
            <div className="fixed bottom-20 left-0 right-0 max-h-48 overflow-y-auto bg-black/80 text-white text-xs p-2 z-50">
              <div className="mb-2 flex justify-between">
                <div>Debug Console</div>
                <button onClick={() => setShowDebugger(false)}>Close</button>
              </div>
              {mobileDebugLogs.map((log, i) => (
                <div key={i} className="border-b border-gray-700 py-1">
                  {log}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowDebugger((prev) => !prev)}
            className="fixed top-2 right-2 bg-black/50 text-white text-xs p-1 rounded z-50"
          >
            Debug
          </button>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-white">Loading video...</div>
        </div>
      )}
    </div>
  );
}

export default EditPage;
