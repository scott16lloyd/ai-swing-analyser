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

  // FIXED: Improved detection that won't incorrectly match desktop browsers
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as any).MSStream &&
    !(/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isIOSSafari = isIOS && isSafari;

  if (isIOSSafari) {
    console.log('iOS Safari detected, using compatibility mode');
  } else {
    console.log('Using standard browser mode');
  }

  // Get high quality MIME type
  let mimeType = 'video/webm';

  // Try standard formats in order of preference
  if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
    console.log('High-quality MIME type supported: video/webm;codecs=h264');
    mimeType = 'video/webm;codecs=h264';
  } else if (MediaRecorder.isTypeSupported('video/webm')) {
    console.log('Basic MIME type supported: video/webm');
    mimeType = 'video/webm';
  } else if (MediaRecorder.isTypeSupported('video/mp4')) {
    console.log('High-quality MIME type supported: video/mp4');
    mimeType = 'video/mp4';
  }

  // Special handling for iOS - always prefer MP4
  if (isIOSSafari && MediaRecorder.isTypeSupported('video/mp4')) {
    mimeType = 'video/mp4';
    console.log('Using MP4 for iOS Safari');
  }

  // IMPORTANT: Always ensure canvas dimensions match video
  const videoWidth = sourceVideo.videoWidth || 640;
  const videoHeight = sourceVideo.videoHeight || 480;
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  console.log(`Canvas dimensions set to ${canvas.width}x${canvas.height}`);

  // Now choose the appropriate method for the browser
  if (isIOSSafari) {
    // For iOS Safari, use a completely different approach with direct frame capture
    return await captureDirectFramesIOS(
      sourceVideo,
      canvas,
      ctx,
      startTime,
      endTime,
      mimeType
    );
  } else {
    // For other browsers, use the standard approach
    return await captureStandardBrowser(
      sourceVideo,
      canvas,
      ctx,
      startTime,
      endTime,
      mimeType
    );
  }
}

// Standard approach for desktop browsers
async function captureStandardBrowser(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number,
  mimeType: string
): Promise<Blob> {
  console.log('Using standard browser capture method');

  // Create a stream from the canvas
  // @ts-ignore
  const canvasStream = canvas.captureStream(60);

  // Set up high quality MediaRecorder
  const mediaRecorder = new MediaRecorder(canvasStream, {
    mimeType: mimeType,
    videoBitsPerSecond: 8000000, // High quality for desktop
  });

  const chunks: Blob[] = [];
  let frameCount = 0;

  // Return a promise that resolves with the trimmed blob
  return new Promise<Blob>((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    mediaRecorder.onstop = (event: Event) => {
      console.log(`MediaRecorder stopped, processed ${frameCount} frames`);

      try {
        if (chunks.length === 0) {
          throw new Error('No data was collected during trimming');
        }

        const trimmedBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created trimmed blob: ${trimmedBlob.size} bytes`);

        resolve(trimmedBlob);
      } catch (error) {
        console.error('Error creating final video:', error);
        reject(error);
      }
    };

    // Start the MediaRecorder
    mediaRecorder.start(50);

    // Function to draw frames
    const captureFrames = () => {
      // Stop when we reach the end time with a small buffer
      if (sourceVideo.currentTime >= endTime + 0.2) {
        console.log(`Reached end time (${endTime}s), stopping recorder`);
        mediaRecorder.stop();
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

      // Log progress occasionally
      if (frameCount % 30 === 0) {
        console.log(
          `Processed ${frameCount} frames, current time: ${sourceVideo.currentTime.toFixed(2)}s`
        );
      }

      // Continue capturing frames
      requestAnimationFrame(captureFrames);
    };

    // Start the process by seeking to slightly before start time
    const seekTime = Math.max(0, startTime - 0.1);
    console.log('Seeking to start time with buffer:', seekTime);
    sourceVideo.currentTime = seekTime;

    // Once seeked, start playing and capturing frames
    sourceVideo.onseeked = () => {
      console.log('Seeked to start time, starting playback');

      // Slow down playback for more precise frame capture
      sourceVideo.playbackRate = 0.8;

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

    // Set a safety timeout
    const safetyTimeout = setTimeout(() => {
      if (mediaRecorder.state !== 'inactive') {
        console.warn('Trim operation taking too long, forcing completion');
        mediaRecorder.stop();
      }
    }, 30000);

    // Override onstop to clean up timeout
    const originalOnStop = mediaRecorder.onstop;
    mediaRecorder.onstop = (event: Event) => {
      clearTimeout(safetyTimeout);
      originalOnStop.call(mediaRecorder, event);
    };
  });
}

// NEW METHOD: Direct frame capture for iOS - completely different approach
async function captureDirectFramesIOS(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number,
  mimeType: string
): Promise<Blob> {
  console.log('Using direct frame capture for iOS Safari');

  // Pause the video to ensure we have full control
  sourceVideo.pause();

  // Create a new hidden video element for the source
  // This is important as we need a dedicated element for frame extraction
  // that won't have any UI controls or playback issues
  const extractionVideo = document.createElement('video');
  extractionVideo.style.position = 'absolute';
  extractionVideo.style.left = '-9999px';
  extractionVideo.style.top = '-9999px';
  document.body.appendChild(extractionVideo);

  // Configure the extraction video
  extractionVideo.crossOrigin = 'anonymous';
  extractionVideo.muted = true;
  extractionVideo.autoplay = false;
  extractionVideo.playsInline = true;

  // Create a temporary object URL that we can use for the extraction video
  const sourceVideoUrl = sourceVideo.src;
  console.log(
    `Setting up extraction from source: ${sourceVideo.src.substring(0, 50)}...`
  );

  // Set the source of the extraction video
  extractionVideo.src = sourceVideoUrl;

  // Wait for metadata to load
  await new Promise<void>((resolve, reject) => {
    extractionVideo.onloadedmetadata = () => resolve();
    extractionVideo.onerror = (e) =>
      reject(new Error(`Video load error: ${e}`));

    // Safety timeout
    setTimeout(() => resolve(), 3000);
  });

  console.log('Extraction video loaded, starting frame capture');

  // Calculate number of frames needed
  const fps = 15; // Lower fps for iOS
  const duration = endTime - startTime;
  const totalFrames = Math.ceil(duration * fps);

  console.log(
    `Will capture ${totalFrames} frames over ${duration.toFixed(2)} seconds`
  );

  // Prepare an array to store our frames as blobs
  const frameBlobs: Blob[] = [];

  // Capture each frame individually
  for (let i = 0; i < totalFrames; i++) {
    const frameTime = startTime + i / fps;

    // Set the video to this specific time
    extractionVideo.currentTime = frameTime;

    // Wait for the video to seek to this time
    await new Promise<void>((resolve) => {
      const seekHandler = () => {
        extractionVideo.removeEventListener('seeked', seekHandler);
        resolve();
      };

      extractionVideo.addEventListener('seeked', seekHandler);

      // Safety timeout in case the event doesn't fire
      setTimeout(resolve, 1000);
    });

    // Clear the canvas and draw the current frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    try {
      // CRITICAL FIX: Force opacity to ensure frames aren't black
      ctx.globalAlpha = 0.99;
      ctx.drawImage(extractionVideo, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1.0;

      // Get this frame as a blob
      const frameBlob = await new Promise<Blob>((resolve) => {
        canvas.toBlob(
          (blob) => {
            resolve(blob!);
          },
          'image/jpeg',
          0.9
        );
      });

      frameBlobs.push(frameBlob);

      if (i % 5 === 0) {
        console.log(
          `Captured iOS frame ${i + 1}/${totalFrames} at time ${frameTime.toFixed(2)}s`
        );
      }
    } catch (e) {
      console.error(`Error capturing frame ${i}:`, e);
    }
  }

  console.log(`Finished capturing ${frameBlobs.length} frames`);

  // Create a new video from these frames using a separate canvas and stream
  const recordingCanvas = document.createElement('canvas');
  recordingCanvas.width = canvas.width;
  recordingCanvas.height = canvas.height;
  const recordingCtx = recordingCanvas.getContext('2d');

  if (!recordingCtx) {
    throw new Error('Could not get recording canvas context');
  }

  // Set up a stream and recorder
  // @ts-ignore
  const stream = recordingCanvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2000000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // Start recording
  recorder.start(200);

  // Now play back all our captured frames at the right rate
  let frameIndex = 0;
  const frameInterval = 1000 / 30; // 30fps playback

  const playNextFrame = () => {
    if (frameIndex >= frameBlobs.length) {
      // All frames played, stop recording
      recorder.stop();
      return;
    }

    // Create an image from the blob
    const img = new Image();
    const url = URL.createObjectURL(frameBlobs[frameIndex]);

    img.onload = () => {
      // Clear and draw the image
      recordingCtx.clearRect(
        0,
        0,
        recordingCanvas.width,
        recordingCanvas.height
      );
      recordingCtx.drawImage(
        img,
        0,
        0,
        recordingCanvas.width,
        recordingCanvas.height
      );

      // Release the URL
      URL.revokeObjectURL(url);

      // Schedule next frame
      frameIndex++;
      setTimeout(playNextFrame, frameInterval);
    };

    img.src = url;
  };

  // Start playing frames
  playNextFrame();

  // Clean up the extraction video
  setTimeout(() => {
    try {
      document.body.removeChild(extractionVideo);
    } catch (e) {
      console.warn('Could not remove extraction video:', e);
    }
  }, 5000);

  // Return a promise that resolves when recording is done
  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      try {
        const finalBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created iOS video from frames: ${finalBlob.size} bytes`);

        if (finalBlob.size < 5000) {
          reject(
            new Error('Generated video is too small, capture likely failed')
          );
        } else {
          resolve(finalBlob);
        }
      } catch (e) {
        reject(e);
      }
    };

    // Safety timeout
    setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, 30000);
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
