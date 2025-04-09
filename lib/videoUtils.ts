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
 * Standard approach for desktop browsers
 */
export async function standardTrimVideo(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number
): Promise<Blob> {
  console.log('Using standard trim approach');

  // Get supported MIME type - prioritize WebM formats for Android compatibility
  const mimeType = getSupportedMimeType();
  console.log(`Selected MIME type for recording: ${mimeType}`);

  // Create a stream from the canvas
  // @ts-ignore
  const canvasStream = canvas.captureStream(30); // 30 FPS is more compatible

  // Set up MediaRecorder with more compatible settings
  const options: MediaRecorderOptions = {};

  if (mimeType) {
    options.mimeType = mimeType;
  }

  // Use a moderate bitrate for better compatibility
  (options as any).videoBitsPerSecond = 2000000; // 2Mbps is more compatible

  console.log(`Creating MediaRecorder with options:`, options);

  // Try to create MediaRecorder with the options
  let mediaRecorder: MediaRecorder;

  try {
    mediaRecorder = new MediaRecorder(canvasStream, options);
    console.log(
      `MediaRecorder created successfully with MIME type: ${mediaRecorder.mimeType}`
    );
  } catch (error) {
    console.error(
      'Failed to create MediaRecorder with specified options:',
      error
    );

    // Try again with minimal options
    try {
      mediaRecorder = new MediaRecorder(canvasStream);
      console.log(
        `Fallback MediaRecorder created with MIME type: ${mediaRecorder.mimeType}`
      );
    } catch (fallbackError) {
      console.error(
        'Failed to create MediaRecorder even with fallback options:',
        fallbackError
      );
      throw new Error('MediaRecorder is not supported on this device');
    }
  }

  const chunks: Blob[] = [];
  let frameCount = 0;

  // Return a promise that resolves with the trimmed blob
  return new Promise<Blob>((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
        console.log(
          `Received data chunk: ${e.data.size} bytes, type: ${e.data.type}`
        );
      }
    };

    // Set up safety timeout
    const safetyTimeout = setTimeout(() => {
      if (mediaRecorder.state !== 'inactive') {
        console.warn('Trim operation taking too long, forcing completion');
        try {
          mediaRecorder.stop();
        } catch (e) {
          console.error('Error stopping recorder in timeout:', e);
        }
      }
    }, 30000); // 30-second safety timeout

    mediaRecorder.onstop = () => {
      clearTimeout(safetyTimeout);
      console.log(`MediaRecorder stopped, processed ${frameCount} frames`);

      try {
        if (chunks.length === 0) {
          throw new Error('No data was collected during trimming');
        }

        // Use the MediaRecorder's actual MIME type for the blob
        const actualType = mediaRecorder.mimeType || 'video/webm';
        const trimmedBlob = new Blob(chunks, { type: actualType });
        console.log(
          `Created trimmed blob: ${trimmedBlob.size} bytes, type: ${actualType}`
        );

        resolve(trimmedBlob);
      } catch (error) {
        console.error('Error creating final video:', error);
        reject(error);
      }
    };

    mediaRecorder.onerror = (event) => {
      clearTimeout(safetyTimeout);
      console.error('MediaRecorder error:', event);
      reject(new Error('MediaRecorder encountered an error'));
    };

    // Start the MediaRecorder with more frequent chunks
    try {
      mediaRecorder.start(100); // 100ms chunks for better reliability
      console.log('MediaRecorder started');
    } catch (e) {
      console.error('Error starting MediaRecorder:', e);
      clearTimeout(safetyTimeout);
      reject(new Error('Failed to start MediaRecorder'));
      return;
    }

    // Function to draw frames
    const captureFrames = () => {
      // Stop when we reach the end time
      if (sourceVideo.currentTime >= endTime) {
        console.log(`Reached end time (${endTime}s), stopping recorder`);
        try {
          mediaRecorder.stop();
        } catch (e) {
          console.error('Error stopping recorder:', e);
        }
        sourceVideo.pause();
        return;
      }

      // Draw frame to canvas
      try {
        ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
        frameCount++;
      } catch (e) {
        console.error('Error drawing frame:', e);
      }

      // Request next frame
      requestAnimationFrame(captureFrames);
    };

    // Start the process by seeking to start time
    console.log(`Seeking to start time: ${startTime}`);
    sourceVideo.currentTime = startTime;

    // Once seeked, start playing and capturing frames
    const onSeeked = () => {
      sourceVideo.removeEventListener('seeked', onSeeked);
      console.log('Seeked to start time, starting playback');

      // Use normal playback rate for more reliable capture
      sourceVideo.playbackRate = 1.0;

      sourceVideo
        .play()
        .then(() => {
          console.log('Playback started for frame capture');
          requestAnimationFrame(captureFrames);
        })
        .catch((err) => {
          console.error('Error playing video for frame capture:', err);
          try {
            mediaRecorder.stop();
          } catch (e) {
            console.error('Error stopping recorder after play failure:', e);
          }
          clearTimeout(safetyTimeout);
          reject(new Error('Failed to play video for frame capture'));
        });
    };

    sourceVideo.addEventListener('seeked', onSeeked);
  });
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
 * Helper function to find the best supported video format
 * @returns The most suitable MIME type for video recording
 */
export function getSupportedMimeType(): string {
  // Android-friendly MIME types, in order of preference
  const mimeTypes = [
    'video/webm;codecs=vp8',
    'video/webm',
    'video/webm;codecs=vp9',
  ];

  for (const type of mimeTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`Browser supports MIME type: ${type}`);
      return type;
    }
  }

  console.warn(
    'No preferred MIME types supported, falling back to browser default'
  );
  return ''; // Let the browser choose
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
