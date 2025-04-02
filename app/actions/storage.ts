'use server';

import { Storage } from '@google-cloud/storage';
import { revalidatePath } from 'next/cache';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export interface SignedUrlRequest {
  filename: string;
  contentType: string;
  metadata?: Record<string, any>;
}

export interface SignedUrlResponse {
  url: string;
  publicUrl: string;
}

export interface ProcessedVideoStatusRequest {
  bucketName?: string;
  fileName: string;
  processedFolder?: string;
}

export interface ProcessedVideoStatusResponse {
  exists: boolean;
  publicUrl?: string;
  fileName?: string;
  error?: string;
}

interface DiagnosticCheckParams {
  bucketName?: string;
  fileName: string;
  processedFolder?: string;
}

interface FileAttemptResult {
  filePath: string;
  exists?: boolean;
  error?: string;
  metadataError?: string;
}

interface DiagnosticResult {
  requestInfo: {
    bucketName: string;
    fileName: string;
    processedFolder: string;
  };
  serviceAccount: {
    email?: string;
    projectId?: string;
  };
  fileDetails: Record<string, any>;
  fileAttempts: FileAttemptResult[];
  errors: string[];
  folderContents?: {
    name: string;
    size?: string | number;
  }[];
}

/**
 * Generate a signed URL for direct upload to Google Cloud Storage (simplified)
 */
export async function generateSignedUrl({
  filename,
  contentType,
  metadata = {},
}: SignedUrlRequest): Promise<SignedUrlResponse> {
  if (!filename || !contentType) {
    throw new Error('Filename and content type are required');
  }

  // Get bucket name from environment variables
  const bucketName =
    process.env.STORAGE_BUCKET_NAME ||
    process.env.POSE_ESTIMATION_ANALYSIS_BUCKET;
  if (!bucketName) {
    throw new Error('Storage bucket name not configured');
  }

  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      throw new Error('Google Cloud service account key not configured');
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      throw new Error('Invalid Google Cloud service account key format');
    }

    // Log inputs for debugging
    console.log('Generating signed URL for:', {
      bucket: bucketName,
      file: filename,
      contentType,
    });

    // Initialize Google Cloud Storage with credentials
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filename);

    // Generate a simple signed URL with minimal options
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
      // Very minimal headers
      extensionHeaders: {},
    });

    // Generate a public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filename}`;

    return { url: signedUrl, publicUrl };
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error(
      `Failed to generate signed URL: ${(error as Error).message}`
    );
  }
}

/**
 * Checks if a processed video is available in the specified bucket
 */
export async function checkProcessedVideoStatus({
  bucketName,
  fileName,
  processedFolder = 'processed_video/user',
}: ProcessedVideoStatusRequest): Promise<ProcessedVideoStatusResponse> {
  if (!fileName) {
    return { exists: false, error: 'File name is required' };
  }

  // Get bucket name from params or environment variables
  const storageBucket =
    bucketName ||
    process.env.STORAGE_BUCKET_NAME ||
    process.env.POSE_ESTIMATION_ANALYSIS_BUCKET;
  if (!storageBucket) {
    return { exists: false, error: 'Storage bucket name not configured' };
  }

  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      return {
        exists: false,
        error: 'Google Cloud service account key not configured',
      };
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      return {
        exists: false,
        error: 'Invalid Google Cloud service account key format',
      };
    }

    // Extract just the filename without the path
    const fileNameOnly = fileName.includes('/')
      ? fileName.split('/').pop()
      : fileName;
    if (!fileNameOnly) {
      return { exists: false, error: 'Invalid file name' };
    }

    // Create the processed file path consistently
    const processedFileName = `${processedFolder}/${fileNameOnly}`;

    // Log inputs for debugging
    console.log('Checking processed video status for:', {
      bucket: storageBucket,
      file: processedFileName,
    });

    // Initialize Google Cloud Storage with credentials
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    // Check if the processed file exists
    const bucket = storage.bucket(storageBucket);
    const file = bucket.file(processedFileName);
    const [exists] = await file.exists();
    console.log(`File ${processedFileName} exists: ${exists}`);

    if (!exists) {
      // File doesn't exist yet
      return { exists: false };
    }

    // Generate a temporary public URL for the file
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    // Revalidate the analysis page to ensure fresh data
    revalidatePath('/analysis-results');

    return {
      exists: true,
      publicUrl: url,
      fileName: processedFileName,
    };
  } catch (error) {
    console.error('Error checking processed video:', error);
    return {
      exists: false,
      error: `Failed to check processed video status: ${(error as Error).message}`,
    };
  }
}

// Add this diagnostic test function to your component
export async function testGoogleCloudStorage() {
  try {
    // 1. Create a small test file
    const testBlob = new Blob(['Test content: ' + new Date().toISOString()], {
      type: 'text/plain',
    });

    // 2. Get a signed URL
    const { url } = await generateSignedUrl({
      filename: 'test/diagnostic-' + Date.now() + '.txt',
      contentType: 'text/plain',
      metadata: { test: 'true' },
    });

    console.log('Signed URL generated:', url);

    // 3. Try the simplest possible upload
    const uploadResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: testBlob,
    });

    // 4. Log detailed response
    console.log(
      'Upload status:',
      uploadResponse.status,
      uploadResponse.statusText
    );
    const responseText = await uploadResponse
      .text()
      .catch((e) => 'Could not read response: ' + e);
    console.log('Response body:', responseText);

    return {
      success: uploadResponse.ok,
      status: uploadResponse.status,
      response: responseText,
    };
  } catch (error) {
    console.error('Test failed:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Diagnostic function to check storage permissions and file existence
 */
export async function diagnosticStorageCheck({
  bucketName,
  fileName,
  processedFolder = 'processed_video/user',
}: DiagnosticCheckParams): Promise<DiagnosticResult> {
  if (!fileName) {
    return {
      requestInfo: { bucketName: '', fileName: '', processedFolder: '' },
      serviceAccount: {},
      fileDetails: {},
      fileAttempts: [],
      errors: ['File name is required'],
    };
  }

  // Get bucket name from params or environment variables
  const storageBucket =
    bucketName ||
    process.env.STORAGE_BUCKET_NAME ||
    process.env.POSE_ESTIMATION_ANALYSIS_BUCKET;
  if (!storageBucket) {
    return {
      requestInfo: { bucketName: '', fileName, processedFolder },
      serviceAccount: {},
      fileDetails: {},
      fileAttempts: [],
      errors: ['Storage bucket name not configured'],
    };
  }

  const diagnosticResults: DiagnosticResult = {
    requestInfo: {
      bucketName: storageBucket,
      fileName,
      processedFolder,
    },
    serviceAccount: {},
    fileDetails: {},
    fileAttempts: [],
    errors: [],
  };

  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      diagnosticResults.errors.push(
        'Google Cloud service account key not configured'
      );
      return diagnosticResults;
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
      diagnosticResults.serviceAccount = {
        email: credentials.client_email,
        projectId: credentials.project_id,
      };
    } catch (e) {
      diagnosticResults.errors.push(
        'Invalid Google Cloud service account key format'
      );
      return diagnosticResults;
    }

    // Initialize Google Cloud Storage with credentials
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    // Attempt multiple file path formats
    const fileNameOnly = fileName.includes('/')
      ? fileName.split('/').pop()
      : fileName;
    const possibleFilePaths = [
      `${processedFolder}/${fileNameOnly}`,
      `${processedFolder}/${fileName}`,
      fileNameOnly,
      fileName,
    ].filter(Boolean) as string[];

    const bucket = storage.bucket(storageBucket);

    // Check each possible file path
    for (const filePath of possibleFilePaths) {
      try {
        const file = bucket.file(filePath);
        const [exists] = await file.exists();

        diagnosticResults.fileAttempts.push({
          filePath,
          exists,
        });

        if (exists) {
          // Try to get metadata for the file
          try {
            const [metadata] = await file.getMetadata();
            diagnosticResults.fileDetails = {
              filePath,
              metadata: {
                size: metadata.size,
                contentType: metadata.contentType,
                timeCreated: metadata.timeCreated,
                updated: metadata.updated,
              },
            };

            // Try to generate a signed URL
            try {
              const [url] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 60 * 60 * 1000, // 1 hour
              });

              diagnosticResults.fileDetails.signedUrl = url;
            } catch (urlError) {
              diagnosticResults.fileDetails.signedUrlError = (
                urlError as Error
              ).message;
            }
          } catch (metaError) {
            diagnosticResults.fileAttempts[
              diagnosticResults.fileAttempts.length - 1
            ].metadataError = (metaError as Error).message;
          }
        }
      } catch (pathError) {
        diagnosticResults.fileAttempts.push({
          filePath,
          error: (pathError as Error).message,
        });
      }
    }

    // List files in the folder to see what's actually there
    try {
      const [files] = await bucket.getFiles({
        prefix: processedFolder,
      });

      diagnosticResults.folderContents = files.map((file) => ({
        name: file.name,
        size: file.metadata?.size,
      }));
    } catch (listError) {
      diagnosticResults.errors.push(
        `Failed to list folder contents: ${(listError as Error).message}`
      );
    }

    return diagnosticResults;
  } catch (error) {
    diagnosticResults.errors.push(`General error: ${(error as Error).message}`);
    return diagnosticResults;
  }
}

/**
 * Uploads a video directly to unprocessed_video/user folder in GCS
 *
 * @param videoBuffer - The video file buffer to upload
 * @param options - Optional upload configutation
 * @return - Upload information
 */
export async function uploadVideoToGCS(
  base64Data: string,
  options: {
    fileName?: string;
    contentType?: string;
    metadata?: Record<string, any>;
  } = {}
): Promise<{
  success: boolean;
  fileName: string;
  publicUrl: string;
  error?: string;
}> {
  // Default options
  const contentType = options.contentType || 'video/mp4';
  const metadata = options.metadata || {};

  // Fixed compression settings - no user control
  const crf = 32; // Low quality (second lowest)
  const preset = 'veryfast'; // For faster processing
  const width = 640; // Lower resolution

  // Generate a unique filename if not provided
  let fileName = options.fileName;
  if (!fileName) {
    const timestamp = Date.now();
    const extension = contentType.includes('mp4') ? 'mp4' : 'webm';
    fileName = `video-${timestamp}.${extension}`;
  }

  // Full path including folder
  const folder = 'unprocessed_video/user';
  const fullPath = `${folder}/${fileName}`;

  // Get bucket name form environment variables
  const bucketName = process.env.STORAGE_BUCKET_NAME;
  if (!bucketName) {
    return {
      success: false,
      fileName: fullPath,
      publicUrl: '',
      error: 'Storage bucket name not configured',
    };
  }

  try {
    // Get service account credentials form environment variables
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      return {
        success: false,
        fileName: fullPath,
        publicUrl: '',
        error: 'Google Cloud service account key not configured',
      };
    }

    // Parse service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      return {
        success: false,
        fileName: fullPath,
        publicUrl: '',
        error: 'Invalid Google Cloud service account key format',
      };
    }

    // Convert base64 to Buffer
    // Remove the data URL prefix if present (e.g., "data:video/mp4;base64,")
    const base64WithoutPrefix = base64Data.split(',')[1] || base64Data;
    let videoBuffer = Buffer.from(base64WithoutPrefix, 'base64');

    // Compress video if requested
    try {
      videoBuffer = await compressVideo(videoBuffer, {
        crf,
        preset,
        width,
        fps: 30,
        outputFormat: fileName.endsWith('.mp4') ? 'mp4' : 'webm',
      });

      // Update metadata to indicate compression
      metadata.compressed = 'true';
      metadata.compressionCrf = crf.toString();
      metadata.compressionPreset = preset;
      metadata.compressionWidth = width.toString();
      metadata.compressionFps = '30';
    } catch (compressError) {
      console.error('Error compressing video:', compressError);
      // Continue with original video if compression fails
      metadata.compressionFailed = 'true';
      metadata.compressionError = (compressError as Error).message;
    }

    // Initialise GCS
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fullPath);

    // Upload the file
    await file.save(videoBuffer, {
      metadata: {
        contentType,
        metadata,
      },
    });

    // Generate public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${fullPath}`;

    return {
      success: true,
      fileName: fullPath,
      publicUrl,
    };
  } catch (error) {
    console.error('Error uploading video:', error);
    return {
      success: false,
      fileName: fullPath,
      publicUrl: '',
      error: (error as Error).message,
    };
  }
}

/**
 * Compresses a video using FFmpeg
 *
 * @param videoBuffer - The video buffer to compress
 * @param options - Compression options
 * @returns - Compressed video buffer
 */
async function compressVideo(
  videoBuffer: Buffer,
  options: {
    crf: number;
    preset: string;
    width: number;
    fps: number;
    outputFormat: 'mp4' | 'webm';
  }
): Promise<Buffer> {
  // Create a new FFmpeg instance
  const ffmpeg = new FFmpeg();

  // Load FFmpeg core
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  try {
    // Create input and output file names
    const inputFileName = 'input.' + options.outputFormat;
    const outputFileName = 'output.' + options.outputFormat;

    // Convert Buffer to Uint8Array that FFmpeg can accept
    const uint8Array = new Uint8Array(
      videoBuffer.buffer,
      videoBuffer.byteOffset,
      videoBuffer.byteLength
    );

    // Write the input file to FFmpeg's virtual file system
    await ffmpeg.writeFile(inputFileName, uint8Array);

    // Determine codec based on format
    const videoCodec =
      options.outputFormat === 'mp4' ? 'libx264' : 'libvpx-vp9';

    // Build FFmpeg command with 30fps
    let args = [
      '-i',
      inputFileName,
      '-c:v',
      videoCodec,
      '-crf',
      options.crf.toString(),
      '-preset',
      options.preset,
      '-vf',
      `scale=${options.width}:-2,fps=${options.fps}`, // Scale and set framerate
      '-c:a',
      options.outputFormat === 'mp4' ? 'aac' : 'libopus',
      '-b:a',
      '128k', // Audio bitrate
      '-movflags',
      'faststart', // Optimize for web playback
      outputFileName,
    ];

    // Run the FFmpeg command
    await ffmpeg.exec(args);

    // Read the output file
    const data = await ffmpeg.readFile(outputFileName);

    // Convert Uint8Array to Buffer
    if (data instanceof Uint8Array) {
      return Buffer.from(data);
    } else {
      throw new Error('Unexpected data type returned from FFmpeg');
    }
  } finally {
    // Clean up FFmpeg instance
    await ffmpeg.terminate();
  }
}
