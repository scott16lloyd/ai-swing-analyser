// Define interfaces for component props
interface CurrentScoreCardProps {
  score: number | null | undefined;
}

interface ImprovementCardProps {
  currentScore: number | null | undefined;
  previousScore: number | null | undefined;
}

function CurrentScoreCard({ score }: CurrentScoreCardProps) {
  // Fallback for no score
  if (score === undefined || score === null) {
    return (
      <div className="p-4 rounded-lg shadow-sm">
        <h3 className="text-lg font-medium mb-2">Current Score</h3>
        <div className="flex items-center">
          <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mr-4">
            <span className="text-xl text-gray-400">N/A</span>
          </div>
          <div>
            <p className="text-gray-500">No score available</p>
            <p className="text-sm text-gray-400">
              Record your first swing to see your score
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Determine the score color and rating based on the score value
  let scoreColor: string, scoreRating: string;

  if (score >= 90) {
    scoreColor = 'bg-green-100 text-green-800';
    scoreRating = 'Excellent';
  } else if (score >= 70) {
    scoreColor = 'bg-blue-100 text-blue-800';
    scoreRating = 'Good';
  } else if (score >= 50) {
    scoreColor = 'bg-yellow-100 text-yellow-800';
    scoreRating = 'Average';
  } else {
    scoreColor = 'bg-red-100 text-red-800';
    scoreRating = 'Needs Improvement';
  }

  return (
    <div className="p-4 rounded-lg shadow-sm">
      <h3 className="text-lg font-medium mb-2">Current Score</h3>
      <div className="flex items-center">
        <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mr-4">
          <span className="text-2xl font-bold text-blue-600">{score}</span>
        </div>
        <div>
          <div
            className={`inline-block px-2 py-1 rounded-full text-xs ${scoreColor} mb-1`}
          >
            {scoreRating}
          </div>
          <p className="text-sm text-gray-500">Your latest swing assessment</p>
        </div>
      </div>
    </div>
  );
}

const ImprovementCard: React.FC<ImprovementCardProps> = ({
  currentScore,
  previousScore,
}) => {
  // Fallback for no scores
  if (currentScore === undefined || currentScore === null) {
    return (
      <div className="p-4 rounded-lg shadow-sm">
        <h3 className="text-lg font-medium mb-2">Improvement</h3>
        <p className="text-gray-500">
          No scores available to calculate improvement
        </p>
      </div>
    );
  }

  // Fallback for only one score (no previous score to compare)
  if (previousScore === undefined || previousScore === null) {
    return (
      <div className="p-4 rounded-lg shadow-sm">
        <h3 className="text-lg font-medium mb-2">Improvement</h3>
        <div className="flex items-center">
          <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mr-4">
            <span className="text-xl text-gray-500">–</span>
          </div>
          <div>
            <p className="text-gray-600">First Assessment</p>
            <p className="text-sm text-gray-500">
              Record another swing to track improvement
            </p>
          </div>
        </div>
      </div>
    );
  }

  const improvement = currentScore - previousScore;
  const isImproved = improvement > 0;
  const isDecreased = improvement < 0;
  const noChange = improvement === 0;

  let statusColor: string, statusText: string, iconPath: string;

  if (isImproved) {
    statusColor = 'text-green-600';
    statusText = 'Improved';
    iconPath = 'M7 11l5-5m0 0l5 5m-5-5v12'; // Up arrow
  } else if (isDecreased) {
    statusColor = 'text-red-600';
    statusText = 'Decreased';
    iconPath = 'M7 13l5 5m0 0l5-5m-5 5V6'; // Down arrow
  } else {
    statusColor = 'text-yellow-600';
    statusText = 'No Change';
    iconPath = 'M5 12h14'; // Horizontal line
  }

  return (
    <div className="p-4 rounded-lg shadow-sm">
      <h3 className="text-lg font-medium mb-2">Improvement</h3>
      <div className="flex items-center">
        <div
          className={`h-16 w-16 rounded-full ${isImproved ? 'bg-green-100' : isDecreased ? 'bg-red-100' : 'bg-yellow-100'} flex items-center justify-center mr-4`}
        >
          <div className="flex items-center">
            <span className={`text-xl font-bold ${statusColor}`}>
              {isImproved ? '+' : ''}
              {improvement}
            </span>
          </div>
        </div>
        <div>
          <div className="flex items-center">
            <span className={`font-medium ${statusColor}`}>{statusText}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 ml-1 ${statusColor}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={iconPath}
              />
            </svg>
          </div>
          <p className="text-sm text-gray-500">
            {isImproved
              ? 'Great progress since your last swing!'
              : isDecreased
                ? 'Focus on improving your technique'
                : 'Maintaining consistency'}
          </p>
        </div>
      </div>
    </div>
  );
};

export { CurrentScoreCard, ImprovementCard };
