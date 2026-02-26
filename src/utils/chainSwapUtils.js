
/**
 * Checks if a teacher is free in a specific slot, considering periods 
 * that are currently being "moved out" as part of a swap chain.
 */
export const isTeacherFreeInSlot = (teacherName, day, period, classTimetables, movingOutCells) => {
    if (!teacherName) return true;
    const cleanTeacher = teacherName.trim().toUpperCase();

    // Check all classes for this teacher in the given slot
    for (const cls of Object.keys(classTimetables)) {
        const slot = classTimetables[cls]?.[day]?.[period];
        if (slot && slot.teacher && slot.teacher.trim().toUpperCase() === cleanTeacher) {
            // Is this specific cell being moved out? If so, the teacher WILL be free.
            const cellId = `${cls}|${day}|${period}`;
            if (!movingOutCells.has(cellId)) {
                return false;
            }
        }
    }
    return true;
};

/**
 * Finds all available destination periods for a given source in a class.
 */
export const findAvailableDestinations = (cls, sourceItem, generatedTimetable, swapChain, activeGradeSubTab) => {
    if (!cls || !sourceItem || !generatedTimetable) return [];

    const available = [];
    const classTT = generatedTimetable.classTimetables[cls];
    if (!classTT) return [];

    const movingOutCells = new Set(swapChain.filter(p => p != null).map(p => `${p.cls}|${p.day}|${p.period}`));
    const sourceCell = classTT[sourceItem.day]?.[sourceItem.period];
    const teacherName = sourceCell?.teacher;

    // Define the valid periods to check
    const periods = ['CT', 'S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'S11'];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const isMiddle = ['6', '7', '8'].includes(activeGradeSubTab);

    days.forEach(day => {
        periods.forEach(p => {
            // 1. Skip if same as source
            if (day === sourceItem.day && p === sourceItem.period) return;

            // 2. Skip lunch periods
            if (p === 'S9' && isMiddle) return;
            if (p === 'S10' && !isMiddle) return;

            // 3. Skip if current teacher is already assigned here (and not moving out)
            if (!isTeacherFreeInSlot(teacherName, day, p, generatedTimetable.classTimetables, movingOutCells)) {
                return;
            }

            available.push({ cls, day, period: p });
        });
    });

    return available;
};
