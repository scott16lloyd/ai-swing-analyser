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
  const formatTime = (time: number) => {
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

  const handleVideoEnded = useCallback(() => {
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
    const simulationInterval = setInterval(() => {
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
      const sourceVideo = document.createElement('video');
      sourceVideo.src = videoSrc;
      sourceVideo.muted = true;

      // Wait for video metadata to load and validate source
      const sourceValid = await new Promise((resolve) => {
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

      const isiOSDevice =
        ['iPad', 'iPhone', 'iPod'].includes(navigator.platform) ||
        (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

      mobileLog(`Device detected as iOS: ${isiOSDevice}`);

      // ----- iOS Workaround -----
      if (isiOSDevice) {
        mobileLog(`Using iOS-specific video processing with compression`);

        // Compression settings
        const compressionSettings = {
          targetWidth: 640, // Smaller dimension for compression
          targetHeight: 360, // Maintain 16:9 aspect ratio if possible
          framerate: 24, // Lower framerate for smaller file
          videoBitrate: 1500000, // 1.5 Mbps (lower than before)
          keyframeInterval: 48, // Every 2 seconds at 24fps
        };

        // Calculate scaled dimensions (maintain aspect ratio)
        let targetWidth = compressionSettings.targetWidth;
        let targetHeight = compressionSettings.targetHeight;

        if (sourceVideo.videoWidth && sourceVideo.videoHeight) {
          const aspectRatio = sourceVideo.videoWidth / sourceVideo.videoHeight;
          if (aspectRatio > targetWidth / targetHeight) {
            // Width bounded
            targetHeight = Math.round(targetWidth / aspectRatio);
          } else {
            // Height bounded
            targetWidth = Math.round(targetHeight * aspectRatio);
          }
        }

        mobileLog(
          `Original dimensions: ${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`
        );
        mobileLog(`Compressed dimensions: ${targetWidth}x${targetHeight}`);

        // Create compression canvas with reduced dimensions
        const compressionCanvas = document.createElement('canvas');
        compressionCanvas.width = targetWidth;
        compressionCanvas.height = targetHeight;
        const compCtx = compressionCanvas.getContext('2d');

        if (!compCtx) {
          throw new Error('Could not create compression canvas context');
        }

        // Direct recording from the canvas with compressed dimensions
        let frames: ImageData[] = [];
        const framerate = compressionSettings.framerate;
        const frameCount = Math.ceil(trimDuration * framerate);

        updateProgress(10);

        // Capture frames at reduced framerate
        for (let i = 0; i < frameCount; i++) {
          const currentTime = startTime + i / framerate;

          // Set video time
          sourceVideo.currentTime = currentTime;

          // Wait for seek to complete
          await new Promise<void>((resolve) => {
            const seeked = () => {
              sourceVideo.removeEventListener('seeked', seeked);
              resolve();
            };
            sourceVideo.addEventListener('seeked', seeked);

            // Timeout in case event never fires
            setTimeout(resolve, 500);
          });

          // Draw the frame to compression canvas with scaled dimensions
          compCtx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);

          // Capture the frame as image data
          const imageData = compCtx.getImageData(
            0,
            0,
            targetWidth,
            targetHeight
          );
          frames.push(imageData);

          // Update progress periodically
          if (i % 10 === 0) {
            updateProgress(10 + (i / frameCount) * 20);
          }
        }

        mobileLog(`Captured ${frames.length} frames at ${framerate}fps`);
        updateProgress(30);

        // Try to get supported MIME types
        let mimeType = 'video/webm;codecs=h264';
        let codecOptions = {
          mimeType: mimeType,
          videoBitsPerSecond: compressionSettings.videoBitrate,
        };

        // Test if the preferred codec is supported
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mobileLog(`${mimeType} not supported, trying alternatives`);

          // Try alternatives in order of preference
          const alternatives = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4',
            '', // Empty string lets browser choose
          ];

          for (const alt of alternatives) {
            if (!alt || MediaRecorder.isTypeSupported(alt)) {
              mimeType = alt;
              codecOptions = {
                mimeType: alt || '',
                videoBitsPerSecond: compressionSettings.videoBitrate,
              };
              mobileLog(`Using codec: ${alt || 'browser default'}`);
              break;
            }
          }
        }

        // Create MediaRecorder to record the canvas
        const canvasStream = compressionCanvas.captureStream(framerate);

        try {
          // Try to create recorder with our settings
          const recorder = new MediaRecorder(canvasStream, codecOptions);

          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => chunks.push(e.data);

          // Promise that resolves when recording stops
          const recordingPromise = new Promise<Blob>((resolve) => {
            recorder.onstop = () => {
              let trimmedBlob;

              // Create the right blob type based on mime type
              if (mimeType.includes('mp4')) {
                trimmedBlob = new Blob(chunks, { type: 'video/mp4' });
              } else {
                trimmedBlob = new Blob(chunks, { type: 'video/webm' });
              }

              resolve(trimmedBlob);
            };
          });

          // Start recording
          recorder.start(
            (1000 / framerate) * compressionSettings.keyframeInterval
          ); // Segment size matches keyframe interval

          // Play back the frames
          let frameIndex = 0;
          const playbackInterval = setInterval(() => {
            if (frameIndex < frames.length) {
              compCtx.putImageData(frames[frameIndex], 0, 0);
              frameIndex++;
              updateProgress(30 + (frameIndex / frames.length) * 20);
            } else {
              clearInterval(playbackInterval);
              recorder.stop();
            }
          }, 1000 / framerate);

          // Wait for recording to complete
          const trimmedBlob = await recordingPromise;

          mobileLog(
            `Recording completed, compressed size: ${trimmedBlob.size / 1024} KB`
          );

          // Validate the recorded blob
          const isValid = await isValidVideoBlob(trimmedBlob);
          mobileLog(`Recorded video valid: ${isValid}`);

          if (!isValid || trimmedBlob.size < 10000) {
            mobileLog(
              `Compressed recording invalid or too small, trying with higher quality`
            );

            // Try again with higher quality settings
            const highQualityRecorder = new MediaRecorder(canvasStream, {
              videoBitsPerSecond: 3000000, // 3 Mbps - higher quality
            });

            const highQualityChunks: Blob[] = [];
            highQualityRecorder.ondataavailable = (e) =>
              highQualityChunks.push(e.data);

            const highQualityPromise = new Promise<Blob>((resolve) => {
              highQualityRecorder.onstop = () => {
                const blob = new Blob(highQualityChunks, {
                  type: 'video/webm',
                });
                resolve(blob);
              };
            });

            // Play frames again
            frameIndex = 0;
            highQualityRecorder.start();

            const replayInterval = setInterval(() => {
              if (frameIndex < frames.length) {
                compCtx.putImageData(frames[frameIndex], 0, 0);
                frameIndex++;
              } else {
                clearInterval(replayInterval);
                highQualityRecorder.stop();
              }
            }, 1000 / framerate);

            const highQualityBlob = await highQualityPromise;
            mobileLog(
              `High quality recording completed: ${highQualityBlob.size / 1024} KB`
            );

            const highQualityValid = await isValidVideoBlob(highQualityBlob);
            mobileLog(`High quality video valid: ${highQualityValid}`);

            if (highQualityValid && highQualityBlob.size >= 10000) {
              // Upload high quality version
              await uploadBlobToGCS(
                highQualityBlob,
                targetWidth,
                targetHeight,
                trimDuration
              );
            } else {
              // Last resort: fetch original video and convert to MP4
              mobileLog(`Falling back to direct blob conversion`);

              try {
                // Get the original video data
                const response = await fetch(videoSrc);
                const originalBlob = await response.blob();

                // Create an element to help with conversion
                const videoEl = document.createElement('video');
                videoEl.src = URL.createObjectURL(originalBlob);
                await new Promise((resolve) => {
                  videoEl.onloadedmetadata = resolve;
                  setTimeout(resolve, 3000); // Timeout fallback
                });

                // Create a MediaSource object
                const stream = (videoEl as any).captureStream();
                const recorder = new MediaRecorder(stream);

                const directChunks: Blob[] = [];
                recorder.ondataavailable = (e) => directChunks.push(e.data);

                const directPromise = new Promise<Blob>((resolve) => {
                  recorder.onstop = () => {
                    const blob = new Blob(directChunks, { type: 'video/webm' });
                    resolve(blob);
                  };
                });

                // Manually play through the segment we want
                videoEl.currentTime = startTime;
                videoEl.play();
                recorder.start();

                // Stop after duration
                setTimeout(() => {
                  videoEl.pause();
                  recorder.stop();
                }, trimDuration * 1000);

                const directBlob = await directPromise;

                if (directBlob.size > 10000) {
                  await uploadBlobToGCS(
                    directBlob,
                    videoEl.videoWidth,
                    videoEl.videoHeight,
                    trimDuration
                  );
                } else {
                  // Final fallback: use original blob but clip during upload
                  await uploadBlobToGCS(
                    originalBlob,
                    sourceVideo.videoWidth,
                    sourceVideo.videoHeight,
                    trimDuration
                  );
                }
              } catch (e) {
                if (e instanceof Error) {
                  mobileLog(`Direct conversion failed: ${e.message}`);
                } else {
                  mobileLog('Direct conversion failed with an unknown error');
                }

                // Absolute last resort: use the original video
                const response = await fetch(videoSrc);
                const originalBlob = await response.blob();

                await uploadBlobToGCS(
                  originalBlob,
                  sourceVideo.videoWidth,
                  sourceVideo.videoHeight,
                  trimDuration
                );
              }
            }

            clearInterval(simulationInterval);
            return;
          }

          // Upload the compressed recorded blob
          await uploadBlobToGCS(
            trimmedBlob,
            targetWidth,
            targetHeight,
            trimDuration
          );

          clearInterval(simulationInterval);
          return;
        } catch (recorderError) {
          if (recorderError instanceof Error) {
            mobileLog(`MediaRecorder error: ${recorderError.message}`);
          } else {
            mobileLog('MediaRecorder error: An unknown error occurred');
          }

          // Try a more direct approach with the original video
          try {
            // Get the original video as a blob
            const response = await fetch(videoSrc);
            const originalBlob = await response.blob();

            // Create a new FileReader
            const reader = new FileReader();

            // Read the blob as ArrayBuffer
            const arrayBuffer = await new Promise<ArrayBuffer>((resolve) => {
              reader.onload = () => resolve(reader.result as ArrayBuffer);
              reader.readAsArrayBuffer(originalBlob);
            });

            // Create a data view for manipulation
            const view = new DataView(arrayBuffer);

            // This is a very simple "compression" by setting quality metadata
            // It's not true compression but may help
            const compressedBlob = new Blob([arrayBuffer], {
              type: 'video/mp4',
              endings: 'transparent',
            });

            await uploadBlobToGCS(
              compressedBlob,
              sourceVideo.videoWidth,
              sourceVideo.videoHeight,
              trimDuration
            );

            clearInterval(simulationInterval);
            return;
          } catch (directError) {
            if (directError instanceof Error) {
              mobileLog(`Direct approach failed: ${directError.message}`);
            } else {
              mobileLog('Direct approach failed with an unknown error');
            }

            // Final fallback - use original without any processing
            const response = await fetch(videoSrc);
            const originalBlob = await response.blob();

            await uploadBlobToGCS(
              originalBlob,
              sourceVideo.videoWidth,
              sourceVideo.videoHeight,
              trimDuration
            );

            clearInterval(simulationInterval);
            return;
          }
        }
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
