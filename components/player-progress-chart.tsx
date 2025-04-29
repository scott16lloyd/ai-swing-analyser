'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// Updated interface with new prediction types
interface SwingData {
  prediction: 'good' | 'bad' | 'unlabeled';
  confidence: number;
  score: number;
  feedback: string[];
  timestamp: string;
  date?: string; // Keep date as optional for backward compatibility
}

// Define the props interface for the component
interface PlayerProgressChartProps {
  data: SwingData[];
}

function PlayerProgressChart({ data }: PlayerProgressChartProps) {
  // Fallback for no data
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 rounded-lg shadow">
        <p className="text-gray-500">No swing data available to display.</p>
      </div>
    );
  }

  // Fallback for only one data point - we can't draw a line with just one point
  if (data.length === 1) {
    const point = data[0];
    // Use timestamp if available, otherwise fall back to date
    const dateString = point.timestamp || point.date || '';
    const date = new Date(dateString);
    const formattedDate = !isNaN(date.getTime())
      ? date.toLocaleDateString()
      : 'Unknown Date';

    return (
      <div className="flex flex-col h-full w-full rounded-lg shadow p-4">
        <h3 className="text-lg font-medium mb-2">Initial Score</h3>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="h-24 w-24 rounded-full bg-blue-100 flex items-center justify-center mb-4">
              <span className="text-3xl font-bold text-blue-600">
                {point.score}
              </span>
            </div>
            <p className="text-gray-700">
              {formattedDate} •{' '}
              {point.prediction.charAt(0).toUpperCase() +
                point.prediction.slice(1)}
            </p>
          </div>
        </div>
        <p className="text-sm text-gray-500 text-center mt-4">
          Add more swings to see your progress chart!
        </p>
      </div>
    );
  }

  // Sort data by timestamp (ascending) for the chart
  const sortedData = [...data].sort((a, b) => {
    // Use timestamp if available, otherwise fall back to date
    const dateA = a.timestamp || a.date || '';
    const dateB = b.timestamp || b.date || '';

    // Make sure we have valid dates to compare
    const timeA = dateA ? new Date(dateA).getTime() : 0;
    const timeB = dateB ? new Date(dateB).getTime() : 0;

    // If both dates are invalid, keep original order
    if (isNaN(timeA) && isNaN(timeB)) return 0;
    // If only A is invalid, B comes first
    if (isNaN(timeA)) return 1;
    // If only B is invalid, A comes first
    if (isNaN(timeB)) return -1;
    // Both dates are valid, compare them
    return timeA - timeB;
  });

  // Transform data for the chart and add formatted dates
  const chartData = sortedData.map((item) => {
    let dateString = '';
    // Prioritize timestamp property
    if (typeof item.timestamp === 'string' && item.timestamp) {
      dateString = item.timestamp;
    }
    // Fall back to date property if timestamp is not available
    else if (typeof item.date === 'string' && item.date) {
      dateString = item.date;
    }

    let formattedDate = 'Unknown Date';
    try {
      if (dateString) {
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
          // Create a more readable format for the date
          formattedDate = new Date(dateString).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
        }
      }
    } catch (error) {
      console.error('Error parsing date:', dateString, error);
    }

    return {
      ...item,
      formattedDate: formattedDate,
    };
  });

  // Updated prediction colors with new types
  const predictionColors = {
    good: '#10b981', // emerald-500 (green)
    bad: '#ef4444', // red-500
    unlabeled: '#9ca3af', // gray-400
  };

  return (
    <div className="h-full w-full rounded-lg shadow p-4">
      <h3 className="text-lg font-medium mb-1">Score Progress</h3>
      <p className="text-sm text-gray-500 mb-4">
        Track how your swing score changes over time
      </p>

      <div className="h-[calc(100%-60px)] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -30, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="formattedDate"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={70}
            />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937', // dark gray/black background
                color: 'white', // white text
                borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
                border: 'none', // remove default border
              }}
              itemStyle={{
                color: 'white', // ensure item text is white
              }}
              labelStyle={{
                color: 'white', // ensure label text is white
                fontWeight: 'bold',
                marginBottom: '5px',
              }}
              formatter={(value, name) => {
                // Only return a value for score, filtering out prediction completely
                if (name === 'score') return [`${value}`, 'Score'];
                // For any other potential dataKey, use default behavior
                if (name !== 'prediction') return [value, name];
                // Return false explicitly for prediction to hide it
                return false;
              }}
              labelFormatter={(_, payload) => {
                // Use the formattedDate from the payload if available
                if (payload && payload.length > 0 && payload[0].payload) {
                  return `Date: ${payload[0].payload.formattedDate}`;
                }
                return 'Unknown Date';
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2 }}
              activeDot={{ r: 6, strokeWidth: 2 }}
              name="Score"
              isAnimationActive={true}
            />
            {/* Color-coded dots for prediction types with hide=true to prevent tooltip */}
            <Line
              type="monotone"
              dataKey="score"
              stroke="transparent"
              name="prediction"
              isAnimationActive={false}
              hide={true} // Hide this line from the tooltip and legend
              dot={(props) => {
                const { cx, cy, payload, index } = props;
                const prediction = (payload as SwingData).prediction;
                const color = predictionColors[prediction] || '#9ca3af';
                return (
                  <svg
                    key={`dot-${index}`}
                    x={cx - 6}
                    y={cy - 6}
                    width={12}
                    height={12}
                    fill={color}
                  >
                    <circle cx="6" cy="6" r="6" />
                  </svg>
                );
              }}
            />
            <Legend
              payload={[{ value: 'Score', type: 'line', color: '#3b82f6' }]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export { PlayerProgressChart };
