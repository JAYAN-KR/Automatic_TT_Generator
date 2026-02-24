/**
 * Lab Resource Sharing Validation Utility
 *
 * This utility handles the logic for sharing computer lab resources.
 * 
 * Rules:
 * 1. The computer lab is a shared resource across grades.
 * 2. Only ONE group can be in the lab ([LAB]) at any given time (period/day).
 * 3. In Grade 11 (11A, 11B, 11D), subjects are split into groups (CSc and DS/AI).
 *    When one group is in the lab ([LAB]), the other must be in theory ([TH]).
 * 4. This logic now extends to Middle School (Grades 6-10) where Computer Science
 *    classes also require exclusive lab access.
 */

export const LAB_GROUPS = {
    NONE: 'None',
    GROUP1: 'CSc Lab Group',
    GROUP2: 'DS/AI Lab Group'
};

// All classes that might use the computer lab
export const TARGET_LAB_CLASSES = [
    '6A', '6B', '6C', '6D', '6E', '6F', '6G',
    '7A', '7B', '7C', '7D', '7E', '7F', '7G',
    '8A', '8B', '8C', '8D', '8E', '8F', '8G',
    '9A', '9B', '9C', '9D', '9E', '9F', '9G',
    '10A', '10B', '10C', '10D', '10E', '10F', '10G',
    '11A', '11B', '11C', '11D', '11E', '11F',
    '12A', '12B', '12C', '12D', '12E', '12F'
];

/**
 * Checks if a subject belongs to a lab group.
 */
export const getLabGroupId = (labGroup) => {
    if (labGroup === LAB_GROUPS.GROUP1) return 1;
    if (labGroup === LAB_GROUPS.GROUP2) return 2;
    return 0;
};

/**
 * Validates if there is a lab conflict for a specific slot.
 */
export const detectLabConflict = (classTimetables, className, day, period, labGroup) => {
    if (!labGroup || labGroup === LAB_GROUPS.NONE) return false;

    for (const otherClassName of TARGET_LAB_CLASSES) {
        const classTT = classTimetables[otherClassName];
        if (!classTT || !classTT[day]) continue;

        const slot = classTT[day][period];
        if (!slot || !slot.subject) continue;

        if (slot.isLabPeriod) return true;

        if (slot.isStream && slot.subjects) {
            if (slot.subjects.some(s => s.isLabPeriod)) return true;
        }
    }
    return false;
};

/**
 * Automatically determines if a newly placed period should be LAB or THEORY.
 */
export const determineLabStatus = (classTimetables, taskData, day, period) => {
    const { className, subject, labGroup, targetLabCount } = taskData;
    if (!labGroup || labGroup === LAB_GROUPS.NONE) return false;

    // Use task-specific limit or default to 3
    const limit = targetLabCount !== undefined ? Number(targetLabCount) : 3;

    // 1. Check if ANY class is already using the lab in this slot
    for (const otherClassName of TARGET_LAB_CLASSES) {
        const slot = classTimetables[otherClassName]?.[day]?.[period];
        if (!slot) continue;

        if (slot.isLabPeriod) return false; // Lab occupied

        if (slot.isStream && slot.subjects) {
            if (slot.subjects.some(s => s.isLabPeriod)) return false;
        }
    }

    // 2. Count existing lab periods for this (Class + Teacher + Subject)
    let labCount = 0;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'S11'];

    if (classTimetables[className]) {
        days.forEach(d => {
            periods.forEach(p => {
                const s = classTimetables[className][d][p];
                if (s && (s.fullSubject === subject || s.subject === subject)) {
                    if (s.isLabPeriod) labCount++;
                }

                if (s && s.isStream && s.subjects) {
                    const subMatch = s.subjects.find(sub => sub.subject === subject);
                    if (subMatch && subMatch.isLabPeriod) labCount++;
                }
            });
        });
    }

    if (labCount >= limit) return false;
    return true;
};
