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
    const trimDuration = endTime - startTime;

    // 1. Better compression settings with iOS compatibility in mind
    const compressionSettings = {
      targetWidth: Math.min(640, sourceVideo.videoWidth || 640),
      targetHeight: Math.min(360, sourceVideo.videoHeight || 480),
      framerate: 24,
      videoBitrate: 2000000, // 2 Mbps - balanced quality
      keyframeInterval: 24, // Every second at 24fps
    };

    // Calculate dimensions while preserving aspect ratio
    const aspectRatio =
      (sourceVideo.videoWidth || 16) / (sourceVideo.videoHeight || 9);
    let targetWidth = compressionSettings.targetWidth;
    let targetHeight = compressionSettings.targetHeight;

    if (aspectRatio > targetWidth / targetHeight) {
      // Width bounded
      targetHeight = Math.round(targetWidth / aspectRatio);
    } else {
      // Height bounded
      targetWidth = Math.round(targetHeight * aspectRatio);
    }

    // Make dimensions even (required for some encoders)
    targetWidth = targetWidth - (targetWidth % 2);
    targetHeight = targetHeight - (targetHeight % 2);

    mobileLog(`Compression dimensions: ${targetWidth}x${targetHeight}`);

    // 2. Create compression canvas with reduced dimensions
    const compressionCanvas = document.createElement('canvas');
    compressionCanvas.width = targetWidth;
    compressionCanvas.height = targetHeight;
    const compCtx = compressionCanvas.getContext('2d', { alpha: false });

    if (!compCtx) {
      throw new Error('Could not create compression canvas context');
    }

    // 3. Two-pass approach: first verify we can seek properly
    mobileLog('Verifying video seeking capabilities...');

    // Test seek functionality
    let canSeekReliably = true;
    try {
      // Try to seek to start position
      sourceVideo.currentTime = startTime;

      // Wait for seek with strict verification
      await new Promise<void>((resolve, reject) => {
        const seekTimeout = setTimeout(() => {
          if (Math.abs(sourceVideo.currentTime - startTime) > 0.5) {
            canSeekReliably = false;
            mobileLog(
              `Seek verification failed. Target: ${startTime}, Actual: ${sourceVideo.currentTime}`
            );
          }
          resolve();
        }, 1500);

        const seeked = () => {
          clearTimeout(seekTimeout);
          resolve();
        };

        sourceVideo.addEventListener('seeked', seeked, { once: true });
      });
    } catch (e) {
      canSeekReliably = false;
      mobileLog(
        `Seek test error: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
    }

    // 4. Choose processing strategy based on seek capabilities
    if (!canSeekReliably) {
      // APPROACH A: Use time-based extraction for devices with poor seeking
      mobileLog('Using continuous playback approach for unreliable seeking');
      return await continuousPlaybackExtraction(
        sourceVideo,
        compressionCanvas,
        compCtx,
        startTime,
        endTime,
        targetWidth,
        targetHeight,
        compressionSettings
      );
    } else {
      // APPROACH B: Use frame-by-frame extraction for devices with good seeking
      mobileLog('Using frame-by-frame extraction approach');
      return await frameByFrameExtraction(
        sourceVideo,
        compressionCanvas,
        compCtx,
        startTime,
        endTime,
        targetWidth,
        targetHeight,
        compressionSettings
      );
    }
  }

  interface CompressionSettings {
    targetWidth: number;
    targetHeight: number;
    framerate: number;
    videoBitrate: number;
    keyframeInterval: number;
  }

  // Approach A: Continuous playback extraction (more reliable on problematic iOS devices)
  async function continuousPlaybackExtraction(
    sourceVideo: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    startTime: number,
    endTime: number,
    width: number,
    height: number,
    settings: CompressionSettings
  ): Promise<Blob | null> {
    // Create a MediaRecorder with iOS-compatible settings
    let mimeType = 'video/mp4';
    let codecOptions: Record<string, any> = {};

    // Test for codec support
    if (MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
      mobileLog('Using MP4 recording');
    } else if (MediaRecorder.isTypeSupported('video/webm')) {
      mimeType = 'video/webm';
      mobileLog('Using WebM recording');
    } else {
      mimeType = '';
      mobileLog('Using default browser codec');
    }

    if (mimeType) {
      codecOptions = {
        mimeType: mimeType,
        videoBitsPerSecond: settings.videoBitrate,
      };
    }

    // Start video at the beginning
    sourceVideo.currentTime = startTime;

    // Create a stream from the canvas
    const canvasStream = canvas.captureStream(settings.framerate);

    // Set up recorder
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        canvasStream,
        codecOptions as MediaRecorderOptions
      );
    } catch (e) {
      mobileLog(
        `MediaRecorder error with options, trying without options: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
      recorder = new MediaRecorder(canvasStream);
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);

    // Set up recording promise
    const recordingPromise = new Promise<Blob>((resolve, reject) => {
      let recordingTimeout: NodeJS.Timeout | undefined;

      recorder.onstop = () => {
        clearTimeout(recordingTimeout);
        try {
          const videoType = mimeType || 'video/webm';
          const blob = new Blob(chunks, { type: videoType });

          mobileLog(`Recording completed: ${blob.size / 1024}KB`);
          resolve(blob);
        } catch (e) {
          reject(e);
        }
      };

      recorder.onerror = (event: Event): void => {
        clearTimeout(recordingTimeout);
        reject(
          new Error(
            `MediaRecorder error: ${event instanceof ErrorEvent ? event.message : 'Unknown error'}`
          )
        );
      };

      // Safety timeout
      const duration = endTime - startTime;
      recordingTimeout = setTimeout(
        () => {
          try {
            if (recorder.state === 'recording') {
              recorder.stop();
            }
          } catch (e) {
            reject(e);
          }
        },
        duration * 1000 + 5000
      ); // Duration plus safety margin
    });

    // Start recording
    recorder.start(1000); // 1 second chunks

    // Draw frames while video plays
    const drawFrame = (): void => {
      if (sourceVideo.currentTime < endTime) {
        // Draw current frame to canvas
        ctx.drawImage(sourceVideo, 0, 0, width, height);

        // Continue animation if still within trim range
        requestAnimationFrame(drawFrame);
      } else {
        // Reached the end time, stop recording
        try {
          recorder.stop();
        } catch (e) {
          mobileLog(
            `Error stopping recorder: ${e instanceof Error ? e.message : 'Unknown error'}`
          );
        }
      }
    };

    // Play the video to drive the extraction
    try {
      sourceVideo.play();
      drawFrame(); // Start animation loop
    } catch (e) {
      mobileLog(
        `Error during playback: ${e instanceof Error ? e.message : 'Unknown error'}`
      );
      return null;
    }

    // Wait for recording to complete
    return await recordingPromise;
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
        // Preparing phase - move a bit faster
        updateProgress(lastProgress + 0.3);
      } else if (lastProgress < 70) {
        // Compression phase - move slower
        updateProgress(lastProgress + 0.15);
      } else if (lastProgress < 90) {
        // Upload phase - move very slowly
        updateProgress(lastProgress + 0.1);
      } else if (lastProgress < 98) {
        // Final phase - barely move
        updateProgress(lastProgress + 0.05);
      }
    }, 200);

    try {
      // 1. Validate we have what we need
      if (!videoRef.current || !videoSrc) {
        throw new Error('Video not available for trimming');
      }

      mobileLog(`Starting video processing`);

      // 2. Set up video and canvas for processing
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
        sourceVideo.onerror = (e) => {
          mobileLog(`Error loading source video: ${e}`);
          resolve(false);
        };
        setTimeout(() => resolve(false), 3000);
      });

      if (!sourceValid) {
        throw new Error('Source video could not be loaded');
      }

      // Create a canvas with the same dimensions as the video
      const canvas = document.createElement('canvas');
      canvas.width = sourceVideo.videoWidth || 640;
      canvas.height = sourceVideo.videoHeight || 480;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not create canvas context');
      }

      // 3. Perform the trimming operation
      console.log(`Starting trim operation from ${startTime}s to ${endTime}s`);

      // Progress update during trimming
      const trimDuration = endTime - startTime;
      if (trimDuration > 8) {
        clearInterval(simulationInterval);
        setUploadError(
          'Video must be less than 8 seconds for analysis, please trim the video shorter.'
        );
        setIsUploading(false);
        return;
      }

      // Improved iOS detection
      const isiOSDevice =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      mobileLog(`Device detected as iOS: ${isiOSDevice}`);

      // ----- iOS Specific Processing -----
      if (isiOSDevice) {
        mobileLog(`Using iOS-specific video processing with compression`);

        try {
          // Process video using the improved iOS function
          const processedBlob = await processVideoForIOS(
            sourceVideo,
            startTime,
            endTime
          );

          if (processedBlob && processedBlob.size >= 10000) {
            mobileLog(
              `Successfully created trimmed video: ${processedBlob.size / 1024}KB`
            );

            // Upload the processed video
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
          } else {
            mobileLog('Processed video too small or failed, trying fallback');
          }
        } catch (e) {
          if (e instanceof Error) {
            mobileLog(`iOS video processing error: ${e.message}`);
          } else {
            mobileLog('iOS video processing error: Unknown error');
          }
        }

        // If we get here, we need to try the fallback approach
        mobileLog('Using simplified fallback approach');

        try {
          // Direct extraction fallback
          const fallbackBlob = await extractVideoSegmentFallback(
            videoSrc,
            startTime,
            endTime
          );

          if (fallbackBlob && fallbackBlob.size >= 10000) {
            await uploadBlobToGCS(
              fallbackBlob,
              sourceVideo.videoWidth || 640,
              sourceVideo.videoHeight || 480,
              endTime - startTime
            );
            clearInterval(simulationInterval);
            return;
          }
        } catch (fallbackError) {
          if (fallbackError instanceof Error) {
            mobileLog(`Fallback method failed: ${fallbackError.message}`);
          } else {
            mobileLog('Fallback method failed with an unknown error');
          }
        }

        // Last resort fallback - use the original video but log warning
        mobileLog(
          '⚠️ WARNING: All trimming methods failed, using original video'
        );
        const response = await fetch(videoSrc);
        const originalBlob = await response.blob();

        // Set a user-visible warning
        setUploadError(
          'Video trimming failed. Using original video for analysis.'
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
        canvas,
        ctx,
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
          width: canvas.width.toString(),
          height: canvas.height.toString(),
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
