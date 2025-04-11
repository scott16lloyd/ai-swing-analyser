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

  const isAndroidDevice = useCallback(() => {
    return /android/i.test(navigator.userAgent);
  }, []);

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
    // Function to collect logs from videoUtils
    const collectVideoUtilsLogs = () => {
      if (typeof window !== 'undefined' && window.videoUtilsLogs) {
        // Add these logs to your mobileDebugLogs state
        setMobileDebugLogs((prevLogs) => {
          // Get any new logs that aren't already in mobileDebugLogs
          const existingLogSet = new Set(prevLogs);
          const newLogs = window.videoUtilsLogs.filter(
            (log) => !existingLogSet.has(log)
          );

          if (newLogs.length === 0) {
            return prevLogs; // No new logs, don't update state
          }

          // Combine with existing logs and limit to keep UI performant
          return [...newLogs, ...prevLogs].slice(0, 50);
        });
      }
    };

    // Set interval to collect logs periodically
    const interval = setInterval(collectVideoUtilsLogs, 1000);

    // Clean up interval on unmount
    return () => clearInterval(interval);
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
            const videoData = getRequest.result;
            const blob = videoData.blob;

            // Check if we need to convert the blob for playback
            checkAndConvertBlob(blob, videoData.type)
              .then((playableBlob) => {
                const url = URL.createObjectURL(playableBlob);
                setVideoSrc(url);
                mobileLog(
                  `Set video source from IndexedDB with type: ${videoData.type}`
                );
              })
              .catch((error) => {
                mobileLog(`Error converting blob: ${error}`);
                // Try with original blob anyway
                const url = URL.createObjectURL(blob);
                setVideoSrc(url);
              });
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

  // Helper function to check and convert blob if needed
  const checkAndConvertBlob = async (
    originalBlob: Blob,
    type: string
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      mobileLog(`Checking blob: size=${originalBlob.size}, type=${type}`);

      // For Android compatibility, ensure we have a valid MIME type
      if (!type || type === 'application/octet-stream') {
        // Try to detect from the Blob itself
        type = originalBlob.type || 'video/webm';
        mobileLog(`Updated type to: ${type}`);
      }

      // Create a new blob with the determined type to ensure proper metadata
      const typedBlob = new Blob([originalBlob], { type });

      // First, check if this blob is directly playable
      const testVideo = document.createElement('video');
      testVideo.muted = true;
      const url = URL.createObjectURL(typedBlob);

      // Set a timeout in case the loadedmetadata event doesn't fire
      let timeoutId: number;

      const cleanup = () => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(url);
        testVideo.removeEventListener('loadedmetadata', handleLoadedMetadata);
        testVideo.removeEventListener('error', handleError);
      };

      const handleLoadedMetadata = () => {
        mobileLog('Video metadata loaded successfully, blob is playable');
        cleanup();
        resolve(typedBlob);
      };

      const handleError = (e: Event) => {
        mobileLog(`Error loading video: ${e}`);
        cleanup();

        // Try with a fallback MIME type for Android
        if (type !== 'video/webm;codecs=vp8') {
          mobileLog('Trying with fallback MIME type: video/webm;codecs=vp8');
          const fallbackBlob = new Blob([originalBlob], {
            type: 'video/webm;codecs=vp8',
          });
          resolve(fallbackBlob);
        } else {
          // Just use the original as last resort
          resolve(originalBlob);
        }
      };

      // Set up timeout
      timeoutId = window.setTimeout(() => {
        mobileLog('Timeout waiting for video metadata, using original blob');
        cleanup();
        resolve(typedBlob);
      }, 3000);

      // Set up event listeners
      testVideo.addEventListener('loadedmetadata', handleLoadedMetadata);
      testVideo.addEventListener('error', handleError);
      // Start loading the video
      testVideo.src = url;
      testVideo.load();
    });
  };

  // Second useEffect: Handle duration detection AFTER video source is set
  useEffect(() => {
    // Only run this effect if we have a video source
    if (!videoSrc) return;

    if (videoRef.current) {
      // Add onerror handler directly on the video element
      videoRef.current.onerror = (e) => {
        const error = ((e as Event).target as HTMLVideoElement).error;
        mobileLog(`Video error: ${error?.code} - ${error?.message}`);

        // If there's a MEDIA_ERR_SRC_NOT_SUPPORTED or MEDIA_ERR_DECODE error, try to recover
        if (
          error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
          error?.code === MediaError.MEDIA_ERR_DECODE
        ) {
          mobileLog('Trying to recover from media error...');

          // Get video from IndexedDB again and try with a different format
          const request = indexedDB.open('VideoDatabase', 1);
          request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const transaction = db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const getRequest = store.get('currentVideo');

            getRequest.onsuccess = () => {
              if (getRequest.result) {
                const videoData = getRequest.result;
                const blob = videoData.blob;

                // Try with explicit WebM format for Android
                const recoveryBlob = new Blob([blob], {
                  type: 'video/webm;codecs=vp8',
                });
                const recoveryUrl = URL.createObjectURL(recoveryBlob);

                // Try to play with the new URL
                if (videoRef.current) {
                  videoRef.current.src = recoveryUrl;
                  setVideoSrc(recoveryUrl);
                }
              }
            };
          };
        }
      };
    }

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

  // Upload trimmed video to GCS
  // Modified uploadTrimmedVideo function for EditPage.tsx

  async function uploadTrimmedVideo() {
    mobileLog(
      `Starting upload process. Video source exists: ${!!videoSrc}, Start: ${startTime}s, End: ${endTime}s`
    );
    mobileLog(
      `Video duration: ${videoDuration}s, Trim duration: ${endTime - startTime}s`
    );
    mobileLog(`User agent: ${navigator.userAgent}`);
    mobileLog(
      `Browser info: ${navigator.vendor}, isAndroid: ${isAndroidDevice()}, isSafari: ${/safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent)}`
    );
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

      mobileLog('Setting up source video element for trimming');
      // 2. Set up video and canvas for processing
      const sourceVideo = document.createElement('video');
      sourceVideo.src = videoSrc;
      sourceVideo.muted = true;

      mobileLog(
        `Source video metadata loaded. Width: ${sourceVideo.videoWidth}, Height: ${sourceVideo.videoHeight}, Duration: ${sourceVideo.duration}s`
      );

      // Wait for video metadata to load
      await new Promise((resolve, reject) => {
        sourceVideo.onloadedmetadata = resolve;
        sourceVideo.onerror = (e) => {
          console.error('Error loading video for trimming:', e);
          reject(new Error('Failed to load video for trimming'));
        };
        // Set a timeout in case it never fires
        setTimeout(() => resolve(null), 3000);
      });

      mobileLog(
        `Creating canvas with dimensions: intended width=${sourceVideo.videoWidth || 1280}, height=${sourceVideo.videoHeight || 720}`
      );
      // Create a canvas with the same dimensions as the video
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(sourceVideo.videoWidth || 1280, 1280); // At least 1280px wide
      canvas.height = Math.max(sourceVideo.videoHeight || 720, 720); // At least 720px high
      const ctx = canvas.getContext('2d');

      mobileLog(
        `Canvas created with dimensions: ${canvas.width}x${canvas.height}`
      );

      if (!ctx) {
        throw new Error('Could not create canvas context');
      }

      // 3. Perform the trimming operation
      console.log(`Starting trim operation from ${startTime}s to ${endTime}s`);

      // Progress update during trimming
      const trimDuration = endTime - startTime;
      if (trimDuration > 8) {
        setUploadError(
          'Video must be less than 8 seconds for analysis, please trim the video shorter.'
        );
        setIsUploading(false);
        clearInterval(simulationInterval);
        return;
      }

      let trimmedBlob;
      try {
        // Try the standardTrimVideo function first - but with a flag for Android
        const isAndroid = /android/i.test(navigator.userAgent);

        mobileLog(
          `Starting trim operation with method: ${isAndroid ? 'Android frame capture' : 'standard trim'}`
        );

        if (isAndroid) {
          console.log('Android detected, using frame capture method directly');
          // Skip MediaRecorder completely on Android
          trimmedBlob = await captureFramesAsVideo(
            sourceVideo,
            canvas,
            ctx,
            startTime,
            endTime
          );
        } else {
          trimmedBlob = await standardTrimVideo(
            sourceVideo,
            canvas,
            ctx,
            startTime,
            endTime
          );
        }

        updateProgress(30);

        console.log(
          `Successfully got trimmed blob: ${trimmedBlob.size} bytes, type: ${trimmedBlob.type}`
        );
      } catch (trimError) {
        console.error('Error in standardTrimVideo:', trimError);

        // Fallback - try a simpler approach with frame capture
        console.log('Trying alternative frame capture approach...');
        trimmedBlob = await captureFramesAsVideo(
          sourceVideo,
          canvas,
          ctx,
          startTime,
          endTime
        );
        updateProgress(30);
        mobileLog(
          `Trimmed blob created: ${trimmedBlob.size} bytes, type: ${trimmedBlob.type}`
        );
      }

      if (!trimmedBlob || trimmedBlob.size < 1000) {
        throw new Error('Failed to create a valid trimmed video');
      }

      console.log(
        'Original trimmed size:',
        trimmedBlob.size / (1024 * 1024),
        'MB'
      );

      // Instead of using MediaRecorder for compression which fails on some Android devices,
      // use FFmpeg directly without a second MediaRecorder step

      try {
        // Import ffmpeg only when needed (dynamic import)
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        const { fetchFile } = await import('@ffmpeg/util');

        // Create FFmpeg instance
        const ffmpeg = new FFmpeg();
        await ffmpeg.load();

        // Write input file
        const inputFileName = trimmedBlob.type.includes('webm')
          ? 'input.webm'
          : 'input.mp4';
        const outputFileName = 'compressed.mp4';
        await ffmpeg.writeFile(inputFileName, await fetchFile(trimmedBlob));

        updateProgress(40);

        mobileLog('Starting video compression process');
        // Set compression parameters - adjust these for quality vs size
        // Android-friendly encoding settings
        await ffmpeg.exec([
          '-i',
          inputFileName,
          '-c:v',
          'libx264',
          '-profile:v',
          'main', // Better quality profile that's still compatible
          '-level',
          '4.0', // Higher level for better quality
          '-pix_fmt',
          'yuv420p',
          '-crf',
          '22', // Lower value = higher quality (22 is good quality)
          '-preset',
          'medium', // Better compression (balance of speed vs quality)
          '-tune',
          'film', // Optimize for video content
          '-vf',
          'scale=640:-2', // Scale to 720p height while maintaining aspect ratio
          '-an', // No audio
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
            userAgent: navigator.userAgent,
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

        mobileLog(`FFmpeg operations completed. Reading compressed file`);
        mobileLog(`Compressed file size: ${compressedBlob.size} bytes`);

        updateProgress(80);

        mobileLog(
          `Starting upload to GCS with signed URL to path: ${fullPath}`
        );
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

        mobileLog(
          `Upload response status: ${uploadResponse.status} ${uploadResponse.statusText}`
        );

        clearInterval(simulationInterval);
        setUploadProgress(100);
        setUploadedVideoUrl(publicUrl);

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
        router.push('/analyse/results');
      } catch (ffmpegError) {
        console.error('Error during FFmpeg processing:', ffmpegError);
        if (ffmpegError instanceof Error) {
          throw new Error(`Video compression failed: ${ffmpegError.message}`);
        } else {
          throw new Error('Video compression failed due to an unknown error.');
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        mobileLog(`Error: ${error.message}`);
        mobileLog(`Error stack: ${error.stack?.substring(0, 500)}`);
      } else {
        mobileLog(`Error: ${String(error)}`);
      }
      console.error('Error creating or uploading trimmed video:', error);
      setUploadError((error as Error).message);
    } finally {
      clearInterval(simulationInterval);
      setIsUploading(false);
    }
  }

  // Fallback function that captures frames without MediaRecorder
  async function captureFramesAsVideo(
    videoElement: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    startTime: number,
    endTime: number
  ): Promise<Blob> {
    console.log('Using fallback frame capture method');

    try {
      // Set the video to the start time
      videoElement.currentTime = startTime;

      // Wait for the video to seek to the start time
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked);
          resolve();
        };
        videoElement.addEventListener('seeked', onSeeked);

        // Add timeout in case event never fires
        setTimeout(() => resolve(), 2000);
      });

      // Import FFmpeg directly here for the fallback
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');

      // Create FFmpeg instance
      const ffmpeg = new FFmpeg();
      await ffmpeg.load();

      // Calculate number of frames to capture (assume 30fps)
      const duration = endTime - startTime;
      const fps = 30;
      const frameCount = Math.ceil(duration * fps);

      console.log(`Capturing ${frameCount} frames at ${fps} fps`);

      // Make sure canvas size is reasonable but not too small
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      console.log(`Using canvas size: ${canvasWidth}x${canvasHeight}`);

      // Create directory for frames
      await ffmpeg.createDir('frames');

      // Start capturing frames
      for (let i = 0; i < frameCount; i++) {
        const currentTime = startTime + i / fps;

        // Set video position
        videoElement.currentTime = currentTime;

        // Wait for the seek to complete
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            videoElement.removeEventListener('seeked', onSeeked);
            resolve();
          };
          videoElement.addEventListener('seeked', onSeeked);

          // Timeout for cases where seeked event doesn't fire
          setTimeout(() => resolve(), 200);
        });

        // Draw the frame
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        // Get the frame as a blob
        const frameDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const frameBlob = await (await fetch(frameDataUrl)).blob();

        // Write frame to FFmpeg
        const frameData = await fetchFile(frameBlob);
        const paddedIndex = i.toString().padStart(4, '0');
        await ffmpeg.writeFile(`frames/frame${paddedIndex}.jpg`, frameData);

        if (i % 10 === 0) {
          console.log(`Captured frame ${i + 1}/${frameCount}`);
        }
      }

      // Define input and output file names
      const inputFramePattern = 'frames/frame%04d.jpg';
      const outputFileName = 'output.mp4';

      // Create video from frames
      await ffmpeg.exec([
        '-framerate',
        fps.toString(),
        '-i',
        inputFramePattern,
        '-c:v',
        'libx264',
        '-profile:v',
        'main', // Use main profile instead of baseline for better quality
        '-level',
        '4.0', // Higher level (still mobile compatible)
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '22', // Lower CRF value = higher quality (23-28 is normal, 18-22 is higher quality)
        '-preset',
        'medium', // Better compression (balance of speed/quality)
        '-tune',
        'film', // Optimize for video content
        '-movflags',
        '+faststart',
        outputFileName,
      ]);

      console.log('Video creation complete, reading output file');

      // Read the output video
      const data = await ffmpeg.readFile(outputFileName);
      console.log(`Output video size: ${data.length} bytes`);
      return new Blob([data], { type: 'video/mp4' });
    } catch (error) {
      console.error('Error in captureFramesAsVideo:', error);
      throw error;
    }
  }

  // Add a function to fix the standardTrimVideo function for better compatibility
  async function fixedStandardTrimVideo(
    videoElement: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    startTime: number,
    endTime: number
  ): Promise<Blob> {
    console.log(`Starting video trimming from ${startTime}s to ${endTime}s`);

    // Set the video to the start time
    videoElement.currentTime = startTime;

    // Wait for the video to seek to the start time
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        videoElement.removeEventListener('seeked', onSeeked);
        resolve();
      };
      videoElement.addEventListener('seeked', onSeeked);
    });

    try {
      // Create a MediaRecorder to capture the frames
      const stream = canvas.captureStream(30); // 30 FPS

      // Try to determine the best MIME type for the output
      let mimeType = '';

      // Try these MIME types in order of preference
      const mimeTypes = [
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=h264',
        'video/mp4',
      ];

      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }

      // Always use a low bitrate for compatibility
      (options as any).videoBitsPerSecond = 1000000; // 1 Mbps

      const mediaRecorder = new MediaRecorder(stream, options);
      console.log(
        `Using MediaRecorder with MIME type: ${mediaRecorder.mimeType}`
      );

      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Create a promise to wait for the recording to complete
      const recordingPromise = new Promise<Blob>((resolve, reject) => {
        mediaRecorder.onstop = () => {
          try {
            console.log(
              `Recording stopped, creating blob from ${chunks.length} chunks`
            );
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
            resolve(blob);
          } catch (err) {
            reject(err);
          }
        };

        mediaRecorder.onerror = (event) => {
          reject(new Error('MediaRecorder error occurred'));
        };
      });

      // Start recording
      mediaRecorder.start(100); // Capture data in smaller chunks
      console.log('Started MediaRecorder');

      // Play the video
      await videoElement.play();

      // Set up the animation loop to draw video frames to canvas
      const drawFrame = () => {
        // Draw the current frame of the video onto the canvas
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        // Check if we've reached the end time
        if (videoElement.currentTime < endTime) {
          // Continue the animation loop
          requestAnimationFrame(drawFrame);
        } else {
          // Stop when we reach the end time
          videoElement.pause();
          mediaRecorder.stop();
          console.log('Reached end time, stopping recording');
        }
      };

      // Start the animation loop
      drawFrame();

      // Wait for the recording to finish
      return await recordingPromise;
    } catch (error) {
      console.error('Error during video trimming:', error);
      throw error;
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
            <div className="fixed inset-0 bg-black/90 text-white text-xs p-2 z-50 overflow-auto">
              <div className="flex justify-between items-center sticky top-0 bg-gray-800 p-2 mb-2">
                <div className="font-bold">Debug Console</div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      setMobileDebugLogs([]);
                      // If using VideoDebugger, clear its logs too
                      // Check if VideoDebugger is defined and clear logs if available
                      if (
                        typeof window !== 'undefined' &&
                        (window as any).VideoDebugger
                      ) {
                        (window as any).VideoDebugger.clearLogs();
                      }
                    }}
                    className="bg-red-600 px-2 py-1 rounded"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowDebugger(false)}
                    className="bg-gray-600 px-2 py-1 rounded"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Video metadata section */}
              <div className="mb-4 bg-gray-800 p-2 rounded">
                <div className="font-bold border-b border-gray-700 pb-1 mb-2">
                  Video Info
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="text-gray-400">Source:</div>
                  <div>{videoSrc ? '✅ Available' : '❌ Missing'}</div>

                  <div className="text-gray-400">Duration:</div>
                  <div>{videoDuration.toFixed(2)}s</div>

                  <div className="text-gray-400">Trim Range:</div>
                  <div>
                    {startTime.toFixed(2)}s - {endTime.toFixed(2)}s (
                    {(endTime - startTime).toFixed(2)}s)
                  </div>

                  <div className="text-gray-400">Current Time:</div>
                  <div>{currentTime.toFixed(2)}s</div>

                  <div className="text-gray-400">Video Ref:</div>
                  <div>{videoRef.current ? '✅ Available' : '❌ Missing'}</div>

                  {videoRef.current && (
                    <>
                      <div className="text-gray-400">Video Dimensions:</div>
                      <div>
                        {videoRef.current.videoWidth || 0} ×{' '}
                        {videoRef.current.videoHeight || 0}
                      </div>

                      <div className="text-gray-400">Ready State:</div>
                      <div>{videoRef.current.readyState}</div>

                      <div className="text-gray-400">Playback Rate:</div>
                      <div>{videoRef.current.playbackRate}</div>

                      {videoRef.current.error && (
                        <>
                          <div className="text-gray-400">Video Error:</div>
                          <div className="text-red-500">
                            Code: {videoRef.current.error.code}, Message:{' '}
                            {videoRef.current.error.message}
                          </div>
                        </>
                      )}
                    </>
                  )}

                  <div className="text-gray-400">Upload Status:</div>
                  <div>
                    {isUploading
                      ? `Uploading (${uploadProgress}%)`
                      : uploadedVideoUrl
                        ? '✅ Complete'
                        : 'Not started'}
                  </div>

                  {uploadError && (
                    <>
                      <div className="text-gray-400">Upload Error:</div>
                      <div className="text-red-500">{uploadError}</div>
                    </>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mb-4 flex space-x-2">
                <button
                  onClick={() => {
                    const info = {
                      userAgent: navigator.userAgent,
                      videoState: {
                        duration: videoRef.current?.duration || 0,
                        videoWidth: videoRef.current?.videoWidth || 0,
                        videoHeight: videoRef.current?.videoHeight || 0,
                        readyState: videoRef.current?.readyState || 0,
                        error: videoRef.current?.error
                          ? {
                              code: videoRef.current.error.code,
                              message: videoRef.current.error.message,
                            }
                          : null,
                      },
                      trimInfo: {
                        startTime,
                        endTime,
                        duration: endTime - startTime,
                      },
                    };

                    mobileLog(`DEBUG INFO: ${JSON.stringify(info)}`);
                  }}
                  className="bg-blue-600 px-2 py-1 rounded"
                >
                  Log Video State
                </button>

                <button
                  onClick={() => {
                    if (videoRef.current) {
                      const states = [
                        'HAVE_NOTHING(0)',
                        'HAVE_METADATA(1)',
                        'HAVE_CURRENT_DATA(2)',
                        'HAVE_FUTURE_DATA(3)',
                        'HAVE_ENOUGH_DATA(4)',
                      ];

                      mobileLog(
                        `Video readyState: ${videoRef.current.readyState} (${states[videoRef.current.readyState]})`
                      );

                      const mediaErrors = [
                        'MEDIA_ERR_ABORTED(1)',
                        'MEDIA_ERR_NETWORK(2)',
                        'MEDIA_ERR_DECODE(3)',
                        'MEDIA_ERR_SRC_NOT_SUPPORTED(4)',
                      ];

                      if (videoRef.current.error) {
                        mobileLog(
                          `Video error: ${videoRef.current.error.code} (${mediaErrors[videoRef.current.error.code - 1]}): ${videoRef.current.error.message}`
                        );
                      } else {
                        mobileLog('No video errors detected');
                      }
                    } else {
                      mobileLog('Video reference not available');
                    }
                  }}
                  className="bg-green-600 px-2 py-1 rounded"
                >
                  Test Video
                </button>
              </div>

              {/* Log output */}
              <div className="mt-2">
                <div className="font-bold border-b border-gray-700 pb-1 mb-2">
                  Log Messages
                </div>
                {mobileDebugLogs.map((log, i) => (
                  <div
                    key={i}
                    className="border-b border-gray-700 py-1 break-all"
                    style={{
                      backgroundColor: log.includes('ERROR')
                        ? 'rgba(220, 38, 38, 0.2)'
                        : log.includes('WARNING')
                          ? 'rgba(251, 191, 36, 0.2)'
                          : 'transparent',
                    }}
                  >
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Debug button - make it more visible and detailed */}
          <button
            onClick={() => setShowDebugger((prev) => !prev)}
            className={`fixed top-2 right-2 ${isUploading || uploadError ? 'bg-red-600' : 'bg-black/50'} text-white text-xs p-2 rounded-full z-50 flex items-center`}
          >
            <span className="mr-1">
              <Activity size={16} />
            </span>
            {isUploading
              ? `${uploadProgress}%`
              : uploadError
                ? 'Error'
                : 'Debug'}
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
