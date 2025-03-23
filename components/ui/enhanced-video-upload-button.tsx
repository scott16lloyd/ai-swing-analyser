'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  uploadVideoDirectly,
  ProcessVideoResponse,
  ProcessVideoOptions,
} from '@/components/ui/upload-button';
import {
  Upload,
  Settings,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle,
  X,
} from 'lucide-react';

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
 * Returns the best supported video format for MediaRecorder
 */
function getBestSupportedMimeType(): string {
  const types = [
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
 */
async function compressVideo(
  videoBlob: Blob,
  options: {
    quality?: string;
    onProgress?: (progress: number) => void;
    maxDuration?: number;
  } = {}
): Promise<Blob> {
  // Default options
  const {
    quality = 'medium',
    onProgress = (progress: number) =>
      console.log(`Compression progress: ${progress}%`),
    maxDuration = 15, // Default max duration
  } = options;

  onProgress(0);

  // If quality is 'original', return the original blob
  if (quality === 'original') {
    onProgress(100);
    return videoBlob;
  }

  // Get quality settings
  const settings = QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;
  if (!settings) {
    console.warn('Invalid quality setting, using medium quality');
    return compressVideo(videoBlob, { ...options, quality: 'medium' });
  }

  console.log('Using compression settings:', settings);

  // Create a video element to load the original video
  const sourceVideo = document.createElement('video');
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;

  try {
    // Create URL for the video blob
    const videoUrl = URL.createObjectURL(videoBlob);
    sourceVideo.src = videoUrl;

    // Wait for metadata to load
    await new Promise<void>((resolve, reject) => {
      let timeoutId: number | null = null;

      sourceVideo.onloadedmetadata = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };

      sourceVideo.onerror = (event) => {
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

    // Get the video dimensions and duration
    const originalWidth = sourceVideo.videoWidth;
    const originalHeight = sourceVideo.videoHeight;
    const originalDuration = sourceVideo.duration;

    console.log('Original video:', {
      width: originalWidth,
      height: originalHeight,
      duration: originalDuration.toFixed(2) + 's',
      size: (videoBlob.size / (1024 * 1024)).toFixed(2) + 'MB',
    });

    // Calculate target dimensions while maintaining aspect ratio
    const aspectRatio = originalWidth / originalHeight;

    // If the video is portrait, swap width and height in our calculations
    let targetWidth: number;
    let targetHeight: number;

    if (originalHeight > originalWidth) {
      // Portrait video
      targetHeight = settings.width;
      targetWidth = Math.round(settings.width / aspectRatio);
    } else {
      // Landscape video
      targetWidth = settings.width;
      targetHeight = Math.round(settings.width / aspectRatio);
    }

    // Ensure dimensions are even (required by some encoders)
    targetWidth = Math.floor(targetWidth / 2) * 2;
    targetHeight = Math.floor(targetHeight / 2) * 2;

    console.log('Target dimensions:', targetWidth, 'x', targetHeight);

    // Create a canvas for the compressed video frames
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }

    // Get the best supported MIME type
    const mimeType = getBestSupportedMimeType();

    // Set up parameters for MediaRecorder
    const recorderOptions: MediaRecorderOptions = {
      mimeType,
      videoBitsPerSecond: settings.bitrate,
    };

    // Create a MediaRecorder with the canvas stream
    // @ts-ignore - TypeScript doesn't fully recognize captureStream
    const stream = canvas.captureStream(settings.frameRate);
    const mediaRecorder = new MediaRecorder(stream, recorderOptions);

    // Store the recorded chunks
    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    // Start recording
    mediaRecorder.start(1000); // Capture in 1-second chunks

    // Calculate actual duration to process (respecting maxDuration)
    const duration = Math.min(originalDuration, maxDuration);
    console.log(`Processing ${duration.toFixed(2)}s of video`);

    // Track frame count for progress updates
    let processedFrames = 0;
    const totalFrames = Math.ceil(duration * settings.frameRate);

    // Disable image smoothing for faster rendering
    ctx.imageSmoothingQuality = 'low';

    // Process video frames
    return new Promise<Blob>((resolve, reject) => {
      // Set up completion handling
      mediaRecorder.onstop = () => {
        try {
          // Create final compressed video blob
          const compressedBlob = new Blob(chunks, { type: mimeType });

          console.log('Compression complete:', {
            originalSize: (videoBlob.size / (1024 * 1024)).toFixed(2) + 'MB',
            compressedSize:
              (compressedBlob.size / (1024 * 1024)).toFixed(2) + 'MB',
            reductionPercent:
              Math.round((1 - compressedBlob.size / videoBlob.size) * 100) +
              '%',
          });

          // Clean up
          URL.revokeObjectURL(sourceVideo.src);
          onProgress(100);
          resolve(compressedBlob);
        } catch (error) {
          console.error('Error creating compressed video:', error);
          reject(error);
        }
      };

      // Set up error handling
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        reject(new Error('Error during video compression'));
      };

      // Function to draw a frame at the specified time
      const drawFrameAtTime = (time: number) => {
        try {
          // Draw the current frame to canvas
          ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);

          // Update progress
          processedFrames++;
          const progress = Math.min(
            95,
            Math.round((processedFrames / totalFrames) * 100)
          );

          // Only update progress every few frames to avoid excessive UI updates
          if (processedFrames % 5 === 0) {
            onProgress(progress);
          }

          // If we've reached the end, stop recording
          if (time >= duration || sourceVideo.ended) {
            console.log(`Reached end of video at ${time.toFixed(2)}s`);
            mediaRecorder.stop();
            return;
          }

          // Otherwise, move to next frame
          sourceVideo.currentTime = Math.min(
            time + 1 / settings.frameRate,
            duration
          );
        } catch (error) {
          console.error('Error drawing frame:', error);
          // Try to continue despite errors
        }
      };

      // Handle seeking to a specific time
      sourceVideo.onseeked = () => {
        // Get current time and process the frame
        const currentTime = sourceVideo.currentTime;
        drawFrameAtTime(currentTime);
      };

      // Handle errors
      sourceVideo.onerror = (error) => {
        console.error('Video error during compression:', error);
        reject(new Error('Error processing video for compression'));
      };

      // Start the process by seeking to the beginning
      sourceVideo.currentTime = 0;
    });
  } catch (error) {
    console.error('Video compression failed:', error);
    // If compression fails, return the original
    return videoBlob;
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

  // Handle compression and upload
  const handleProcessVideo = async () => {
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
      const effectiveQuality = getEffectiveQuality();

      // Show initial toast
      toast({
        title: 'Processing Video',
        description:
          effectiveQuality === 'original'
            ? 'Preparing for upload...'
            : `Compressing video (${effectiveQuality} quality)...`,
      });

      // Compress the video if not using original quality
      let processedBlob = videoBlob;
      let compressionResult: CompressionStats | null = null;

      if (effectiveQuality !== 'original') {
        console.log(`Compressing video with ${effectiveQuality} quality`);
        try {
          processedBlob = await compressVideo(videoBlob, {
            quality: effectiveQuality,
            onProgress: (compressionProgress) => {
              setProgress(compressionProgress);
            },
          });

          // Calculate compression stats
          const originalSize = videoBlob.size / (1024 * 1024);
          const compressedSize = processedBlob.size / (1024 * 1024);
          const reduction = (1 - compressedSize / originalSize) * 100;

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

      // Use your existing uploadVideoDirectly function
      const result = await uploadVideoDirectly(processedBlob, {
        cameraFacing,
        quality: effectiveQuality as any, // Convert to your accepted quality types
        onProgress: updateProgress,
        ...uploadOptions,
      });

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
          onClick={handleProcessVideo}
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
