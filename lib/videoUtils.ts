/**
 * Trims a video blob to a specific time range with improved error handling
 * @param videoBlob The original video blob
 * @param startTime Start time in seconds
 * @param endTime End time in seconds
 * @returns A Promise that resolves to the trimmed video blob
 */
export const trimVideoByTimeRange = async (
  videoBlob: Blob,
  startTime: number,
  endTime: number
): Promise<Blob> => {
  console.log(`Starting trim operation: ${startTime}s to ${endTime}s`);

  // Input validation
  if (!videoBlob || videoBlob.size === 0) {
    throw new Error('Invalid video blob provided');
  }

  if (typeof startTime !== 'number' || typeof endTime !== 'number') {
    throw new Error(`Invalid time values: start=${startTime}, end=${endTime}`);
  }

  // Always ensure valid trim range
  startTime = Math.max(0, startTime);
  // Ensure we have enough buffer after the impact - INCREASED from 0.1 to 0.5
  endTime = Math.max(startTime + 0.5, endTime);

  if (startTime >= endTime) {
    throw new Error(
      `Invalid trim range: start (${startTime}) must be less than end (${endTime})`
    );
  }

  // Check if we're on mobile
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  console.log(`Device detected as ${isMobile ? 'mobile' : 'desktop'}`);

  // Create a video element for the source
  const sourceVideo = document.createElement('video');
  sourceVideo.playsInline = true; // Important for iOS
  sourceVideo.muted = true;
  sourceVideo.crossOrigin = 'anonymous';

  // Create source URL
  let videoUrl = '';

  try {
    // Create blob URL
    videoUrl = URL.createObjectURL(videoBlob);
    console.log(`Created blob URL for video: ${videoUrl}`);
    sourceVideo.src = videoUrl;

    // Force metadata preloading (important for mobile)
    sourceVideo.preload = 'metadata';

    // Wait for metadata to load
    await new Promise<void>((resolve, reject) => {
      // Initialize timeout variable with proper type
      let metadataTimeout: NodeJS.Timeout | null = null;

      sourceVideo.onloadedmetadata = () => {
        console.log(
          `Video metadata loaded: duration=${sourceVideo.duration}s, dimensions=${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`
        );
        if (metadataTimeout) {
          clearTimeout(metadataTimeout);
        }
        resolve();
      };

      sourceVideo.onerror = (e) => {
        console.error('Failed to load video metadata:', e);
        if (metadataTimeout) {
          clearTimeout(metadataTimeout);
        }
        reject(new Error('Failed to load video metadata'));
      };

      // Set the timeout and store the reference
      metadataTimeout = setTimeout(() => {
        console.warn('Metadata loading timed out, proceeding anyway');
        resolve();
      }, 3000);

      // Explicitly call load (important for mobile)
      sourceVideo.load();
    });

    // Double-check video duration and adjust end time if needed
    if (sourceVideo.duration && isFinite(sourceVideo.duration)) {
      console.log(`Verified video duration: ${sourceVideo.duration}s`);
      if (endTime > sourceVideo.duration) {
        console.warn(
          `End time ${endTime}s exceeds video duration ${sourceVideo.duration}s, adjusting`
        );
        endTime = sourceVideo.duration;

        // Re-validate trim range
        if (startTime >= endTime) {
          startTime = Math.max(0, endTime - 0.5);
          console.warn(`Adjusted start time to ${startTime}s for valid range`);
        }
      }
    } else {
      console.warn('Could not verify video duration, using provided values');
    }

    // Set up canvas for frame extraction
    // Use actual video dimensions to maintain quality
    const canvas = document.createElement('canvas');
    canvas.width = sourceVideo.videoWidth || 1280;
    canvas.height = sourceVideo.videoHeight || 720;

    const ctx = canvas.getContext('2d', { alpha: false }); // Alpha: false for better performance
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    console.log(
      `Canvas initialized with dimensions: ${canvas.width}x${canvas.height}`
    );

    // On mobile, we need to handle media differently
    if (isMobile) {
      console.log(
        'Using optimized mobile trimming approach (maintaining original quality)'
      );
      return await mobileTrimVideoHighQuality(
        sourceVideo,
        canvas,
        ctx,
        startTime,
        endTime,
        videoBlob
      );
    } else {
      console.log('Using standard desktop trimming approach');
      return await standardTrimVideo(
        sourceVideo,
        canvas,
        ctx,
        startTime,
        endTime
      );
    }
  } catch (error) {
    console.error('Error in trimVideoByTimeRange:', error);
    // Clean up resources
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    throw error;
  }
};

async function mobileTrimVideoHighQuality(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number,
  originalBlob: Blob
): Promise<Blob> {
  console.log('Starting high-quality mobile trim');

  // Get the highest quality supported MIME type
  const mimeType = getHighQualityMimeType();
  console.log(`Using high-quality MIME type: ${mimeType}`);

  // Create a stream from the canvas with original FPS
  // INCREASED FPS from 30 to ensure we don't miss the impact moment
  const fps = 60;
  // @ts-ignore - TypeScript doesn't recognize captureStream
  const canvasStream = canvas.captureStream(fps);

  // Set up MediaRecorder with high quality settings
  const mediaRecorder = new MediaRecorder(canvasStream, {
    mimeType: mimeType,
    // INCREASED bitrate for higher quality
    videoBitsPerSecond: 8000000,
  });

  const chunks: Blob[] = [];
  let frameCount = 0;
  let processingError = false;

  // Set up promise for recording completion
  return new Promise<Blob>((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      try {
        console.log(
          `MediaRecorder stopped, collected ${chunks.length} chunks, processed ${frameCount} frames`
        );

        // If we have no chunks, reject
        if (chunks.length === 0) {
          reject(new Error('No data captured during recording'));
          return;
        }

        const finalBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created final video: ${finalBlob.size} bytes`);
        resolve(finalBlob);
      } catch (error) {
        console.error('Error creating final video:', error);
        reject(error);
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
      processingError = true;
      reject(new Error('MediaRecorder error occurred'));
    };

    // Start recording - REDUCED chunk size for more frequent data collection
    try {
      mediaRecorder.start(100); // Smaller chunk size for better granularity
      console.log('MediaRecorder started');
    } catch (error) {
      console.error('Failed to start MediaRecorder:', error);
      reject(error);
      return;
    }

    // Safety timeout - stop after 30 seconds or if duration is too long
    // INCREASED buffer time to ensure we capture all frames
    const maxDuration = Math.min(30, endTime - startTime);
    const safetyTimeout = setTimeout(
      () => {
        if (mediaRecorder.state !== 'inactive') {
          console.log('Safety timeout reached, stopping recorder');
          try {
            mediaRecorder.stop();
          } catch (e) {
            console.error('Error stopping recorder:', e);
          }
        }
      },
      maxDuration * 1000 + 5000
    ); // Add 5 seconds buffer

    // Seek to start position with a slight buffer before the intended start
    // ADDED a small offset to ensure we start before the actual start time
    const seekTime = Math.max(0, startTime - 0.1);
    console.log(
      `Seeking to ${seekTime}s (with 0.1s buffer before requested ${startTime}s)`
    );
    sourceVideo.currentTime = seekTime;

    // Mobile compatible frame processor
    const processFrames = () => {
      if (processingError) {
        console.log('Processing error detected, stopping recorder');
        clearTimeout(safetyTimeout);
        try {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        } catch (e) {
          console.error('Error stopping recorder:', e);
        }
        return;
      }

      // IMPROVED end time detection with additional buffer to ensure we include the impact moment
      if (sourceVideo.currentTime >= endTime + 0.2) {
        // Added 0.2s buffer after end time
        // We've reached the end, stop recording
        console.log(
          `Reached end time ${sourceVideo.currentTime}s > ${endTime}s, stopping recorder`
        );
        clearTimeout(safetyTimeout);

        try {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        } catch (e) {
          console.error('Error stopping recorder:', e);
        }

        return;
      }

      try {
        // Draw the current frame to canvas
        ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
        frameCount++;

        // Only log occasionally to reduce console spam
        if (frameCount % 15 === 0) {
          console.log(
            `Processed frame ${frameCount}, time: ${sourceVideo.currentTime.toFixed(2)}/${endTime.toFixed(2)}s`
          );
        }
      } catch (e) {
        console.warn('Error drawing video frame:', e);
        // Continue despite errors
      }

      // Continue to next frame on next animation frame
      requestAnimationFrame(processFrames);
    };

    // When video is seeked to start point, start playing and processing
    sourceVideo.onseeked = () => {
      console.log(
        `Successfully seeked to ${sourceVideo.currentTime.toFixed(2)}s`
      );

      sourceVideo
        .play()
        .then(() => {
          console.log('Video playback started, beginning frame processing');
          // Start processing frames
          requestAnimationFrame(processFrames);
        })
        .catch((err) => {
          console.error('Error playing video:', err);

          // On iOS, autoplay might be prevented
          if (isSafari()) {
            console.log('Safari detected, trying alternative approach');
            // Now we can pass the originalBlob parameter properly
            tryAlternativeSafariApproach(
              sourceVideo,
              originalBlob,
              startTime,
              endTime
            )
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error('Failed to play video for frame capture'));
          }
        });
    };

    // Handle seeking errors
    sourceVideo.onerror = (error) => {
      console.error('Error with video element:', error);
      reject(new Error('Video element error during processing'));
    };
  });
}

/**
 * Trims a video by rendering frames to a canvas and recording
 * @param sourceVideo The video element to trim
 * @param canvas The canvas to draw frames on
 * @param ctx The canvas 2D context
 * @param startTime The start time in seconds
 * @param endTime The end time in seconds
 * @returns A promise resolving to a Blob containing the trimmed video
 */
export async function standardTrimVideo(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number
): Promise<Blob> {
  console.log(`Starting trim operation from ${startTime}s to ${endTime}s`);

  // Make sure we can detect iOS Safari using TypeScript-safe methods
  const isIOS: boolean =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(
      navigator.userAgent.includes('Windows') ||
      navigator.userAgent.includes('Android')
    );
  const isSafari: boolean = /^((?!chrome|android).)*safari/i.test(
    navigator.userAgent
  );
  const isIOSSafari: boolean = isIOS && isSafari;

  console.log(`Device detection - iOS: ${isIOS}, Safari: ${isSafari}`);

  // Special handling for iOS Safari
  if (isIOSSafari) {
    console.log('Using iOS Safari optimized trimming approach');
    return await iosSafariTrimVideo(
      sourceVideo,
      canvas,
      ctx,
      startTime,
      endTime
    );
  }

  // Standard approach for other browsers
  return await standardBrowserTrimVideo(
    sourceVideo,
    canvas,
    ctx,
    startTime,
    endTime
  );
}

/**
 * iOS Safari specific implementation for video trimming
 */
async function iosSafariTrimVideo(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number
): Promise<Blob> {
  // 1. Set up variables
  const framerate: number = 30; // iOS Safari typically records at 30fps
  const duration: number = endTime - startTime;
  const totalFrames: number = Math.ceil(duration * framerate);

  console.log(
    `iOS trim: ${duration}s at ${framerate}fps = ${totalFrames} frames`
  );

  // 2. Create MediaRecorder with iOS compatible settings
  const stream: MediaStream = canvas.captureStream(framerate);
  const recorder: MediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/mp4;codecs=h264', // Explicitly use H.264 if supported
    videoBitsPerSecond: 2500000, // 2.5 Mbps is good for mobile
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // 3. Set up promise to wait for recording completion
  const recordingPromise: Promise<Blob> = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/mp4' });
      console.log(`iOS trimmed video size: ${blob.size / 1024} KB`);
      resolve(blob);
    };
  });

  // 4. Start recording from the canvas
  recorder.start();

  // 5. Seek to start position and wait for it to be ready
  sourceVideo.currentTime = startTime;
  await new Promise<void>((resolve) => {
    sourceVideo.onseeked = () => resolve();
  });

  // 6. Draw frames at regular intervals to create the trimmed video
  const frameInterval: number = 1000 / framerate; // ms between frames
  let currentTime: number = startTime;

  // Use requestAnimationFrame for smoother rendering
  const drawFrame = async (): Promise<void> => {
    if (currentTime <= endTime) {
      // Draw the current frame
      ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);

      // Move to next frame
      currentTime += 1 / framerate;
      sourceVideo.currentTime = currentTime;

      // Wait for seeking to complete
      await new Promise<void>((resolve) => {
        sourceVideo.onseeked = () => resolve();
      });

      // Continue drawing
      requestAnimationFrame(drawFrame);
    } else {
      // Done with all frames, stop recording
      setTimeout(() => {
        recorder.stop();
      }, 100); // Small delay to ensure last frame is captured
    }
  };

  // Start the frame drawing process
  drawFrame();

  // 7. Wait for recording to complete and return the blob
  return recordingPromise;
}

/**
 * Standard implementation for other browsers
 */
async function standardBrowserTrimVideo(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number
): Promise<Blob> {
  // Create a recording stream from the canvas
  const stream: MediaStream = canvas.captureStream();
  const recorder: MediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9', // Better for non-iOS browsers
    videoBitsPerSecond: 5000000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const recordingPromise: Promise<Blob> = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(blob);
    };
  });

  recorder.start();

  // Draw frames from start to end time
  sourceVideo.currentTime = startTime;
  await new Promise<void>((resolve) => {
    sourceVideo.onseeked = () => resolve();
  });

  const interval = setInterval(() => {
    if (sourceVideo.currentTime < endTime) {
      ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
      sourceVideo.currentTime += 0.1; // Advance by 100ms
    } else {
      clearInterval(interval);
      setTimeout(() => recorder.stop(), 100);
    }
  }, 100);

  return recordingPromise;
}

// For TypeScript support of FFmpeg import
interface FFmpeg {
  load(): Promise<void>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  exec(args: string[]): Promise<void>;
}

interface FFmpegModule {
  FFmpeg: { new (): FFmpeg };
}

interface FetchFileModule {
  fetchFile(blob: Blob): Promise<Uint8Array>;
}

/**
 * Simplified FFmpeg compression specifically for iOS Safari videos
 */
export async function compressIOSVideo(videoBlob: Blob): Promise<Blob> {
  // Only import FFmpeg when needed
  const { FFmpeg } = (await import(
    '@ffmpeg/ffmpeg'
  )) as unknown as FFmpegModule;
  const { fetchFile } = (await import(
    '@ffmpeg/util'
  )) as unknown as FetchFileModule;

  // Create FFmpeg instance
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();

  // Write input file
  const inputFileName = 'input.mp4';
  const outputFileName = 'compressed.mp4';
  await ffmpeg.writeFile(inputFileName, await fetchFile(videoBlob));

  // Use iOS-friendly compression settings
  // Less aggressive compression for iOS to preserve compatibility
  await ffmpeg.exec([
    '-i',
    inputFileName,
    '-c:v',
    'libx264',
    '-crf',
    '23', // Less compression (lower number = higher quality)
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p', // Required for iOS compatibility
    '-profile:v',
    'baseline', // More compatible with iOS
    '-level',
    '3.0', // Compatibility level
    '-movflags',
    '+faststart', // Optimize for web playback
    '-an', // Remove audio
    outputFileName,
  ]);

  // Read the compressed file
  const data = await ffmpeg.readFile(outputFileName);
  return new Blob([data], { type: 'video/mp4' });
}

/**
 * Detects if the current browser is running on iOS
 * Using a TypeScript-safe implementation
 */
export function isIOSDevice(): boolean {
  const userAgent = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(userAgent) &&
    // Safe check that doesn't use MSStream
    !(userAgent.includes('Windows') || userAgent.includes('Android'))
  );
}

/**
 * Detects if the current browser is Safari
 */
export function isSafariBrowser(): boolean {
  const userAgent = navigator.userAgent;
  return /^((?!chrome|android).)*safari/i.test(userAgent);
}

/**
 * Detects if the current browser is iOS Safari
 */
export function isIOSSafari(): boolean {
  return isIOSDevice() && isSafariBrowser();
}

/**
 * Returns true if running in Safari
 */
function isSafari(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('safari') && !userAgent.includes('chrome');
}

/**
 * Get a high-quality MIME type that's supported by the browser
 */
function getHighQualityMimeType(): string {
  // Try high quality formats first
  const types = [
    'video/mp4;codecs=h264', // Most compatible high quality
    'video/mp4',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`High-quality MIME type supported: ${type}`);
      return type;
    }
  }

  console.warn('No ideal MIME types supported, falling back to default');
  return 'video/mp4';
}

/**
 * For Safari on iOS as a last resort
 * This uses a simpler approach to work around iOS media restrictions
 */
async function tryAlternativeSafariApproach(
  videoElement: HTMLVideoElement,
  videoBlob: Blob,
  startTime: number,
  endTime: number
): Promise<Blob> {
  // Simple fallback implementation for Safari
  console.log('Trying alternative approach for Safari');

  // We return the original blob as a last resort
  console.log('Alternative approach: returning original blob as fallback');
  return videoBlob;
}

/**
 * Gets the most appropriate MIME type for the current browser environment
 * @returns The supported MIME type string
 */
export function getSupportedMimeType(): string {
  const types: string[] = [
    'video/mp4; codecs=h264',
    'video/webm; codecs=h264',
    'video/webm; codecs=vp9',
    'video/webm; codecs=vp8',
    'video/webm',
    'video/mp4',
  ];

  // Log device info for debugging - TypeScript-safe detection
  const isIOS: boolean =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(
      navigator.userAgent.includes('Windows') ||
      navigator.userAgent.includes('Android')
    );
  const isSafari: boolean = /^((?!chrome|android).)*safari/i.test(
    navigator.userAgent
  );
  console.log(
    `Device detection in getSupportedMimeType - iOS: ${isIOS}, Safari: ${isSafari}`
  );

  // Check each MIME type and log which one we're using
  for (const type of types) {
    try {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`Selected MIME type: ${type}`);
        return type;
      }
    } catch (e) {
      console.warn(`Error checking support for ${type}:`, e);
    }
  }

  // Default fallback if nothing is explicitly supported
  console.warn('No specified MIME type is supported, using default');
  return ''; // Let the browser choose
}

/**
 * Creates a MediaRecorder with appropriate options for the current environment
 * @param stream The MediaStream to record
 * @param mimeType The MIME type to use
 * @returns A configured MediaRecorder instance
 */
export function createMediaRecorder(
  stream: MediaStream,
  mimeType?: string
): MediaRecorder {
  console.log(`Creating MediaRecorder with type: ${mimeType}`);

  try {
    // For iOS Safari, we need to be more careful with options
    const isIOS: boolean =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(
        navigator.userAgent.includes('Windows') ||
        navigator.userAgent.includes('Android')
      );

    const options: MediaRecorderOptions = {};

    if (mimeType) {
      options.mimeType = mimeType;
    }

    // iOS Safari often works better with lower bitrates
    if (isIOS) {
      options.videoBitsPerSecond = 2500000; // 2.5 Mbps
    } else {
      options.videoBitsPerSecond = 5000000; // 5 Mbps
    }

    console.log('MediaRecorder options:', JSON.stringify(options));

    const recorder = new MediaRecorder(stream, options);

    // Add error handler for debugging
    recorder.onerror = (event: Event) => {
      console.error('MediaRecorder error:', event);
      console.error('MediaRecorder error message:', event);
    };

    return recorder;
  } catch (err) {
    console.error(
      'Failed to create MediaRecorder with the specified options:',
      err
    );

    // Fallback with no options
    console.log('Trying to create MediaRecorder with no options');
    return new MediaRecorder(stream);
  }
}

/**
 * Prepares a video element for playback with a blob
 * @param videoElement The video element reference
 * @param blob The video blob to play
 */
export const prepareVideoForPlayback = (
  videoElement: HTMLVideoElement | null,
  blob: Blob
): void => {
  if (!videoElement) return;

  console.log(`Preparing video for playback, blob size: ${blob.size} bytes`);

  // Create a new object URL to avoid potential caching issues
  const url = URL.createObjectURL(blob);

  // Clear any existing blob URLs first
  if (videoElement.src && videoElement.src.startsWith('blob:')) {
    URL.revokeObjectURL(videoElement.src);
  }

  // Set the source to the new blob URL
  videoElement.src = url;

  // Wait for the video to load metadata before trying to play
  videoElement.onloadedmetadata = () => {
    console.log(`Video metadata loaded. Duration: ${videoElement.duration}s`);
    // Reset the playback position to the start
    videoElement.currentTime = 0;
  };

  // Wait for the video to be ready to play
  videoElement.oncanplay = () => {
    console.log('Video can play, starting playback');
    videoElement
      .play()
      .then(() => console.log('Playback started successfully'))
      .catch((err) => console.error('Error starting playback:', err));
  };

  // Force a reload to apply the new source
  videoElement.load();
};

/**
 * Format a duration in seconds to a readable string
 * @param seconds The duration in seconds
 * @returns Formatted string in the format "m:ss.t"
 */
export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
};

/**
 * Gets the actual duration of a video blob by loading it into a video element
 * @param videoBlob The video blob to check
 * @returns Promise that resolves to the duration in seconds
 */
export const getVideoDuration = (videoBlob: Blob): Promise<number> => {
  return new Promise((resolve, reject) => {
    // Create a temporary video element
    const tempVideo = document.createElement('video');
    const url = URL.createObjectURL(videoBlob);

    // Set up event listeners
    tempVideo.onloadedmetadata = () => {
      // Get the duration
      const duration = tempVideo.duration;
      console.log(`Video metadata loaded, duration: ${duration}s`);

      // Clean up
      URL.revokeObjectURL(url);

      // If we got a valid duration, resolve with it
      if (duration && isFinite(duration) && duration > 0) {
        resolve(duration);
      } else {
        console.warn(`Invalid duration detected: ${duration}, using fallback`);
        // Fallback to a reasonable estimate based on file size
        // A very rough estimate: assume 1MB ≈ 1 second of video at moderate quality
        const estimatedDuration = videoBlob.size / (1024 * 1024);
        resolve(Math.max(estimatedDuration, 1)); // At least 1 second
      }
    };

    tempVideo.onerror = (error) => {
      console.error('Error loading video to get duration:', error);
      URL.revokeObjectURL(url);

      // Fallback to a size-based estimate
      const estimatedDuration = videoBlob.size / (1024 * 1024);
      console.log(`Using fallback duration estimate: ${estimatedDuration}s`);
      resolve(Math.max(estimatedDuration, 1)); // At least 1 second
    };

    // Add a safety timeout
    const timeout = setTimeout(() => {
      console.warn('Duration detection timed out');
      URL.revokeObjectURL(url);

      // Fallback to a size-based estimate
      const estimatedDuration = videoBlob.size / (1024 * 1024);
      console.log(
        `Using fallback duration estimate after timeout: ${estimatedDuration}s`
      );
      resolve(Math.max(estimatedDuration, 1)); // At least 1 second
    }, 3000); // 3 second timeout

    // Start loading the video
    tempVideo.src = url;
    tempVideo.preload = 'metadata';

    // When metadata is loaded, it will trigger onloadedmetadata
    tempVideo.load();

    // Clear timeout if metadata loads normally
    tempVideo.onloadedmetadata = () => {
      clearTimeout(timeout);
      const duration = tempVideo.duration;
      console.log(`Video metadata loaded, duration: ${duration}s`);

      // Clean up
      URL.revokeObjectURL(url);

      // If we got a valid duration, resolve with it
      if (duration && isFinite(duration) && duration > 0) {
        resolve(duration);
      } else {
        console.warn(`Invalid duration detected: ${duration}, using fallback`);
        // Fallback to a reasonable estimate based on file size
        const estimatedDuration = videoBlob.size / (1024 * 1024);
        resolve(Math.max(estimatedDuration, 1)); // At least 1 second
      }
    };
  });
};
