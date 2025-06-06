'use server';

import { Storage } from '@google-cloud/storage';
import { revalidatePath } from 'next/cache';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

interface LandmarksRequest {
  fileName: string;
}

interface SwingAnalysisResult {
  prediction: string;
  confidence: number;
  feedback: string[];
  error?: string;
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
    maxSizeMB?: number;
    targetResolution?: string;
    maxVideoDuration?: number;
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
  const maxSizeMB = options.maxSizeMB || 5; // Default max size 10MB
  const targetResolution = options.targetResolution || '640x360'; // Default 720p
  const maxVideoDuration = options.maxVideoDuration || 8;

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
    const videoBuffer = Buffer.from(base64WithoutPrefix, 'base64');

    // Create a temporary input file
    const tempInputPath = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
    const tempOutputPath = path.join(
      os.tmpdir(),
      `compressed-${Date.now()}.mp4`
    );

    // Write input buffer to temp file
    fs.writeFileSync(tempInputPath, new Uint8Array(videoBuffer));

    // Compress video using FFmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempInputPath)
        .videoCodec('libx264')
        .size(targetResolution)
        .outputOptions([
          '-crf 23', // Constant Rate Factor for compression (lower is better quality)
          '-preset medium', // Compression preset
          '-movflags',
          '+faststart', // Optimize for web streaming
          '-an', // Remove audio
        ])
        .toFormat('mp4')
        .on('start', (commandLine) => {
          console.log('Spawned FFmpeg with command: ' + commandLine);
        })
        .on('progress', (progress) => {
          console.log('Processing: ' + progress.percent + '% done');
        })
        .on('end', () => {
          console.log('Compression finished');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error during compression:', err);
          reject(err);
        })
        .save(tempOutputPath);
    });

    // Check file size
    const stats = fs.statSync(tempOutputPath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > maxSizeMB) {
      // If still too large, throw an error
      fs.unlinkSync(tempInputPath);
      fs.unlinkSync(tempOutputPath);
      throw new Error(`Compressed video still exceeds ${maxSizeMB}MB limit`);
    }

    // Read compressed video buffer
    const compressedVideoBuffer = fs.readFileSync(tempOutputPath);

    // Initialise GCS
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fullPath);

    // Upload the file
    await file.save(compressedVideoBuffer, {
      metadata: {
        contentType: 'video/mp4',
        metadata: {
          ...metadata,
          originalSize: videoBuffer.length,
          compressedSize: compressedVideoBuffer.length,
        },
      },
    });

    // Clean up temporary files
    fs.unlinkSync(tempInputPath);
    fs.unlinkSync(tempOutputPath);

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
 * Fetches landmarks JSON file from storage and analyzes the golf swing
 */
export async function analyseGolfSwingLandmarks({
  fileName,
}: LandmarksRequest): Promise<SwingAnalysisResult> {
  if (!fileName) {
    return {
      prediction: 'error',
      confidence: 0,
      feedback: ['File name is required'],
      error: 'File name is required',
    };
  }

  const bucketName = process.env.STORAGE_BUCKET_NAME;
  if (!bucketName) {
    return {
      prediction: 'error',
      confidence: 0,
      feedback: ['Storage bucket name not configured'],
      error: 'Storage bucket name not configured',
    };
  }

  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      return {
        prediction: 'error',
        confidence: 0,
        feedback: ['Google Cloud service account key not configured'],
        error: 'Google Cloud service account key not configured',
      };
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      return {
        prediction: 'error',
        confidence: 0,
        feedback: ['Invalid Google Cloud service account key format'],
        error: 'Invalid Google Cloud service account key format',
      };
    }

    // Initialize Google Cloud Storage with credentials
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    console.log('Fetching landmarks file:', fileName);

    // Get the file from storage
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);

    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      return {
        prediction: 'error',
        confidence: 0,
        feedback: [`Landmarks file not found: ${fileName}`],
        error: `Landmarks file not found: ${fileName}`,
      };
    }

    console.log('Landmarks data fetched, sending to inference service');

    // Send to Cloud Run for inference
    const cloudRunUrl = process.env.GOLF_INFERENCE_URL;
    if (!cloudRunUrl) {
      return {
        prediction: 'error',
        confidence: 0,
        feedback: ['Golf inference service URL not configured'],
        error: 'Golf inference service URL not configured',
      };
    }

    // Call inference service
    const response = await fetch(cloudRunUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gcs_path: `gs://${bucketName}/${fileName}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        prediction: 'error',
        confidence: 0,
        feedback: [
          `Inference service error: ${response.status} ${response.statusText}`,
        ],
        error: `Inference service error: ${errorText}`,
      };
    }

    // Parse the inference results
    const analysisResult = await response.json();
    // Revalidate the results page to ensure fresh data
    revalidatePath('/analyse/results');
    return analysisResult;
  } catch (error) {
    console.error('Error analyzing golf swing:', error);
    return {
      prediction: 'error',
      confidence: 0,
      feedback: [`Failed to analyze golf swing: ${(error as Error).message}`],
      error: `Failed to analyze golf swing: ${(error as Error).message}`,
    };
  }
}

/**
 * Gets all processed videos belonging to a specific user
 *
 * @param userId - The user ID to search for in filenames
 * @param options - Optional configuration parameters
 * @returns Array of video files with public URLs and metadata
 */
export async function getUserVideos(
  userId: string,
  options: {
    bucketName?: string;
    processedFolder?: string;
  } = {}
): Promise<{
  success: boolean;
  files: Array<{
    fileName: string;
    publicUrl: string;
    timestamp?: number;
    metadata?: Record<string, any>;
  }>;
  error?: string;
}> {
  if (!userId) {
    return {
      success: false,
      files: [],
      error: 'User ID is required',
    };
  }

  // Get bucket name from params or environment variables
  const bucketName =
    options.bucketName ||
    process.env.STORAGE_BUCKET_NAME ||
    process.env.POSE_ESTIMATION_ANALYSIS_BUCKET;

  if (!bucketName) {
    return {
      success: false,
      files: [],
      error: 'Storage bucket name not configured',
    };
  }

  // Set default processed folder path
  const processedFolder = options.processedFolder || 'processed_video/user';

  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      return {
        success: false,
        files: [],
        error: 'Google Cloud service account key not configured',
      };
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      return {
        success: false,
        files: [],
        error: 'Invalid Google Cloud service account key format',
      };
    }

    // Initialize Google Cloud Storage with credentials
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    // Get the bucket and list files in the processed folder
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles({
      prefix: processedFolder,
    });

    // Filter files that contain the user ID
    const userFiles: Array<import('@google-cloud/storage').File> = files.filter(
      (file: import('@google-cloud/storage').File) => file.name.includes(userId)
    );

    // Generate metadata and signed URLs for each file
    const fileDetails = await Promise.all(
      userFiles.map(async (file) => {
        // Extract timestamp from filename if present
        const timestampMatch = file.name.match(/(\d{13})_processed/);
        const timestamp = timestampMatch
          ? parseInt(timestampMatch[1])
          : undefined;

        // Get metadata
        let metadata = {};
        try {
          const [metaData] = await file.getMetadata();
          metadata = {
            size: metaData.size,
            contentType: metaData.contentType,
            timeCreated: metaData.timeCreated,
            updated: metaData.updated,
          };
        } catch (error) {
          console.warn(`Failed to get metadata for ${file.name}:`, error);
        }

        // Generate signed URL for access
        const [url] = await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        });

        return {
          fileName: file.name,
          publicUrl: url,
          timestamp,
          metadata,
        };
      })
    );

    // Sort files by timestamp (newest first) if timestamp is available
    fileDetails.sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return b.timestamp - a.timestamp;
      }
      return 0;
    });

    return {
      success: true,
      files: fileDetails,
    };
  } catch (error) {
    console.error('Error getting user videos:', error);
    return {
      success: false,
      files: [],
      error: `Failed to get user videos: ${(error as Error).message}`,
    };
  }
}

/**
 * Fetches existing analysis results from Google Cloud Storage
 * @param {Object} params - Parameters for the function
 * @param {string} params.fileName - The file name to check
 * @returns {Promise<SwingAnalysisResult>} The analysis results or an error
 */
export async function fetchExistingAnalysisResults({
  fileName,
}: {
  fileName: string;
}): Promise<SwingAnalysisResult> {
  'use server';

  if (!fileName) {
    return {
      prediction: 'error',
      confidence: 0,
      feedback: ['File name is required'],
      error: 'File name is required',
    };
  }

  const bucketName = process.env.STORAGE_BUCKET_NAME;
  if (!bucketName) {
    return {
      prediction: 'error',
      confidence: 0,
      feedback: ['Storage bucket name not configured'],
      error: 'Storage bucket name not configured',
    };
  }

  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      return {
        prediction: 'error',
        confidence: 0,
        feedback: ['Google Cloud service account key not configured'],
        error: 'Google Cloud service account key not configured',
      };
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      return {
        prediction: 'error',
        confidence: 0,
        feedback: ['Invalid Google Cloud service account key format'],
        error: 'Invalid Google Cloud service account key format',
      };
    }

    // Initialize Google Cloud Storage with credentials
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    console.log(`Fetching existing analysis for: ${fileName}`);

    // Extract the base filename without path and extension
    let baseFileName;

    // Handle full paths or just filenames
    if (fileName.includes('/')) {
      // Extract just the filename part
      baseFileName = fileName.split('/').pop();
    } else {
      baseFileName = fileName;
    }

    // Remove extensions and _processed suffix if present
    if (baseFileName) {
      baseFileName = baseFileName
        .replace('_processed.mp4', '')
        .replace('.mp4', '');
    } else {
      throw new Error('Base file name is undefined');
    }

    console.log(`Base filename extracted: ${baseFileName}`);

    // Construct the path to the inference results JSON
    const inferenceResultsPath = `inference_results/${baseFileName}_inference_results.json`;
    console.log(`Looking for inference results at: ${inferenceResultsPath}`);

    // Get the file from the bucket
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(inferenceResultsPath);

    // Check if file exists
    const [exists] = await file.exists();
    if (exists) {
      // Download and parse the file
      const [fileContents] = await file.download();
      const results = JSON.parse(fileContents.toString('utf-8'));

      console.log(`Successfully fetched analysis results for ${baseFileName}`);

      // Revalidate the results page
      revalidatePath('/analyse/results');

      return {
        prediction: results.prediction || 'unknown',
        confidence: results.confidence || 0,
        feedback: results.feedback || [],
        error: undefined,
      };
    }

    // Try the alternative filename format as a fallback
    try {
      console.log('Attempting fallback filename pattern...');

      // Extract just the ID part of the filename for fallback
      let idPart;
      if (baseFileName.includes('trim-')) {
        idPart = baseFileName.match(/trim-([^-]+)/)?.[0];

        if (idPart) {
          console.log(`Extracted ID part: ${idPart}`);

          // Try the alternative path format
          const altInferenceResultsPath = `inference_results/${idPart}_inference_results.json`;
          console.log(
            `Looking at alternative path: ${altInferenceResultsPath}`
          );

          const altFile = bucket.file(altInferenceResultsPath);
          const [altExists] = await altFile.exists();

          if (altExists) {
            const [fileContents] = await altFile.download();
            const results = JSON.parse(fileContents.toString('utf-8'));

            console.log(
              `Successfully fetched analysis results from alternative path`
            );

            // Revalidate the results page
            revalidatePath('/analyse/results');

            return {
              prediction: results.prediction || 'unknown',
              confidence: results.confidence || 0,
              feedback: results.feedback || [],
              error: undefined,
            };
          }
        }
      }

      // Try with the full base name without any manipulation
      // This is useful for handling complex filenames with multiple parts
      const fullBaseNamePath = `inference_results/${baseFileName}_inference_results.json`;

      if (fullBaseNamePath !== inferenceResultsPath) {
        console.log(`Trying with full base name: ${fullBaseNamePath}`);

        const fullBaseFile = bucket.file(fullBaseNamePath);
        const [fullBaseExists] = await fullBaseFile.exists();

        if (fullBaseExists) {
          const [fileContents] = await fullBaseFile.download();
          const results = JSON.parse(fileContents.toString('utf-8'));

          console.log(
            `Successfully fetched analysis results with full base name`
          );

          // Revalidate the results page
          revalidatePath('/analyse/results');

          return {
            prediction: results.prediction || 'unknown',
            confidence: results.confidence || 0,
            feedback: results.feedback || [],
            error: undefined,
          };
        }
      }

      // Final attempt: try to extract just the UUID portion if it exists
      const uuidMatch = baseFileName.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
      );
      if (uuidMatch) {
        const uuidPath = `inference_results/${uuidMatch[0]}_inference_results.json`;
        console.log(`Trying with extracted UUID: ${uuidPath}`);

        const uuidFile = bucket.file(uuidPath);
        const [uuidExists] = await uuidFile.exists();

        if (uuidExists) {
          const [fileContents] = await uuidFile.download();
          const results = JSON.parse(fileContents.toString('utf-8'));

          console.log(`Successfully fetched analysis results with UUID`);

          // Revalidate the results page
          revalidatePath('/analyse/results');

          return {
            prediction: results.prediction || 'unknown',
            confidence: results.confidence || 0,
            feedback: results.feedback || [],
            error: undefined,
          };
        }
      }

      throw new Error(
        `Analysis results not found for any attempted patterns with: ${baseFileName}`
      );
    } catch (fallbackError) {
      console.error(
        `All fallback attempts failed: ${(fallbackError as Error).message}`
      );
      return {
        prediction: 'error',
        confidence: 0,
        feedback: [`Analysis results not found for: ${baseFileName}`],
        error: `Analysis results not found: ${inferenceResultsPath}`,
      };
    }
  } catch (error) {
    console.error('Error fetching existing analysis results:', error);

    return {
      prediction: 'error',
      confidence: 0,
      feedback: [
        `Failed to fetch analysis results: ${(error as Error).message}`,
      ],
      error: `Failed to fetch analysis results: ${(error as Error).message}`,
    };
  }
}

/**
 * Fetches all inference results for a specific user
 *
 * @param userId - The user ID to search for in filenames
 * @param options - Optional configuration parameters
 * @returns Array of inference results sorted by date (newest first)
 */
export async function getUserInferenceResults(
  userId: string,
  options: {
    bucketName?: string;
    inferenceFolder?: string;
  } = {}
): Promise<{
  success: boolean;
  data: Array<any>; // Using any to preserve original data structure
  error?: string;
}> {
  if (!userId) {
    return {
      success: false,
      data: [],
      error: 'User ID is required',
    };
  }

  // Get bucket name from params or environment variables
  const bucketName =
    options.bucketName ||
    process.env.STORAGE_BUCKET_NAME ||
    process.env.POSE_ESTIMATION_ANALYSIS_BUCKET;

  if (!bucketName) {
    return {
      success: false,
      data: [],
      error: 'Storage bucket name not configured',
    };
  }

  // Set default inference results folder path
  const inferenceFolder = options.inferenceFolder || 'inference_results';

  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      return {
        success: false,
        data: [],
        error: 'Google Cloud service account key not configured',
      };
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      return {
        success: false,
        data: [],
        error: 'Invalid Google Cloud service account key format',
      };
    }

    // Initialize Google Cloud Storage with credentials
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });

    // Get the bucket and list files in the inference results folder
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles({
      prefix: inferenceFolder,
    });

    console.log(`Found ${files.length} files in ${inferenceFolder} folder`);

    // Filter files that contain the user ID
    const userFiles: Array<import('@google-cloud/storage').File> = files.filter(
      (file: import('@google-cloud/storage').File) => file.name.includes(userId)
    );

    console.log(`Found ${userFiles.length} files matching user ID: ${userId}`);

    // Download and parse each file
    const resultsData = await Promise.all(
      userFiles.map(async (file) => {
        try {
          // Download the file contents
          const [fileContents] = await file.download();
          const results = JSON.parse(fileContents.toString('utf-8'));

          // Extract timestamp from filename for sorting purposes
          // Format: trim-146f59fa-c2e9-4321-ae86-cea2a0750db0-1745509896463_inference_results.json
          const timestampMatch = file.name.match(
            /(\d{13})_inference_results\.json$/
          );
          const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : 0;

          // Add filename as metadata (without modifying original data)
          return {
            ...results,
            _metadata: {
              fileName: file.name,
              fileTimestamp: timestamp,
            },
          };
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
          return null;
        }
      })
    );

    // Filter out any failed results and sort by date (newest first)
    // Use timestamp from the data if available, otherwise use the filename timestamp
    const validResults = resultsData
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((a, b) => {
        // Try to use timestamp from the data if available
        const dateA = a.timestamp
          ? new Date(a.timestamp).getTime()
          : a._metadata.fileTimestamp;
        const dateB = b.timestamp
          ? new Date(b.timestamp).getTime()
          : b._metadata.fileTimestamp;
        return dateB - dateA;
      });

    // Remove the _metadata property before returning the results
    const cleanResults = validResults.map((result) => {
      const { _metadata, ...cleanResult } = result;
      return cleanResult;
    });

    return {
      success: true,
      data: cleanResults,
    };
  } catch (error) {
    console.error('Error getting user inference results:', error);
    return {
      success: false,
      data: [],
      error: `Failed to get user inference results: ${(error as Error).message}`,
    };
  }
}
