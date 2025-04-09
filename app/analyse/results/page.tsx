'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  checkProcessedVideoStatus,
  analyseGolfSwingLandmarks,
} from '@/app/actions/storage';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';
import { escape } from 'querystring';

// Type definitions
interface ProcessedVideoResult {
  exists: boolean;
  error?: string;
  publicUrl?: string;
  fileName?: string;
}

interface TrimInfo {
  videoUrl: string;
  fileName: string;
  startTime: number;
  endTime: number;
  duration: number;
}

interface SwingAnalysisResult {
  prediction: string;
  confidence: number;
  feedback: string[];
  error?: string;
}

function AnalysisResults(): React.ReactElement {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [processedVideo, setProcessedVideo] =
    useState<ProcessedVideoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);
  const [processingStage, setProcessingStage] = useState<string>(
    'Starting analysis...'
  );
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebugger, setShowDebugger] = useState<boolean>(false);
  const [originalVideo, setOriginalVideo] = useState<string | null>(null);
  const router = useRouter();
  const [swingAnalysisResults, setSwingAnalysisResults] =
    useState<SwingAnalysisResult | null>(null);
  const [isAnalysing, setIsAnalysing] = useState(false);

  // Debug log function
  const debugLog = useCallback((message: string): void => {
    console.log(message);
    setDebugLogs((prev) =>
      [
        `${new Date().toISOString().split('T')[1].split('.')[0]} - ${message}`,
        ...prev,
      ].slice(0, 50)
    );
  }, []);

  // Update processing stage based on time elapsed
  useEffect(() => {
    if (secondsElapsed < 10) {
      setProcessingStage('Preparing for analysis...');
    } else if (secondsElapsed < 30) {
      setProcessingStage('Analysing swing mechanics...');
    } else if (secondsElapsed < 60) {
      setProcessingStage('Calculating measurements...');
    } else if (secondsElapsed < 90) {
      setProcessingStage('Generating visualisation...');
    } else {
      setProcessingStage('Finalising results...');
    }
  }, [secondsElapsed]);

  // Check for the processed video
  const checkForProcessedVideo = useCallback(
    async (
      originalFileName: string,
      processedFileName: string
    ): Promise<ProcessedVideoResult> => {
      try {
        debugLog(`Checking for processed video: ${processedFileName}`);

        // Construct the path that includes the directory structure from the original file
        // but replace the filename part with our processed filename
        let pathToCheck = originalFileName;
        if (originalFileName.includes('/')) {
          // Extract the path without filename
          const pathParts = originalFileName.split('/');
          pathParts.pop(); // Remove the filename
          pathToCheck = [...pathParts, processedFileName].join('/');
        } else {
          pathToCheck = processedFileName;
        }

        debugLog(`Full path to check: ${pathToCheck}`);

        const result = await checkProcessedVideoStatus({
          fileName: pathToCheck,
        });

        debugLog(`Check result: ${JSON.stringify(result)}`);
        return result;
      } catch (err) {
        const error = err as Error;
        debugLog(`Error in check: ${error.message}`);
        throw err;
      }
    },
    [debugLog]
  );

  useEffect(() => {
    // Get the trim info from sessionStorage
    const trimInfoString = sessionStorage.getItem('trimInfo');
    debugLog(`Retrieved trimInfo: ${trimInfoString ? 'yes' : 'no'}`);

    if (!trimInfoString) {
      setError('No video information found. Please upload a video first.');
      setIsLoading(false);
      return;
    }

    let trimInfo: TrimInfo;
    try {
      trimInfo = JSON.parse(trimInfoString) as TrimInfo;
      debugLog(`Parsed trimInfo: ${JSON.stringify(trimInfo)}`);
      setOriginalVideo(trimInfo.videoUrl);
    } catch (e) {
      setError('Invalid video information. Please try again.');
      setIsLoading(false);
      return;
    }

    const { fileName } = trimInfo;
    if (!fileName) {
      setError('No filename found. Please try uploading your video again.');
      setIsLoading(false);
      return;
    }

    // Extract the base name and extension for constructing the processed filename
    const fileNameOnly = fileName.includes('/')
      ? fileName.split('/').pop() || ''
      : fileName;

    const fileNameParts = fileNameOnly.split('.');
    const extension = fileNameParts.pop() || 'mp4';
    const baseName = fileNameParts.join('.');

    // The actual filename we'll be looking for (with _processed appended)
    const processedFileName = `${baseName}_processed.${extension}`;

    debugLog(`Original filename: ${fileName}`);
    debugLog(`Looking for processed file: ${processedFileName}`);

    let pollCount = 0;
    const maxPolls = 24; // 2 minutes at 5 second intervals
    let pollInterval: NodeJS.Timeout | undefined;

    // Function to run each poll
    const runPoll = async (): Promise<void> => {
      pollCount++;
      setSecondsElapsed(pollCount * 5);
      debugLog(`Poll ${pollCount}/${maxPolls}`);

      try {
        const result = await checkForProcessedVideo(
          fileName,
          processedFileName
        );

        if (result.exists) {
          // We found the processed video!
          debugLog('Processed video found!');
          if (pollInterval) clearInterval(pollInterval);
          setProcessedVideo(result);

          // Construct the landmarks filename
          const landmarksFileName = `landmarks/user/${baseName}_landmarks.json`;
          debugLog(`Looking for landmarks file: ${landmarksFileName}`);

          // Run analysis
          setIsAnalysing(true);
          try {
            const analysisResult = await analyseGolfSwingLandmarks({
              fileName: landmarksFileName,
            });

            debugLog(`Analysis result: ${JSON.stringify(analysisResult)}`);

            if (analysisResult.error) {
              debugLog(`Analysis error: ${analysisResult.error}`);
            } else {
              setSwingAnalysisResults(analysisResult);
            }
          } catch (analysisError) {
            if (analysisError instanceof Error) {
              debugLog(`Error during analysis: ${analysisError.message}`);
            } else {
              debugLog('Error during analysis: An unknown error occurred.');
            }
          } finally {
            setIsAnalysing(false);
            setIsLoading(false);
          }

          setIsLoading(false);
        } else if (result.error) {
          debugLog(`Error in poll: ${result.error}`);
          // Continue polling if we haven't reached max polls
          if (pollCount >= maxPolls) {
            if (pollInterval) clearInterval(pollInterval);
            setError(`Processing timed out: ${result.error}`);
            setIsLoading(false);
          }
        } else if (pollCount >= maxPolls) {
          // We've reached our timeout
          debugLog('Max polls reached without finding the video');
          if (pollInterval) clearInterval(pollInterval);
          setError(
            'Processing is taking longer than expected. Please try again later.'
          );
          setIsLoading(false);
        }
      } catch (err) {
        const error = err as Error;
        debugLog(`Exception in poll: ${error.message}`);
        // If there's a network error, we may want to continue polling
        // but if we hit max polls, we should stop
        if (pollCount >= maxPolls) {
          if (pollInterval) clearInterval(pollInterval);
          setError(`Error checking video status: ${error.message}`);
          setIsLoading(false);
        }
      }
    };

    // Initial check immediately
    debugLog('Performing initial check');
    checkForProcessedVideo(fileName, processedFileName)
      .then((result) => {
        if (result.exists) {
          debugLog('Video already processed!');
          setProcessedVideo(result);
          setIsLoading(false);
        } else {
          debugLog('Initial check - video not processed yet, starting polling');
          // Start polling if not found in initial check
          pollInterval = setInterval(runPoll, 5000);
        }
      })
      .catch((err) => {
        const error = err as Error;
        debugLog(`Error in initial check: ${error.message}`);
        // Start polling even if initial check fails
        pollInterval = setInterval(runPoll, 5000);
      });

    // Cleanup the interval on unmount
    return () => {
      if (pollInterval) {
        debugLog('Cleaning up poll interval');
        clearInterval(pollInterval);
      }
    };
  }, [checkForProcessedVideo, debugLog]);

  const handleBackToCapture = useCallback((): void => {
    debugLog('Navigating back to capture');
    router.push('/analyse');
  }, [router, debugLog]);

  return (
    <div className="fixed inset-0 flex flex-col bg-black overflow-hidden bg-opacity-95 text-white">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-bold mb-6 flex items-center">
          <Activity className="mr-2" />
          Swing Analysis
        </h1>

        {isLoading && (
          <div className="text-center">
            <div className="mb-6">
              <div className="w-16 h-16 border-t-2 border-blue-500 border-solid rounded-full animate-spin mx-auto"></div>
            </div>
            <p className="text-lg mb-1">{processingStage}</p>
            <p className="text-sm text-gray-400 mb-4">
              This may take up to 2 minutes. Time elapsed: {secondsElapsed}{' '}
              seconds
            </p>

            <div className="w-full bg-gray-700 rounded-full h-2.5 mt-4">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min((secondsElapsed / 120) * 100, 100)}%`,
                }}
              ></div>
            </div>

            <div className="mt-8">
              <Button variant="ghost" onClick={handleBackToCapture}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center">
            <div className="bg-red-950 border border-red-400 text-red-300 px-4 py-3 rounded mb-4 max-w-md">
              <p>{error}</p>
            </div>
            <Button onClick={handleBackToCapture}>Back to Capture</Button>
          </div>
        )}

        {processedVideo && processedVideo.publicUrl && (
          <div className="text-center">
            <div className="bg-green-950 border border-green-400 text-green-300 px-4 py-3 rounded mb-4 max-w-md">
              <p>Your swing analysis is ready!</p>
            </div>

            <div className="my-6">
              <video
                src={processedVideo.publicUrl}
                controls
                className="w-full max-w-md rounded-lg shadow-lg"
                autoPlay
                playsInline
                loop
              />
            </div>

            {/* Show loading state while analyzing */}
            {isAnalysing && (
              <div className="my-4">
                <div className="w-8 h-8 border-t-2 border-blue-500 border-solid rounded-full animate-spin mx-auto"></div>
                <p className="text-sm text-gray-400 mt-2">
                  Analyzing your swing...
                </p>
              </div>
            )}

            {/* Show swing analysis results */}
            {swingAnalysisResults && (
              <div className="mt-4 text-left bg-gray-900 p-4 rounded-lg max-w-md mx-auto">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-xl font-bold">Swing Analysis</h3>
                  <div
                    className={`px-3 py-1 rounded-full ${swingAnalysisResults.prediction === 'good' ? 'bg-green-900 text-green-200' : 'bg-amber-900 text-amber-200'}`}
                  >
                    {swingAnalysisResults.prediction === 'good'
                      ? 'Good Swing'
                      : 'Needs Work'}
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                  {swingAnalysisResults.feedback.map((item, index) => (
                    <p
                      key={index}
                      className={`${item.includes('DRILL SUGGESTIONS') ? 'font-bold mt-4' : ''}`}
                    >
                      {item}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-4 justify-center">
              <Button onClick={handleBackToCapture} className="text-md p-5">
                Record Another Swing
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Debug panel */}
      {showDebugger && (
        <div className="fixed bottom-20 left-0 right-0 max-h-48 overflow-y-auto bg-black/80 text-white text-xs p-2 z-50">
          <div className="mb-2 flex justify-between">
            <div>Debug Console</div>
            <button onClick={() => setShowDebugger(false)}>Close</button>
          </div>
          {debugLogs.map((log, i) => (
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
    </div>
  );
}

export default AnalysisResults;
