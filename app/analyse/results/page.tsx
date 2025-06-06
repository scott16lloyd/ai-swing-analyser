'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  checkProcessedVideoStatus,
  analyseGolfSwingLandmarks,
  fetchExistingAnalysisResults, // New import for the function we added
} from '@/app/actions/storage';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { Activity, X, Check, GraduationCap, ArrowLeft } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

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
  score?: number; // Keep as optional for type safety
  timestamp?: string; // Keep as optional for type safety
}

function AnalysisResults(): React.ReactElement {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [videoLoading, setVideoLoading] = useState<boolean>(true);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(true);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
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
  const [fromHistory, setFromHistory] = useState<boolean>(false);
  const router = useRouter();
  const [swingAnalysisResults, setSwingAnalysisResults] =
    useState<SwingAnalysisResult | null>(null);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [resultsReady, setResultsReady] = useState(false);
  const [videoDisplayError, setVideoDisplayError] = useState<string | null>(
    null
  );

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

  // Check authentication on component mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          debugLog('Not authenticated, redirecting to sign-in');
          router.push('/sign-in');
          return;
        }

        debugLog('User authenticated, proceeding with component');
        // User is authenticated, we can proceed
        setAuthChecking(false);
      } catch (error) {
        console.error('Error checking authentication:', error);
        router.push('/sign-in');
      }
    };

    checkAuth();
  }, [router, debugLog]);

  // Load video and determine if from history
  useEffect(() => {
    // Immediately check if we're coming from history page
    const fromHistoryFlag = sessionStorage.getItem('fromHistory');
    const isFromHistory = fromHistoryFlag === 'true';
    debugLog(`Is video from history? ${isFromHistory}`);
    setFromHistory(isFromHistory);

    // Get the trim info from sessionStorage
    const trimInfoString = sessionStorage.getItem('trimInfo');
    debugLog(`Retrieved trimInfo: ${trimInfoString ? 'yes' : 'no'}`);

    if (!trimInfoString) {
      setError('No video information found. Please upload a video first.');
      setIsLoading(false);
      setVideoLoading(false);
      setAnalysisLoading(false);
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
      setVideoLoading(false);
      setAnalysisLoading(false);
      return;
    }

    const { fileName } = trimInfo;
    if (!fileName) {
      setError('No filename found. Please try uploading your video again.');
      setIsLoading(false);
      setVideoLoading(false);
      setAnalysisLoading(false);
      return;
    }

    // Extract the base name and extension for constructing the processed filename
    const fileNameOnly = fileName.includes('/')
      ? fileName.split('/').pop() || ''
      : fileName;

    const fileNameParts = fileNameOnly.split('.');
    const extension = fileNameParts.pop() || 'mp4';
    const baseName = fileNameParts.join('.');

    debugLog(`Original filename: ${fileName}`);
    debugLog(`Base name: ${baseName}`);
    debugLog(`Is from history: ${isFromHistory}`);

    // For videos from history, use the basename as is since they're already processed
    let processedFileName: string;

    // If the filename already contains '_processed', don't add it again
    if (baseName.endsWith('_processed') || isFromHistory) {
      processedFileName = `${baseName}.${extension}`;
      debugLog('Using already processed filename or from history');
    } else {
      processedFileName = `${baseName}_processed.${extension}`;
      debugLog('Adding _processed suffix to filename');
    }

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
          debugLog(`Video URL: ${result.publicUrl}`);
          if (pollInterval) clearInterval(pollInterval);
          setProcessedVideo(result);
          setVideoLoading(false);

          // Construct the landmarks filename
          // For landmarks, we want to use baseName without _processed
          const cleanBaseName = baseName.endsWith('_processed')
            ? baseName.slice(0, -10) // Remove '_processed'
            : baseName;

          // THIS IS THE MODIFIED PART:
          // If coming from history, fetch the existing analysis results
          // Otherwise, run the analysis
          setIsAnalysing(true);
          try {
            if (isFromHistory) {
              // Fetch existing analysis results instead of reanalyzing
              debugLog(
                `Fetching existing analysis results for: ${result.fileName}`
              );

              const analysisResult = await fetchExistingAnalysisResults({
                fileName: result.fileName || fileName,
              });

              debugLog(
                `Existing analysis result: ${JSON.stringify(analysisResult)}`
              );

              if (analysisResult.error) {
                debugLog(
                  `Error fetching existing analysis: ${analysisResult.error}`
                );
                setAnalysisLoading(false);
                setError(`Analysis error: ${analysisResult.error}`);
              } else {
                setSwingAnalysisResults(analysisResult);
                setAnalysisLoading(false);
              }
            } else {
              // Run new analysis for freshly recorded swings
              const landmarksFileName = `landmarks/user/${cleanBaseName}_landmarks.json`;
              debugLog(`Looking for landmarks file: ${landmarksFileName}`);

              const analysisResult = await analyseGolfSwingLandmarks({
                fileName: landmarksFileName,
              });

              debugLog(`Analysis result: ${JSON.stringify(analysisResult)}`);

              if (analysisResult.error) {
                debugLog(`Analysis error: ${analysisResult.error}`);
                setAnalysisLoading(false);
                setError(`Analysis error: ${analysisResult.error}`);
              } else {
                setSwingAnalysisResults(analysisResult);
                setAnalysisLoading(false);
              }
            }
          } catch (analysisError) {
            if (analysisError instanceof Error) {
              debugLog(`Error during analysis: ${analysisError.message}`);
              setError(`Analysis error: ${(analysisError as Error).message}`);
            } else {
              debugLog('Error during analysis: An unknown error occurred.');
              setError('An unknown error occurred during analysis.');
            }
            setAnalysisLoading(false);
          } finally {
            setIsAnalysing(false);
          }
        } else if (result.error) {
          debugLog(`Error in poll: ${result.error}`);
          // Continue polling if we haven't reached max polls
          if (pollCount >= maxPolls) {
            if (pollInterval) clearInterval(pollInterval);
            setError(`Processing timed out: ${result.error}`);
            setIsLoading(false);
            setVideoLoading(false);
            setAnalysisLoading(false);
          }
        } else if (pollCount >= maxPolls) {
          // We've reached our timeout
          debugLog('Max polls reached without finding the video');
          if (pollInterval) clearInterval(pollInterval);
          setError(
            'Processing is taking longer than expected. Please try again later.'
          );
          setIsLoading(false);
          setVideoLoading(false);
          setAnalysisLoading(false);
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
          setVideoLoading(false);
          setAnalysisLoading(false);
        }
      }
    };

    // Check for the processed video
    const checkForProcessedVideo = async (
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
    };

    // Initial check immediately
    debugLog('Performing initial check');
    checkForProcessedVideo(fileName, processedFileName)
      .then((result) => {
        if (result.exists) {
          debugLog('Video already processed!');
          debugLog(`Video URL: ${result.publicUrl}`);
          setProcessedVideo(result);
          setVideoLoading(false);

          // MODIFIED: Use different approaches based on fromHistory flag
          setIsAnalysing(true);

          if (isFromHistory) {
            // For videos from history, fetch the existing analysis
            debugLog(
              `Fetching existing analysis for: ${result.fileName || fileName}`
            );

            fetchExistingAnalysisResults({
              fileName: result.fileName || fileName,
            })
              .then((analysisResult) => {
                if (analysisResult.error) {
                  debugLog(`Error fetching analysis: ${analysisResult.error}`);
                  setError(`Analysis error: ${analysisResult.error}`);
                } else {
                  debugLog('Successfully fetched existing analysis');
                  debugLog(
                    `Analysis result full object: ${JSON.stringify(analysisResult)}`
                  );

                  // Using a type assertion to work with the result more easily
                  const result = analysisResult as any;

                  // Check if score exists
                  if (result.score === undefined) {
                    debugLog('Score property missing, adding fallback score');
                    // Add score based on prediction and confidence
                    if (result.prediction === 'good') {
                      result.score = Math.round(70 + result.confidence * 30);
                    } else {
                      result.score = Math.round(30 + result.confidence * 40);
                    }
                    debugLog(`Added missing score: ${result.score}`);
                  } else {
                    debugLog(`Existing score found: ${result.score}`);
                  }

                  // Now set the state with the result
                  setSwingAnalysisResults(result);
                }
                setAnalysisLoading(false);
                setIsAnalysing(false);
              })
              .catch((err) => {
                debugLog(`Error fetching analysis: ${(err as Error).message}`);
                setError(`Analysis error: ${(err as Error).message}`);
                setAnalysisLoading(false);
                setIsAnalysing(false);
              });
          } else {
            // For fresh recordings, analyze the landmarks
            const cleanBaseName = result.fileName
              ? result.fileName.endsWith('_processed.mp4')
                ? result.fileName.slice(0, -14)
                : result.fileName.slice(0, -4)
              : baseName.endsWith('_processed')
                ? baseName.slice(0, -10)
                : baseName;

            const landmarksFileName = `landmarks/user/${cleanBaseName}_landmarks.json`;
            debugLog(`Looking for landmarks file: ${landmarksFileName}`);

            analyseGolfSwingLandmarks({
              fileName: landmarksFileName,
            })
              .then((analysisResult) => {
                if (analysisResult.error) {
                  debugLog(`Analysis error: ${analysisResult.error}`);
                  setError(`Analysis error: ${analysisResult.error}`);
                } else {
                  debugLog('Analysis successful');

                  // Using a type assertion to work with the result more easily
                  const result = analysisResult as any;

                  // Check if score exists
                  if (result.score === undefined) {
                    debugLog('Score property missing, adding fallback score');
                    // Add score based on prediction and confidence
                    if (result.prediction === 'good') {
                      result.score = Math.round(70 + result.confidence * 30);
                    } else {
                      result.score = Math.round(30 + result.confidence * 40);
                    }
                    debugLog(`Added missing score: ${result.score}`);
                  } else {
                    debugLog(`Existing score found: ${result.score}`);
                  }

                  setSwingAnalysisResults(result);
                }
                setAnalysisLoading(false);
                setIsAnalysing(false);
              })
              .catch((err) => {
                debugLog(`Analysis error: ${(err as Error).message}`);
                setError(`Analysis error: ${(err as Error).message}`);
                setAnalysisLoading(false);
                setIsAnalysing(false);
              });
          }
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
  }, [debugLog]);

  // Effect to check if both video and analysis are ready
  useEffect(() => {
    if (!videoLoading && !analysisLoading && !isAnalysing) {
      debugLog('Both video and analysis completed loading');
      setIsLoading(false);

      if (processedVideo && processedVideo.publicUrl && swingAnalysisResults) {
        debugLog('All data is present, setting results ready');
        setResultsReady(true);
      } else {
        debugLog('Some data is missing:');
        debugLog(`- processedVideo: ${processedVideo ? 'yes' : 'no'}`);
        debugLog(`- publicUrl: ${processedVideo?.publicUrl ? 'yes' : 'no'}`);
        debugLog(
          `- swingAnalysisResults: ${swingAnalysisResults ? 'yes' : 'no'}`
        );

        if (!processedVideo || !processedVideo.publicUrl) {
          setVideoDisplayError('Video could not be loaded.');
        }
      }
    }
  }, [
    videoLoading,
    analysisLoading,
    isAnalysing,
    processedVideo,
    swingAnalysisResults,
    debugLog,
  ]);

  const handleBackToCapture = useCallback((): void => {
    debugLog('Navigating back to capture');
    router.push('/analyse');
  }, [router, debugLog]);

  const handleBackToHistory = useCallback((): void => {
    debugLog('Navigating back to history');
    // Clean up session storage
    sessionStorage.removeItem('fromHistory');
    sessionStorage.removeItem('trimInfo');
    router.push('/history');
  }, [router, debugLog]);

  // Handle video load error
  const handleVideoError = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      debugLog(
        `Video load error: ${(e.target as HTMLVideoElement).error?.message || 'Unknown error'}`
      );
      setVideoDisplayError(
        `Error loading video: ${(e.target as HTMLVideoElement).error?.message || 'Unknown error'}`
      );
    },
    [debugLog]
  );

  // Handle successful video load
  const handleVideoLoad = useCallback(() => {
    debugLog('Video loaded successfully');
    setVideoDisplayError(null);
  }, [debugLog]);

  return (
    <div className="fixed inset-0 flex flex-col bg-black bg-opacity-95 text-white overflow-y-auto">
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
              <Button
                variant="ghost"
                onClick={
                  fromHistory ? handleBackToHistory : handleBackToCapture
                }
              >
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
            <Button
              onClick={fromHistory ? handleBackToHistory : handleBackToCapture}
            >
              {fromHistory ? 'Back to History' : 'Back to Capture'}
            </Button>
          </div>
        )}

        {!isLoading && !error && processedVideo && processedVideo.publicUrl && (
          <div className="text-center">
            {/* Show back to history button if coming from history */}
            {fromHistory && (
              <Button
                variant="ghost"
                onClick={handleBackToHistory}
                className="absolute top-4 left-4 text-sm flex items-center"
              >
                <ArrowLeft className="mr-1" size={16} />
              </Button>
            )}

            <div className="bg-green-950 border border-green-400 text-green-300 px-4 py-3 rounded mb-4 max-w-md">
              <p>Your swing analysis is ready!</p>
            </div>

            <div className="my-6">
              {videoDisplayError ? (
                <div className="bg-red-950 border border-red-400 text-red-300 px-4 py-3 rounded mb-4 max-w-md">
                  <p>{videoDisplayError}</p>
                  <p className="mt-2 text-sm">
                    URL: {processedVideo.publicUrl}
                  </p>
                </div>
              ) : (
                <video
                  src={processedVideo.publicUrl}
                  controls
                  className="w-full max-w-md rounded-lg shadow-lg"
                  autoPlay
                  playsInline
                  loop
                  onError={handleVideoError}
                  onLoadedData={handleVideoLoad}
                />
              )}
            </div>

            {/* Swing analysis results */}
            {swingAnalysisResults ? (
              <div className="mt-4 text-left bg-gray-900 p-4 rounded-lg max-w-md mx-auto">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-xl font-bold">Swing Analysis</h3>

                  <div
                    className={`px-3 py-1 rounded-full flex items-center ${swingAnalysisResults.prediction === 'good' ? 'bg-green-900 text-green-200' : 'bg-amber-900 text-amber-200'}`}
                  >
                    <span className="mr-2">
                      {swingAnalysisResults.prediction === 'good'
                        ? 'Good Swing'
                        : 'Needs Work'}
                    </span>

                    {/* Always show score circle with enhanced visibility */}
                    <div className="flex items-center justify-center w-8 h-8 bg-white bg-opacity-20 rounded-full text-sm font-bold border border-white border-opacity-30">
                      {(() => {
                        // Using an IIFE to contain the logic and avoid TypeScript errors
                        if (!swingAnalysisResults) return '-';

                        // Using type assertion to bypass TypeScript error
                        const score = (swingAnalysisResults as any).score;

                        if (score === undefined || score === null) return '-';

                        return typeof score === 'number'
                          ? score
                          : Number(score) || Number(score) === 0
                            ? Number(score)
                            : '-';
                      })()}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                  {swingAnalysisResults.feedback.map((item, index) => (
                    <p
                      key={index}
                      className={`${item.includes('DRILL SUGGESTIONS') ? 'font-bold mt-4' : ''}`}
                    >
                      {/* Analysis header and DRILL SUGGESTIONS header have no icon */}
                      {item.includes("Here's a detailed analysis") ||
                      item.includes('DRILL SUGGESTIONS') ? (
                        item
                      ) : /* Drill suggestions get GraduationCap icon */
                      item.startsWith('Focus on') ||
                        item.startsWith('Initiate') ||
                        item.startsWith('Work on') ||
                        item.startsWith('Practice') ||
                        item.startsWith('Allow your') ? (
                        <>
                          <GraduationCap
                            className="inline-block mr-2"
                            size={16}
                            color="#3b82f6"
                          />
                          {item}
                        </>
                      ) : (
                        /* Swing issues get Check/X icons */
                        <>
                          {swingAnalysisResults.prediction === 'good' ? (
                            <Check
                              className="inline-block mr-2"
                              size={16}
                              color="#00ff11"
                            />
                          ) : (
                            <X
                              className="inline-block mr-2"
                              size={16}
                              color="#ff0000"
                            />
                          )}
                          {item}
                        </>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-yellow-900 border border-yellow-400 text-yellow-200 px-4 py-3 rounded mb-4 max-w-md">
                <p>Swing analysis is still processing. Please wait a moment.</p>
              </div>
            )}

            <div className="mt-6 flex gap-4 justify-center">
              {fromHistory ? (
                <div className="flex flex-row sm:flex-row gap-4">
                  <Button onClick={handleBackToHistory} className="text-md p-5">
                    Back to History
                  </Button>
                  <Button onClick={handleBackToCapture} className="text-md p-5">
                    Record New Swing
                  </Button>
                </div>
              ) : (
                <Button onClick={handleBackToCapture} className="text-md p-5">
                  Record Another Swing
                </Button>
              )}
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
