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

  // iOS Safari detection
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isIOSSafari = isIOS && isSafari;

  if (isIOSSafari) {
    console.log('iOS Safari detected, using compatibility mode');
  }

  // Get high quality MIME type
  const mimeType = getHighQualityMimeType();

  // Set canvas dimensions to match source video
  // This is crucial for iOS Safari
  canvas.width = sourceVideo.videoWidth || 640;
  canvas.height = sourceVideo.videoHeight || 480;
  console.log(`Canvas dimensions set to ${canvas.width}x${canvas.height}`);

  // Create a stream from the canvas
  // Use lower FPS on iOS Safari to improve stability
  const fps = isIOSSafari ? 30 : 60;
  // @ts-ignore
  const canvasStream = canvas.captureStream(fps);

  // Lower bitrate on iOS for better compatibility
  const bitrate = isIOSSafari ? 2000000 : 8000000;

  // Set up high quality MediaRecorder
  const mediaRecorder = new MediaRecorder(canvasStream, {
    mimeType: mimeType,
    videoBitsPerSecond: bitrate,
  });

  const chunks: Blob[] = [];
  let frameCount = 0;
  let lastDrawTime = 0;

  // Return a promise that resolves with the trimmed blob
  return new Promise<Blob>((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    // Create the cleanup function to be used later
    const finishRecording = () => {
      try {
        if (chunks.length === 0) {
          throw new Error('No data was collected during trimming');
        }

        const trimmedBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created trimmed blob: ${trimmedBlob.size} bytes`);

        // Additional validation for iOS Safari
        if (trimmedBlob.size < 1000 && isIOSSafari) {
          console.warn(
            'Very small video created, attempting emergency fallback'
          );
          // Try to create a minimum valid video for iOS
          resolve(
            createEmergencyVideoBlob(
              sourceVideo,
              canvas,
              ctx,
              startTime,
              endTime,
              mimeType
            )
          );
          return;
        }

        resolve(trimmedBlob);
      } catch (error) {
        console.error('Error creating final video:', error);
        reject(error);
      }
    };

    mediaRecorder.onstop = () => {
      console.log(`MediaRecorder stopped, processed ${frameCount} frames`);
      finishRecording();
    };

    // Start the MediaRecorder with more frequent chunks for iOS
    mediaRecorder.start(isIOSSafari ? 100 : 50);

    // Function to draw frames with iOS optimizations
    const captureFrames = () => {
      // Stop when we reach the end time
      if (sourceVideo.currentTime >= endTime) {
        console.log(`Reached end time (${endTime}s), stopping recorder`);
        sourceVideo.pause();

        // iOS Safari needs a short delay before stopping to ensure data is captured
        if (isIOSSafari) {
          setTimeout(() => mediaRecorder.stop(), 300);
        } else {
          mediaRecorder.stop();
        }
        return;
      }

      // For iOS Safari, only draw if enough time has passed (throttle)
      const now = performance.now();
      if (!isIOSSafari || now - lastDrawTime > 1000 / fps) {
        lastDrawTime = now;

        // Draw frame to canvas
        try {
          // Clear the canvas first (important for iOS Safari)
          if (isIOSSafari) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }

          ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
          frameCount++;
        } catch (e) {
          console.error('Error drawing frame:', e);
        }

        // Log progress occasionally
        if (frameCount % 30 === 0) {
          console.log(
            `Processed ${frameCount} frames, current time: ${sourceVideo.currentTime.toFixed(2)}s`
          );
        }
      }

      // Continue capturing frames
      requestAnimationFrame(captureFrames);
    };

    // Slightly different approach for iOS Safari
    const startRecording = () => {
      // iOS prefers a slower playback rate
      sourceVideo.playbackRate = isIOSSafari ? 0.6 : 0.8;

      sourceVideo
        .play()
        .then(() => {
          console.log('Playback started for frame capture');
          requestAnimationFrame(captureFrames);
        })
        .catch((err) => {
          console.error('Error playing video for frame capture:', err);
          reject(new Error('Failed to play video for frame capture'));
        });
    };

    // Start the process by seeking to start time
    console.log('Seeking to start time:', startTime);
    sourceVideo.currentTime = startTime;

    // Once seeked, start playing and capturing frames
    sourceVideo.onseeked = () => {
      console.log('Seeked to start time, starting playback');
      startRecording();
    };

    // Safety timeouts - different for iOS
    const safetyTimeout = setTimeout(
      () => {
        if (mediaRecorder.state !== 'inactive') {
          console.warn('Trim operation taking too long, forcing completion');
          sourceVideo.pause();
          mediaRecorder.stop();
        }
      },
      isIOSSafari ? 20000 : 30000
    ); // Shorter timeout on iOS

    // Additional safety for iOS to handle stuck recordings
    if (isIOSSafari) {
      // If we don't get any data within 5 seconds, restart the process
      const iosDataCheckTimeout = setTimeout(() => {
        if (chunks.length === 0 && mediaRecorder.state === 'recording') {
          console.warn('No data received yet, trying emergency approach');
          clearTimeout(safetyTimeout);
          mediaRecorder.stop();

          // Try emergency approach after a short delay
          setTimeout(() => {
            createEmergencyVideoBlob(
              sourceVideo,
              canvas,
              ctx,
              startTime,
              endTime,
              mimeType
            )
              .then(resolve)
              .catch(reject);
          }, 500);
        }
      }, 5000);

      // Clean up this timeout when recording stops
      mediaRecorder.onstop = () => {
        clearTimeout(safetyTimeout);
        clearTimeout(iosDataCheckTimeout);
        console.log(`MediaRecorder stopped, processed ${frameCount} frames`);
        finishRecording();
      };
    } else {
      // For non-iOS, just clean up the main safety timeout
      mediaRecorder.onstop = () => {
        clearTimeout(safetyTimeout);
        console.log(`MediaRecorder stopped, processed ${frameCount} frames`);
        finishRecording();
      };
    }
  });
}

// Emergency fallback for iOS Safari when normal recording fails
async function createEmergencyVideoBlob(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number,
  mimeType: string
): Promise<Blob> {
  console.log('Using emergency iOS fallback method');

  // For emergency fallback, we'll capture key frames as images
  // and create a video from them
  const duration = endTime - startTime;
  const frameCount = Math.max(10, Math.floor(duration * 5)); // At least 10 frames, or 5fps
  const frameTimeSpacing = duration / frameCount;

  const frameBlobs: Blob[] = [];

  // Capture frames at regular intervals
  for (let i = 0; i < frameCount; i++) {
    const frameTime = startTime + i * frameTimeSpacing;

    // Set video to this time
    video.currentTime = frameTime;

    // Wait for video to seek to this time
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });

    // Draw frame to canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get frame as blob
    const frameBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.95);
    });

    frameBlobs.push(frameBlob);
    console.log(`Captured emergency frame ${i + 1}/${frameCount}`);
  }

  // Create a new canvas stream for recording these frames
  // @ts-ignore
  const emergencyStream = canvas.captureStream(15);
  const emergencyRecorder = new MediaRecorder(emergencyStream, {
    mimeType: mimeType,
    videoBitsPerSecond: 1500000, // Lower bitrate for emergency mode
  });

  const chunks: Blob[] = [];
  emergencyRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // Start the recorder
  emergencyRecorder.start();

  // Play back our captured frames
  let frameIndex = 0;
  const playFrames = () => {
    if (frameIndex >= frameBlobs.length) {
      // All frames played, stop recording
      emergencyRecorder.stop();
      return;
    }

    // Draw the current frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Create an image from the blob and draw it
    const img = new Image();
    const url = URL.createObjectURL(frameBlobs[frameIndex]);

    img.onload = () => {
      // Draw the image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Clean up
      URL.revokeObjectURL(url);

      // Schedule next frame
      frameIndex++;
      setTimeout(playFrames, 1000 / 15); // Play at 15fps
    };

    img.src = url;
  };

  // Start playing frames
  playFrames();

  // Wait for recording to complete
  return new Promise<Blob>((resolve, reject) => {
    emergencyRecorder.onstop = () => {
      try {
        if (chunks.length === 0) {
          throw new Error('Emergency recording failed');
        }

        const emergencyBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created emergency blob: ${emergencyBlob.size} bytes`);
        resolve(emergencyBlob);
      } catch (error) {
        reject(error);
      }
    };

    // Safety timeout
    setTimeout(() => {
      if (emergencyRecorder.state !== 'inactive') {
        emergencyRecorder.stop();
      }
    }, 15000);
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
  // iOS Safari prefers MP4
  if (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as any).MSStream &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  ) {
    if (MediaRecorder.isTypeSupported('video/mp4')) {
      console.log('High-quality MIME type supported: video/mp4');
      return 'video/mp4';
    }
  }

  // Try standard formats in order of preference
  if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
    console.log('High-quality MIME type supported: video/webm;codecs=h264');
    return 'video/webm;codecs=h264';
  } else if (MediaRecorder.isTypeSupported('video/webm')) {
    console.log('Basic MIME type supported: video/webm');
    return 'video/webm';
  } else if (MediaRecorder.isTypeSupported('video/mp4')) {
    console.log('High-quality MIME type supported: video/mp4');
    return 'video/mp4';
  }

  // Fallback
  console.log('Falling back to video/webm');
  return 'video/webm';
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
export const getSupportedMimeType = (): string => {
  const types = ['video/mp4;codecs=h264', 'video/mp4', 'video/quicktime'];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log('Using MIME type:', type);
      return type;
    }
  }

  // Fallback to basic mp4
  return 'video/mp4';
};

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
