/**
 * Utilities for Class Timetable display logic
 */

/**
 * Generates the clubbing indicator text for a cell.
 * Example: "ACC (w/11B)" or "ACC (A/B)"
 * 
 * @param {Object} cell - The timetable cell data
 * @param {string} currentClass - The class name for the current timetable
 * @returns {string} The indicator string
 */
export const getClubbingIndicator = (cell, currentClass) => {
    if (!cell || !cell.otherClasses || cell.otherClasses.length === 0) return '';

    const others = cell.otherClasses;

    // Check if we can use the (A/B/C) format
    // This applies if all classes (current + others) have the same grade
    const getGradeAndDiv = (name) => {
        const match = name.match(/^(\d+)([A-G])$/);
        return match ? { grade: match[1], div: match[2] } : null;
    };

    const currentInfo = getGradeAndDiv(currentClass);
    if (currentInfo) {
        const otherInfos = others.map(getGradeAndDiv).filter(Boolean);
        // If all are in the same grade, we use the (A/B/C) style
        if (otherInfos.length === others.length && otherInfos.every(info => info.grade === currentInfo.grade)) {
            const divs = [currentInfo.div, ...otherInfos.map(info => info.div)].sort().join('/');
            return ` (${divs})`;
        }
    }

    // Default to (w/OtherClass)
    return ` (w/${others.join(', ')})`;
};

/**
 * Checks if a cell is a combined/clubbed class
 */
export const isClubbedClass = (cell) => {
    return !!(cell && cell.otherClasses && cell.otherClasses.length > 0);
};

/**
 * Utility to identify all combined subjects in a class timetable.
 * Returns an array of objects with details for the footnote.
 */
export const getCombinedSubjectsForClass = (classTimetable, SUBJECT_ABBR = {}, currentClass) => {
    if (!classTimetable) return [];

    const combinedSubjects = new Map();

    // Check all slots in the class timetable
    Object.values(classTimetable).forEach(daySchedule => {
        Object.values(daySchedule).forEach(cell => {
            if (!cell || !cell.subject) return;

            // Helper to process a potential combined subject
            const processSubject = (subData) => {
                if (subData.otherClasses && subData.otherClasses.length > 0) {
                    const subKey = subData.subject;
                    if (!combinedSubjects.has(subKey)) {
                        const indicator = getClubbingIndicator(subData, currentClass);
                        combinedSubjects.set(subKey, {
                            name: subData.fullSubject || subData.subject,
                            abbr: SUBJECT_ABBR[subData.subject.toUpperCase()] || subData.subject.toUpperCase().slice(0, 5),
                            indicator: indicator.trim(),
                            others: subData.otherClasses
                        });
                    }
                }
            };

            if (cell.isStream && cell.subjects) {
                cell.subjects.forEach(processSubject);
            } else {
                processSubject(cell);
            }
        });
    });

    return Array.from(combinedSubjects.values());
};
