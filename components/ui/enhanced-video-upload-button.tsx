'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { uploadVideoDirectly } from '@/components/ui/upload-button';
import {
  Upload,
  Settings,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle,
  X,
} from 'lucide-react';

// Video compression options interface
interface CompressVideoOptions {
  quality?: string;
  onProgress?: (progress: number) => void;
  maxDuration?: number;
}

interface EnhancedVideoUploadProps {
  videoBlob: Blob | null;
  cameraFacing: 'user' | 'environment';
  onProcessingComplete?: (result: ProcessVideoResponse) => void;
  onProcessingError?: (error: Error) => void;
  className?: string;
  disabled?: boolean;
  useDirectUpload?: boolean;
  uploadOptions?: Partial<ProcessVideoOptions>;
}

// Additional types for video compression
interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  aspectRatio: number;
  size: number;
  type: string;
}

interface NetworkInfoState {
  type: string | null;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  qualityRecommendation: string;
  chunkSize: number;
}

interface CompressionStats {
  originalSize: string;
  compressedSize: string;
  reduction: string;
}

interface QualityPreset {
  width: number;
  height: number;
  bitrate: number;
  frameRate: number;
}

interface ProcessVideoOptions {
  cameraFacing?: 'user' | 'environment' | string;
  quality?: 'high' | 'medium' | 'low';
  bucketName?: string;
  destinationPath?: string;
  onProgress?: (progress: number) => void;
}

/**
 * Response from processing video
 */
interface ProcessVideoResponse {
  success: boolean;
  bucketName: string;
  fileName: string;
  publicUrl?: string;
  metadata: {
    originalName: string;
    quality: string;
    processingMethod: string;
    [key: string]: any;
  };
}

// Quality presets for video compression
const QUALITY_PRESETS: Record<string, QualityPreset | null> = {
  'very-low': {
    width: 480,
    height: 270,
    bitrate: 800000, // 800Kbps
    frameRate: 24,
  },
  low: {
    width: 640,
    height: 360,
    bitrate: 1200000, // 1.2Mbps
    frameRate: 24,
  },
  medium: {
    width: 854,
    height: 480,
    bitrate: 2500000, // 2.5Mbps
    frameRate: 30,
  },
  high: {
    width: 1280,
    height: 720,
    bitrate: 5000000, // 5Mbps
    frameRate: 30,
  },
  original: null, // No compression
};

/**
 * Detects if the current device is a mobile device
 * @returns {boolean} True if the device is mobile
 */
function isMobileDevice(): boolean {
  // Check for mobile or tablet devices
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) ||
    (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 2)
  );
}

/**
 * Returns the best supported video format for MediaRecorder
 * @returns {string} The MIME type to use for video recording
 */
function getBestSupportedMimeType(): string {
  const types: string[] = [
    'video/mp4;codecs=h264',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`Using MIME type: ${type}`);
      return type;
    }
  }

  console.warn('No preferred MIME types supported, using default');
  return 'video/webm';
}

/**
 * Detects current network conditions and recommends compression settings
 */
function detectNetworkConditions(): NetworkInfoState {
  // Get network information if available
  const connection =
    navigator.connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection ||
    null;

  // Default to medium quality if we can't detect network
  if (!connection) {
    console.log(
      'Network information API not available, assuming medium quality'
    );
    return {
      type: null,
      effectiveType: null,
      downlink: null,
      rtt: null,
      qualityRecommendation: 'medium',
      chunkSize: 512 * 1024, // 512KB default chunk size
    };
  }

  console.log('Network conditions:', {
    type: connection.type,
    effectiveType: connection.effectiveType,
    downlink: connection.downlink,
    rtt: connection.rtt,
  });

  // Determine recommended quality based on connection
  let qualityRecommendation = 'medium';
  let chunkSize = 512 * 1024; // 512KB default

  // Effective type will be one of 'slow-2g', '2g', '3g', or '4g'
  switch (connection.effectiveType) {
    case 'slow-2g':
    case '2g':
      qualityRecommendation = 'very-low';
      chunkSize = 128 * 1024; // 128KB chunks for very slow connections
      break;
    case '3g':
      if (connection.downlink && connection.downlink < 1) {
        qualityRecommendation = 'low';
        chunkSize = 256 * 1024; // 256KB chunks for slow 3G
      } else {
        qualityRecommendation = 'medium';
        chunkSize = 512 * 1024; // 512KB for decent 3G
      }
      break;
    case '4g':
    default:
      if (connection.downlink && connection.downlink > 5) {
        qualityRecommendation = 'high';
        chunkSize = 1024 * 1024; // 1MB chunks for fast connections
      } else {
        qualityRecommendation = 'medium';
        chunkSize = 768 * 1024; // 768KB for normal 4G
      }
      break;
  }

  return {
    type: connection.type || null,
    effectiveType: connection.effectiveType || null,
    downlink: connection.downlink || null,
    rtt: connection.rtt || null,
    qualityRecommendation,
    chunkSize,
  };
}

/**
 * Utility function to read basic video information without loading the full video
 */
async function getVideoInfo(videoBlob: Blob): Promise<VideoInfo> {
  return new Promise<VideoInfo>((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(videoBlob);

    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.src = url;

    let timeoutId: number | null = null;

    // Set up event handlers
    video.onloadedmetadata = () => {
      if (timeoutId) clearTimeout(timeoutId);

      const info: VideoInfo = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        aspectRatio: video.videoWidth / video.videoHeight,
        size: videoBlob.size,
        type: videoBlob.type,
      };

      URL.revokeObjectURL(url);
      resolve(info);
    };

    video.onerror = () => {
      if (timeoutId) clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };

    // Add timeout
    timeoutId = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('Timeout loading video metadata'));
    }, 5000);

    // Start loading metadata
    video.load();
  });
}

/**
 * Compresses a video blob to a lower quality for faster uploads
 * with mobile-specific optimizations
 * @param {Blob} videoBlob - The original video blob to compress
 * @param {CompressVideoOptions} options - Compression options
 * @returns {Promise<Blob>} A promise that resolves to the compressed video blob
 */
async function compressVideo(
  videoBlob: Blob,
  options: CompressVideoOptions = {}
): Promise<Blob> {
  // Default options
  const {
    quality = 'medium',
    onProgress = (progress: number): void => {
      console.log(`Compression progress: ${progress}%`);
    },
    maxDuration = 15, // Default max duration
  } = options;

  onProgress(0);

  // If quality is 'original', return the original blob
  if (quality === 'original') {
    onProgress(100);
    return videoBlob;
  }

  // Check if we're on a mobile device
  const isMobile: boolean = isMobileDevice();
  console.log(`Device detected as: ${isMobile ? 'mobile' : 'desktop'}`);

  // Get quality settings
  const settings: QualityPreset | null =
    QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;

  // If no settings (null), return original
  if (!settings) {
    console.warn('Invalid quality setting, using medium quality');
    return compressVideo(videoBlob, { ...options, quality: 'medium' });
  }

  // Add a compression timeout to prevent stalling
  const compressionTimeoutMs: number = isMobile ? 30000 : 60000; // 30 seconds on mobile, 60 on desktop
  let compressionTimeout: number | null = null;

  // Mobile-specific adjustments
  if (isMobile) {
    console.log('Using mobile-optimized compression settings');

    // Reduce frame rate significantly for mobile
    settings.frameRate = Math.min(settings.frameRate, 15);

    // Make mobile compression less resource-intensive - reduce bitrate for faster processing
    settings.bitrate = Math.floor(settings.bitrate * 0.7);

    // For very low-end devices, try to handle with even simpler settings
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
      console.log('Low CPU device detected, using minimal settings');
      settings.frameRate = 10;
      settings.bitrate = Math.floor(settings.bitrate * 0.6);
    }
  }

  console.log('Using compression settings:', settings);

  // Try compression with timeout safeguard
  return new Promise<Blob>((resolve, reject) => {
    // Set timeout to catch stalled compression
    compressionTimeout = window.setTimeout(() => {
      console.warn(
        `Compression timed out after ${compressionTimeoutMs}ms, using original video`
      );
      onProgress(100);
      resolve(videoBlob); // Fallback to original if compression stalls
    }, compressionTimeoutMs);

    // Attempt compression
    performCompression()
      .then((compressedBlob) => {
        if (compressionTimeout !== null) {
          clearTimeout(compressionTimeout);
        }
        resolve(compressedBlob);
      })
      .catch((error) => {
        console.error('Compression failed:', error);
        if (compressionTimeout !== null) {
          clearTimeout(compressionTimeout);
        }

        // Important: don't reject, but resolve with original blob as fallback
        console.warn('Using original video due to compression failure');
        onProgress(100);
        resolve(videoBlob);
      });
  });

  // Internal function to perform the actual compression
  async function performCompression(): Promise<Blob> {
    // Create a video element to load the original video
    const sourceVideo: HTMLVideoElement = document.createElement('video');
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;

    try {
      // Create URL for the video blob
      const videoUrl: string = URL.createObjectURL(videoBlob);
      sourceVideo.src = videoUrl;

      // Wait for metadata to load
      await new Promise<void>((resolve, reject) => {
        let timeoutId: number | null = null;

        sourceVideo.onloadedmetadata = () => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve();
        };

        sourceVideo.onerror = () => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(
            new Error(
              `Error loading video: ${sourceVideo.error?.message || 'Unknown error'}`
            )
          );
        };

        // Set a timeout in case metadata loading hangs
        timeoutId = window.setTimeout(() => {
          reject(new Error('Timeout loading video metadata'));
        }, 5000);
      });

      // Video dimensions and duration
      const originalWidth: number = sourceVideo.videoWidth;
      const originalHeight: number = sourceVideo.videoHeight;
      const originalDuration: number = sourceVideo.duration;
      const duration: number = Math.min(originalDuration, maxDuration);

      console.log('Original video:', {
        width: originalWidth,
        height: originalHeight,
        duration: originalDuration.toFixed(2) + 's',
        size: (videoBlob.size / (1024 * 1024)).toFixed(2) + 'MB',
      });

      // If we're on a mobile device and the video is already small enough, skip compression
      const videoSizeMB: number = videoBlob.size / (1024 * 1024);
      if (isMobile && videoSizeMB < 10) {
        // Skip compression for videos under 10MB on mobile
        console.log(
          'Video already small enough, skipping compression on mobile'
        );
        onProgress(100);
        URL.revokeObjectURL(videoUrl);
        return videoBlob;
      }

      // Calculate target dimensions while maintaining aspect ratio
      const aspectRatio: number = originalWidth / originalHeight;

      // If the video is portrait, swap width and height in our calculations
      let targetWidth: number;
      let targetHeight: number;

      if (originalHeight > originalWidth) {
        // Portrait video
        targetHeight = settings!.width;
        targetWidth = Math.round(settings!.width / aspectRatio);
      } else {
        // Landscape video
        targetWidth = settings!.width;
        targetHeight = Math.round(settings!.width / aspectRatio);
      }

      // Ensure dimensions are even (required by some encoders)
      targetWidth = Math.floor(targetWidth / 2) * 2;
      targetHeight = Math.floor(targetHeight / 2) * 2;

      console.log('Target dimensions:', targetWidth, 'x', targetHeight);

      // Mobile specific: If we have createImageBitmap support, use it for better performance
      const useImageBitmap: boolean = typeof createImageBitmap === 'function';

      // Create a canvas for the compressed video frames
      const canvas: HTMLCanvasElement = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d', {
        alpha: false,
      });

      if (!ctx) {
        throw new Error('Failed to get 2D context from canvas');
      }

      // Get the best supported MIME type
      const mimeType: string = getBestSupportedMimeType();

      // Set up parameters for MediaRecorder
      const recorderOptions: MediaRecorderOptions = {
        mimeType,
        videoBitsPerSecond: settings!.bitrate,
      };

      // Create a MediaRecorder with the canvas stream
      // @ts-ignore - TypeScript doesn't fully recognize captureStream
      const stream: MediaStream = canvas.captureStream(settings.frameRate);
      const mediaRecorder: MediaRecorder = new MediaRecorder(
        stream,
        recorderOptions
      );

      // Store the recorded chunks
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e: BlobEvent): void => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Start recording
      mediaRecorder.start(1000); // Capture in 1-second chunks

      // Optimize for mobile: process fewer frames on mobile
      // On desktop we process at full frameRate, on mobile we process fewer frames
      const frameSkip: number = isMobile
        ? Math.max(1, Math.floor(30 / settings!.frameRate))
        : 1;
      console.log(`Processing with frame skip: ${frameSkip}`);

      // Calculate actual number of frames to process (considering frameSkip)
      const totalFrames: number = Math.ceil(
        (duration * settings!.frameRate) / frameSkip
      );
      let processedFrames: number = 0;

      // Disable image smoothing for faster rendering
      ctx.imageSmoothingQuality = 'low';

      // Set up error handling
      mediaRecorder.onerror = (event: Event): void => {
        console.error('MediaRecorder error:', event);
        throw new Error('Error during video compression');
      };

      // Function to draw a frame at the specified time
      const drawFrameAtTime = (time: number): void => {
        try {
          // Draw the current frame to canvas
          ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);

          // Update progress
          processedFrames++;
          const progress: number = Math.min(
            95,
            Math.round((processedFrames / totalFrames) * 100)
          );

          // Update progress every few frames to avoid excessive UI updates
          if (processedFrames % (isMobile ? 3 : 5) === 0) {
            onProgress(progress);
          }

          // If we've reached the end, stop recording
          if (time >= duration || sourceVideo.ended) {
            console.log(`Reached end of video at ${time.toFixed(2)}s`);
            mediaRecorder.stop();
            return;
          }

          // Otherwise, move to next frame with a dynamic frame skip based on device
          const nextTime: number = Math.min(
            time + frameSkip / settings!.frameRate,
            duration
          );

          // Set the next currentTime
          sourceVideo.currentTime = nextTime;
        } catch (error) {
          console.error('Error drawing frame:', error);
          // Try to continue despite errors
        }
      };

      // Handle seeking to a specific time
      sourceVideo.onseeked = (): void => {
        // Get current time and process the frame
        const currentTime: number = sourceVideo.currentTime;
        drawFrameAtTime(currentTime);
      };

      // Handle errors - use a compatible type for the error handler
      sourceVideo.onerror = function (
        this: HTMLVideoElement,
        ev: Event | string
      ): any {
        console.error('Video error during compression:', ev);
        throw new Error('Error processing video for compression');
      };

      // For mobile, we need to monitor if the seeking is actually progressing
      if (isMobile) {
        let lastSeekTime: number = 0;
        let seekStallCount: number = 0;

        // Check every 2 seconds if seeking is making progress
        const seekMonitorInterval: number = window.setInterval(() => {
          const currentTime: number = sourceVideo.currentTime;

          // If time hasn't advanced significantly, increment stall counter
          if (Math.abs(currentTime - lastSeekTime) < 0.1) {
            seekStallCount++;
            console.warn(`Possible seek stall detected: ${seekStallCount}`);

            // After 3 stalls, force progress or abort
            if (seekStallCount >= 3) {
              clearInterval(seekMonitorInterval);

              // Force progress update to avoid appearing stuck
              onProgress(
                Math.min(95, processedFrames ? processedFrames * 10 : 50)
              );

              // Force stop recording and return whatever we have
              if (mediaRecorder.state !== 'inactive') {
                console.warn('Forcing mediaRecorder to stop due to seek stall');
                mediaRecorder.stop();
              }
            }
          } else {
            // Reset stall counter if we're making progress
            seekStallCount = 0;
            lastSeekTime = currentTime;
          }
        }, 2000);

        // Clean up monitor when mediaRecorder stops
        mediaRecorder.onstop = (): void => {
          clearInterval(seekMonitorInterval);
        };
      }

      // Wait for compression to complete (this will be resolved by mediaRecorder.onstop)
      return new Promise<Blob>((resolve) => {
        mediaRecorder.onstop = (): void => {
          const compressedBlob: Blob = new Blob(chunks, { type: mimeType });
          onProgress(100);
          URL.revokeObjectURL(videoUrl);
          resolve(compressedBlob);
        };

        // Start the process by seeking to the beginning
        sourceVideo.currentTime = 0;
      });
    } catch (error) {
      console.error('Video compression failed:', error);
      // If compression fails, return the original
      onProgress(100);
      return videoBlob;
    }
  }
}

export function EnhancedVideoUploadButton({
  videoBlob,
  cameraFacing,
  onProcessingComplete,
  onProcessingError,
  className = '',
  disabled = false,
  useDirectUpload = true,
  uploadOptions = {},
}: EnhancedVideoUploadProps) {
  // State for upload process
  const [uploading, setUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<
    'compressing' | 'uploading' | null
  >(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Video info
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoState | null>(null);
  const [compressionStats, setCompressionStats] =
    useState<CompressionStats | null>(null);

  // Quality settings
  const [selectedQuality, setSelectedQuality] = useState<string>('auto');
  const [autoQuality, setAutoQuality] = useState<string>('medium');

  // Toast notifications
  const { toast } = useToast();

  // Update progress callback
  const updateProgress = (value: number) => {
    setProgress(value);
  };

  // Load video info when blob changes
  useEffect(() => {
    if (videoBlob) {
      getVideoInfo(videoBlob)
        .then((info) => {
          setVideoInfo(info);
          console.log('Video info:', info);
        })
        .catch((err) => console.error('Error getting video info:', err));
    }
  }, [videoBlob]);

  // Detect network conditions on mount and when connection changes
  useEffect(() => {
    const checkNetwork = () => {
      const networkConditions = detectNetworkConditions();
      setNetworkInfo(networkConditions);
      setAutoQuality(networkConditions.qualityRecommendation);
      console.log('Network conditions:', networkConditions);
    };

    // Check immediately
    checkNetwork();

    // Set up connection change listener if available
    const connection =
      navigator.connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    if (connection) {
      connection.addEventListener('change', checkNetwork);
      return () => connection.removeEventListener('change', checkNetwork);
    }
  }, []);

  // Get effective quality setting (resolves 'auto' to the detected quality)
  const getEffectiveQuality = (): string => {
    return selectedQuality === 'auto' ? autoQuality : selectedQuality;
  };

  function checkCompressionSupport() {
    const checks = {
      mediaRecorder: typeof MediaRecorder !== 'undefined',
      canvas:
        typeof document.createElement('canvas').getContext('2d') !==
        'undefined',
      captureStream:
        typeof document.createElement('canvas').captureStream === 'function',
      videoElement:
        typeof document.createElement('video').canPlayType === 'function',
    };

    console.log('Compression support checks:', checks);
    return Object.values(checks).every(Boolean);
  }

  // Handler for the process button click
  const handleProcessVideoClick = async (): Promise<void> => {
    if (!videoBlob) {
      toast({
        title: 'Error',
        description: 'No video to process',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    setProgress(0);
    setProgressStage('compressing');
    setCompressionStats(null);

    try {
      // Determine which quality to use
      const effectiveQuality: string = getEffectiveQuality();

      // On mobile devices, consider using a lower quality or original
      const isMobile: boolean = isMobileDevice();
      const videoSize: number = videoBlob.size / (1024 * 1024); // Size in MB

      // For small videos on mobile, skip compression altogether
      let skipCompression: boolean = false;
      if (isMobile && videoSize < 5) {
        // Skip for videos under 5MB on mobile
        skipCompression = true;
        console.log('Small video on mobile device, skipping compression');
      }

      // Show initial toast
      toast({
        title: 'Processing Video',
        description:
          skipCompression || effectiveQuality === 'original'
            ? 'Preparing for upload...'
            : `Compressing video (${effectiveQuality} quality)...`,
      });

      // Compress the video if not using original quality and not skipping compression
      let processedBlob: Blob = videoBlob;
      let compressionResult: CompressionStats | null = null;

      if (!skipCompression && effectiveQuality !== 'original') {
        console.log(`Compressing video with ${effectiveQuality} quality`);
        try {
          // Add compression timeout to prevent UI from appearing stuck
          const compressionPromise: Promise<Blob> = compressVideo(videoBlob, {
            quality: effectiveQuality,
            onProgress: (compressionProgress: number): void => {
              setProgress(compressionProgress);
            },
          });

          // Race against a timeout for mobile devices
          const timeoutPromise: Promise<Blob> = new Promise<Blob>((resolve) => {
            const timeout: number = isMobile ? 45000 : 120000; // 45 seconds on mobile, 2 minutes on desktop
            setTimeout(() => {
              console.warn(`Compression timed out after ${timeout}ms`);
              setProgress(100);
              resolve(videoBlob); // Use original if timeout
            }, timeout);
          });

          // Use whichever resolves first
          processedBlob = await Promise.race([
            compressionPromise,
            timeoutPromise,
          ]);

          // If we got the original blob back due to timeout, show a message
          if (
            processedBlob === videoBlob &&
            processedBlob.size === videoBlob.size
          ) {
            console.log(
              'Using original video due to compression timeout or failure'
            );
            toast({
              title: 'Compression Skipped',
              description: 'Using original video for upload',
              variant: 'default',
            });
          } else {
            // Calculate compression stats
            const originalSize: number = videoBlob.size / (1024 * 1024);
            const compressedSize: number = processedBlob.size / (1024 * 1024);
            const reduction: number = (1 - compressedSize / originalSize) * 100;

            compressionResult = {
              originalSize: originalSize.toFixed(2) + ' MB',
              compressedSize: compressedSize.toFixed(2) + ' MB',
              reduction: reduction.toFixed(1) + '%',
            };

            setCompressionStats(compressionResult);

            // Update toast with compression result
            toast({
              title: 'Video Compressed',
              description: `Reduced from ${originalSize.toFixed(1)}MB to ${compressedSize.toFixed(1)}MB (${reduction.toFixed(0)}% smaller)`,
              variant: 'default',
            });

            console.log('Compression complete:', compressionResult);
          }
        } catch (error) {
          console.error('Compression failed:', error);
          toast({
            title: 'Compression Failed',
            description: 'Using original video instead',
            variant: 'destructive',
          });
          // Fall back to original video
          processedBlob = videoBlob;
        }
      } else if (skipCompression) {
        // Just update progress for skipped compression
        setProgress(100);
        console.log('Compression skipped, using original video');
      }

      // Now upload the processed blob
      setProgressStage('uploading');
      setProgress(0);

      toast({
        title: 'Uploading',
        description: compressionResult
          ? `Uploading compressed video (${compressionResult.compressedSize})`
          : 'Uploading original video...',
      });

      // Use the uploadVideoDirectly function
      const result: ProcessVideoResponse = await uploadVideoDirectly(
        processedBlob,
        {
          cameraFacing,
          quality: effectiveQuality as any, // Convert to your accepted quality types
          onProgress: updateProgress,
          ...uploadOptions,
        }
      );

      toast({
        title: 'Success',
        description: 'Video uploaded successfully!',
        variant: 'default',
      });

      if (onProcessingComplete) {
        onProcessingComplete(result);
      }
    } catch (error) {
      console.error('Upload failed:', error);

      toast({
        title: 'Upload Failed',
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });

      if (onProcessingError && error instanceof Error) {
        onProcessingError(error);
      }
    } finally {
      setUploading(false);
      setProgress(0);
      setProgressStage(null);
    }
  };

  // Get network quality indicator
  const getNetworkIndicator = () => {
    if (!networkInfo) return null;

    const { effectiveType } = networkInfo;

    if (effectiveType === '4g') {
      return {
        icon: <Wifi className="h-4 w-4 text-green-500" />,
        label: 'Fast',
      };
    } else if (effectiveType === '3g') {
      return {
        icon: <Wifi className="h-4 w-4 text-yellow-500" />,
        label: 'Medium',
      };
    } else {
      return {
        icon: <WifiOff className="h-4 w-4 text-red-500" />,
        label: 'Slow',
      };
    }
  };

  // Format size for display
  const formatSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Get progress label based on stage
  const getProgressLabel = (): string => {
    if (!progressStage) return '';

    switch (progressStage) {
      case 'compressing':
        return `Compressing ${progress}%`;
      case 'uploading':
        return `Uploading ${progress}%`;
      default:
        return `${progress}%`;
    }
  };

  // Network indicator
  const networkIndicator = getNetworkIndicator();

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          className={`flex-1 px-4 py-2 bg-blue-500 text-white rounded-md disabled:opacity-50 ${className}`}
          onClick={handleProcessVideoClick}
          disabled={uploading || !videoBlob || disabled}
        >
          {uploading
            ? getProgressLabel() ||
              `Uploading ${progress ? `${progress}%` : '...'}`
            : 'Upload Video'}
        </button>

        <button
          className="px-2 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md disabled:opacity-50"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          disabled={uploading || disabled}
          title="Upload Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {uploading && progress > 0 && (
        <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-in-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      )}

      {/* Settings panel */}
      {isSettingsOpen && (
        <div className="absolute z-10 mt-1 p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-300 dark:border-gray-700 shadow-lg w-full">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium">Upload Settings</h3>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Network status */}
          {networkIndicator && (
            <div className="flex items-center gap-1.5 mb-3 text-sm">
              {networkIndicator.icon}
              <span>
                Network: {networkIndicator.label}
                {networkInfo?.downlink &&
                  ` (${networkInfo.downlink.toFixed(1)} Mbps)`}
              </span>
            </div>
          )}

          {/* Video info */}
          {videoInfo && (
            <div className="mb-3 text-sm text-gray-500 dark:text-gray-300">
              <div>
                Original: {formatSize(videoInfo.size)} • {videoInfo.width}×
                {videoInfo.height} • {videoInfo.duration.toFixed(1)}s
              </div>
            </div>
          )}

          {/* Quality selector */}
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">
              Upload Quality:
            </label>
            <select
              className="w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              disabled={uploading}
            >
              <option value="auto">
                Auto (Based on Network) - {autoQuality}
              </option>
              <option value="original">
                Original Quality (No Compression)
              </option>
              <option value="high">High Quality (Slower Upload)</option>
              <option value="medium">Medium Quality (Balanced)</option>
              <option value="low">Low Quality (Faster Upload)</option>
              <option value="very-low">
                Very Low Quality (Fastest Upload)
              </option>
            </select>
          </div>

          {/* Estimated file size */}
          {videoInfo &&
            selectedQuality !== 'original' &&
            selectedQuality !== 'auto' && (
              <div className="text-xs text-gray-400 mb-3">
                <div>
                  Estimated compressed size:
                  {selectedQuality === 'very-low' &&
                    ` ~${formatSize(videoInfo.size * 0.15)}`}
                  {selectedQuality === 'low' &&
                    ` ~${formatSize(videoInfo.size * 0.25)}`}
                  {selectedQuality === 'medium' &&
                    ` ~${formatSize(videoInfo.size * 0.4)}`}
                  {selectedQuality === 'high' &&
                    ` ~${formatSize(videoInfo.size * 0.6)}`}
                </div>
              </div>
            )}

          {/* Upload time estimate */}
          {videoInfo && networkInfo?.downlink && networkInfo.downlink > 0 && (
            <div className="text-xs text-gray-400 mb-3">
              <div>
                {selectedQuality === 'original'
                  ? `Estimated upload time: ${(((videoInfo.size * 8) / (networkInfo.downlink * 1000000)) * 1.5).toFixed(1)}s`
                  : selectedQuality === 'auto'
                    ? `Estimated upload time: ${(((videoInfo.size * 8 * (autoQuality === 'very-low' ? 0.15 : autoQuality === 'low' ? 0.25 : autoQuality === 'medium' ? 0.4 : 0.6)) / (networkInfo.downlink * 1000000)) * 1.5).toFixed(1)}s`
                    : `Estimated upload time: ${(((videoInfo.size * 8 * (selectedQuality === 'very-low' ? 0.15 : selectedQuality === 'low' ? 0.25 : selectedQuality === 'medium' ? 0.4 : 0.6)) / (networkInfo.downlink * 1000000)) * 1.5).toFixed(1)}s`}
              </div>
            </div>
          )}

          {/* Compression stats if we've done compression */}
          {compressionStats && (
            <div className="mt-2 p-2 bg-gray-700 rounded text-sm">
              <div className="font-medium mb-1 flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                <span>Compression Results</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div>Original:</div>
                <div>{compressionStats.originalSize}</div>
                <div>Compressed:</div>
                <div>{compressionStats.compressedSize}</div>
                <div>Reduction:</div>
                <div className="text-green-400">
                  {compressionStats.reduction}
                </div>
              </div>
            </div>
          )}

          {/* Tips */}
          <div className="flex items-start gap-1.5 mt-3 text-xs text-gray-400">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Lower quality enables faster uploads on slow connections. Auto
              mode selects appropriate quality based on your network speed.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
