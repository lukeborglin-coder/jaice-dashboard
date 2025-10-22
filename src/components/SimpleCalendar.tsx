import React, { useState } from 'react';

interface SimpleCalendarProps {
  selectedDate?: string;
  onDateSelect: (date: string) => void;
  tasksWithDates?: Array<{ id: string; description: string; dueDate: string }>;
  onTaskClick?: (task: { id: string; description: string; dueDate: string }) => void;
}

const SimpleCalendar: React.FC<SimpleCalendarProps> = ({
  selectedDate,
  onDateSelect,
  tasksWithDates = [],
  onTaskClick
}) => {
  const today = new Date();
  const [currentWeek, setCurrentWeek] = useState(0);

  // Get the start of the current week (Monday)
  const getWeekStart = (weekOffset: number = 0) => {
    const date = new Date(today);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    date.setDate(diff + (weekOffset * 7));
    return date;
  };

  // Get all days in the current week (weekdays only)
  const getWeekDays = (weekOffset: number = 0) => {
    const weekStart = getWeekStart(weekOffset);
    const days = [];
    
    // Only include weekdays (Monday to Friday)
    for (let i = 0; i < 5; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      days.push(day);
    }
    
    return days;
  };

  const weekDays = getWeekDays(currentWeek);
  const weekStart = getWeekStart(currentWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4); // Friday (4 days after Monday)

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isSelected = (date: Date) => {
    if (!selectedDate) return false;
    return formatDate(date) === selectedDate;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isCurrentWeek = (date: Date) => {
    const today = new Date();
    const currentWeekStart = getWeekStart(0);
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
    
    return date >= currentWeekStart && date <= currentWeekEnd;
  };

  // Weekend logic removed since we only show weekdays

  const getTasksForDate = (date: Date) => {
    const dateStr = formatDate(date);
    return tasksWithDates.filter(task => task.dueDate === dateStr);
  };

  const hasTasksOnDate = (date: Date) => {
    return getTasksForDate(date).length > 0;
  };

  const handleDateClick = (date: Date) => {
    onDateSelect(formatDate(date));
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    setCurrentWeek(prev => direction === 'prev' ? prev - 1 : prev + 1);
  };

  const goToCurrentWeek = () => {
    setCurrentWeek(0);
  };

  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigateWeek('prev');
          }}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <div className="text-center">
          <div className="text-sm font-medium">
            {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
          <div className="text-xs text-gray-500">
            {weekStart.getFullYear()}
          </div>
        </div>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigateWeek('next');
          }}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-5 gap-1 mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
          <div key={day} className="text-center text-2xs font-medium text-gray-500 py-0.5">
            {day}
          </div>
        ))}
      </div>

      {/* Week Days */}
      <div className="grid grid-cols-5 gap-1">
        {weekDays.map((day, index) => {
          const isSelectedDate = isSelected(day);
          const isTodayDate = isToday(day);
          const isCurrentWeekDay = isCurrentWeek(day);
          const hasTasks = hasTasksOnDate(day);
          const tasksForDay = getTasksForDate(day);
          
          return (
            <div key={index} className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDateClick(day);
                }}
                className={`
                  p-1 text-2xs rounded-lg transition-colors w-full relative
                  ${isSelectedDate
                    ? 'bg-orange-500 text-white'
                    : isTodayDate
                    ? 'bg-orange-200 text-orange-800 border border-orange-400 font-bold'
                    : isCurrentWeekDay
                    ? 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                    : 'text-gray-700 hover:bg-gray-100'
                  }
                `}
              >
                {day.getDate()}
              </button>
            </div>
          );
        })}
      </div>

      {/* Current Week Button */}
      {currentWeek !== 0 && (
        <div className="mt-3 text-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              goToCurrentWeek();
            }}
            className="text-xs text-orange-600 hover:text-orange-700 underline"
          >
            Go to current week
          </button>
        </div>
      )}
    </div>
  );
};

export default SimpleCalendar;
