import { PlayerProgressChart } from '@/components/player-progress-chart';
import { CurrentScoreCard, ImprovementCard } from '@/components/stat-chart';

// Sample data for demonstration
const sampleSwingData = [
  {
    prediction: 'poor',
    confidence: 3.2,
    score: 45,
    feedback: [
      'Your swing needs improvement in several areas.',
      'Focus on your posture and follow-through.',
    ],
    date: '2023-09-01T00:00:00Z',
  },
  {
    prediction: 'average',
    confidence: 4.1,
    score: 65,
    feedback: [
      'Your swing is improving but still needs work.',
      'Good hip rotation, but watch your elbow position.',
    ],
    date: '2023-09-15T00:00:00Z',
  },
  {
    prediction: 'good',
    confidence: 5.72466756542319,
    score: 85,
    feedback: [
      'Good swing overall! Here are some observations:',
      'Key strengths in your swing:',
    ],
    date: '2023-10-01T00:00:00Z',
  },
  {
    prediction: 'excellent',
    confidence: 6.5,
    score: 95,
    feedback: [
      'Excellent form and technique!',
      'Your swing is very consistent and powerful.',
    ],
    date: '2023-10-15T00:00:00Z',
  },
  {
    prediction: 'good',
    confidence: 5.72466756542319,
    score: 100,
    feedback: [
      'Good swing overall! Here are some observations:',
      'Key strengths in your swing:',
    ],
    date: '2023-11-01T00:00:00Z',
  },
];

function ProgressPage() {
  // Sort data by date to ensure we get the correct latest and previous scores
  const sortedData = [...sampleSwingData].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const currentScore = sortedData[0]?.score || 0;
  const previousScore = sortedData[1]?.score || 0;

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
        <PlayerProgressChart data={sampleSwingData} />
      </div>
    </main>
  );
}

export default ProgressPage;
