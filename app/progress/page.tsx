'use client';

import { useEffect, useState } from 'react';
import { PlayerProgressChart } from '@/components/player-progress-chart';
import { CurrentScoreCard, ImprovementCard } from '@/components/stat-chart';
import { getUserInferenceResults } from '@/app/actions/storage';
import { createClient } from '@/utils/supabase/client';

// Define interfaces for the data types
interface SwingData {
  prediction: 'good' | 'bad' | 'unlabeled';
  confidence: number;
  score: number;
  feedback: string[];
  timestamp: string;
  date: string;
}

// Loading component
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 rounded-lg gap-2">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      <h3 className="text-xl font-semibold text-gray-700 mb-2">
        Loading your swing data...
      </h3>
      <p className="text-gray-500 text-center">
        Please wait while we retrieve your progress information.
      </p>
    </div>
  );
}

// Error component
function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 rounded-lg">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-16 w-16 text-red-500 mb-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <h3 className="text-xl font-semibold text-gray-700 mb-2">
        Error Loading Data
      </h3>
      <p className="text-gray-500 text-center">{message}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}

// Fallback component when there's no data
function NoDataFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 rounded-lg">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-16 w-16 text-gray-400 mb-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <h3 className="text-xl font-semibold text-gray-700 mb-2">
        No Swing Data Yet
      </h3>
      <p className="text-gray-500 text-center">
        Record your first swing to start tracking your progress!
      </p>
      <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
        Record Your First Swing
      </button>
    </div>
  );
}

// Fallback for when there's only one data point
interface SingleDataPointFallbackProps {
  data: SwingData;
}

function SingleDataPointFallback({ data }: SingleDataPointFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 rounded-lg">
      <div className="mb-6 text-center">
        <h3 className="text-xl font-semibold text-gray-700 mb-2">
          Initial Assessment Complete
        </h3>
        <p className="text-gray-500">
          You've recorded your first swing! Record more swings to see your
          progress over time.
        </p>
      </div>

      <div className="w-full max-w-md p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">
            {new Date(data.date).toLocaleDateString()}
          </span>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              data.prediction === 'good'
                ? 'bg-green-100 text-green-800'
                : data.prediction === 'bad'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-800'
            }`}
          >
            {data.prediction.charAt(0).toUpperCase() + data.prediction.slice(1)}
          </span>
        </div>

        <div className="flex items-center mb-4">
          <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mr-4">
            <span className="text-2xl font-bold text-blue-600">
              {data.score}
            </span>
          </div>
          <div>
            <h4 className="font-medium">Initial Score</h4>
            <p className="text-sm text-gray-500">
              Confidence: {data.confidence.toFixed(1)}/10
            </p>
          </div>
        </div>

        {data.feedback && data.feedback.length > 0 && (
          <div className="mt-2">
            <h5 className="text-sm font-medium mb-1">Feedback:</h5>
            <ul className="text-sm text-gray-600 pl-4">
              {data.feedback.map((item, index) => (
                <li key={index} className="mb-1">
                  • {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <button className="mt-6 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
        Record Another Swing
      </button>
    </div>
  );
}
export default function ProgressPage() {
  // State for storing swing data, loading state, and error
  const [swingData, setSwingData] = useState<SwingData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Check authentication on component mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();

        if (error) {
          console.error('Auth error:', error.message);
          setError('Authentication error: ' + error.message);
          setIsLoading(false);
          return;
        }

        if (!data.user) {
          console.log('No user found');
          setError('No authenticated user found');
          setIsLoading(false);
          return;
        }

        // User is authenticated, we can proceed
        console.log('User authenticated:', data.user.id);
        setUserId(data.user.id);
      } catch (err) {
        console.error('Error checking authentication:', err);
        setError('Failed to check authentication');
        setIsLoading(false);
      } finally {
        setAuthChecked(true);
      }
    };

    checkAuth();
  }, []);

  // Fetch data once we have a userId
  useEffect(() => {
    // Skip if authentication hasn't completed yet or if there's no userId
    if (!authChecked) return;

    if (!userId) {
      // If auth check is done but no userId, we've already set the error in the auth effect
      return;
    }

    // Function to fetch data
    async function fetchSwingData() {
      try {
        console.log('Fetching data for user:', userId);

        const result = await getUserInferenceResults(userId!);

        if (result.success) {
          console.log(
            'Data fetched successfully:',
            result.data.length,
            'records'
          );
          setSwingData(result.data as SwingData[]);
        } else {
          console.error('Failed to load data:', result.error);
          setError(result.error || 'Failed to load swing data');
        }
      } catch (err) {
        console.error('Error fetching swing data:', err);
        setError('An unexpected error occurred while fetching your data');
      } finally {
        setIsLoading(false);
      }
    }

    fetchSwingData();
  }, [userId, authChecked]);

  // Show loading state
  if (isLoading) {
    return (
      <main className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
        <h1 className="text-2xl font-bold mb-4 text-center">Swing Progress</h1>
        <div className="flex-1 min-h-0">
          <LoadingState />
        </div>
      </main>
    );
  }

  // Show error state
  if (error) {
    return (
      <main className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
        <h1 className="text-2xl font-bold mb-4 text-center">Swing Progress</h1>
        <div className="flex-1 min-h-0">
          <ErrorState message={error} />
        </div>
      </main>
    );
  }

  // First, handle the case where there's no data at all
  if (!swingData || swingData.length === 0) {
    return (
      <main className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
        <h1 className="text-2xl font-bold mb-4 text-center">Swing Progress</h1>
        <div className="flex-1 min-h-0">
          <NoDataFallback />
        </div>
      </main>
    );
  }

  // Sort data by date to ensure we get the correct latest and previous scores
  const sortedData = [...swingData].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const currentScore = sortedData[0]?.score || 0;
  const previousScore = sortedData.length > 1 ? sortedData[1]?.score : null;

  // Handle the case where there's only one data point
  if (sortedData.length === 1) {
    return (
      <main className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
        <h1 className="text-2xl font-bold mb-4 text-center">Swing Progress</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <CurrentScoreCard score={currentScore} />
          {/* Use a modified card for the improvement when there's no previous score */}
          <div className="p-4 rounded-lg shadow-sm">
            <h3 className="text-lg font-medium mb-2">First Assessment</h3>
            <p className="text-gray-600">
              Record another swing to track your improvement!
            </p>
          </div>
        </div>
        <div className="flex-1 min-h-0 mb-2">
          <SingleDataPointFallback data={sortedData[0]} />
        </div>
      </main>
    );
  }

  // Default case: multiple data points available
  return (
    <main className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      <h1 className="text-2xl font-bold mb-4 text-center">Swing Progress</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <CurrentScoreCard score={currentScore} />
        <ImprovementCard
          currentScore={currentScore}
          previousScore={previousScore}
        />
      </div>

      {/* Maximize the chart height with flex-1 and min-h-0 */}
      <div className="flex-1 min-h-0 mb-2">
        <PlayerProgressChart data={swingData} />
      </div>
    </main>
  );
}
