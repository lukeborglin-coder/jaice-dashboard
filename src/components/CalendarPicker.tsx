import React, { useState, useEffect } from 'react';

interface CalendarPickerProps {
  selectedDate?: string;
  onDateSelect: (date: string) => void;
  onClose: () => void;
  title?: string;
  minDate?: string;
  maxDate?: string;
}

const CalendarPicker: React.FC<CalendarPickerProps> = ({
  selectedDate,
  onDateSelect,
  onClose,
  title = "Select Date",
  minDate,
  maxDate
}) => {
  console.log('CalendarPicker rendered with props:', { selectedDate, title });
  console.log('CalendarPicker - onDateSelect:', typeof onDateSelect);
  console.log('CalendarPicker - onClose:', typeof onClose);
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const workDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  // Get work week days for current month (Monday to Friday only)
  const getWorkWeekDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const workDays = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = new Date(year, month, day);
      const dayOfWeek = currentDate.getDay();
      // Only include Monday (1) to Friday (5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        workDays.push(day);
      }
    }
    return workDays;
  };

  // Group work days into weeks
  const getWeekGroups = (workDays: number[]) => {
    const weeks = [];
    for (let i = 0; i < workDays.length; i += 5) {
      weeks.push(workDays.slice(i, i + 5));
    }
    return weeks;
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      currentMonth === today.getMonth() &&
      currentYear === today.getFullYear()
    );
  };

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return dateStr === selectedDate;
  };

  const isDateDisabled = (day: number) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    if (minDate && dateStr < minDate) return true;
    if (maxDate && dateStr > maxDate) return true;
    
    return false;
  };

  const handleDayClick = (day: number) => {
    if (isDateDisabled(day)) return;
    
    // Create date string without timezone conversion
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onDateSelect(dateStr);
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };

  const workDays = getWorkWeekDays(new Date(currentYear, currentMonth));
  const weekGroups = getWeekGroups(workDays);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100000]">
      <div className="bg-white rounded-lg p-6 w-96 max-w-[90vw] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          {/* Month/Year header with navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h4 className="text-base font-semibold text-gray-900">
              {monthNames[currentMonth]} {currentYear}
            </h4>
            <button
              onClick={() => navigateMonth('next')}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Work day names header */}
          <div className="grid grid-cols-5 gap-1 mb-2">
            {workDayNames.map(day => (
              <div key={day} className="h-8 flex items-center justify-center text-xs font-medium text-gray-500">
                {day}
              </div>
            ))}
          </div>

          {/* Work week calendar grid */}
          <div className="space-y-1">
            {weekGroups.map((week, weekIndex) => (
              <div key={weekIndex} className="grid grid-cols-5 gap-1">
                {week.map((day, dayIndex) => {
                  const isTodayDate = isToday(day);
                  const isSelectedDate = isSelected(day);
                  const isDisabled = isDateDisabled(day);
                  
                  return (
                    <div
                      key={dayIndex}
                      className={`relative p-1 text-center text-xs rounded cursor-pointer h-12 flex flex-col justify-center ${
                        isDisabled
                          ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                          : isSelectedDate
                          ? 'bg-orange-500 text-white'
                          : isTodayDate
                          ? 'bg-orange-100 border-2 border-orange-400 text-orange-700'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                      onClick={() => !isDisabled && handleDayClick(day)}
                      title={isDisabled ? 'Date not available' : `Select ${day}`}
                    >
                      <div className="font-medium text-xs">
                        {day}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-xl hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (selectedDate) {
                onDateSelect(selectedDate);
              }
              onClose();
            }}
            className="px-4 py-2 rounded-xl text-white"
            style={{ background: '#f97316' }}
            disabled={!selectedDate}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarPicker;
