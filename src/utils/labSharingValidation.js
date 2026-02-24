/**
 * Lab Resource Sharing Validation Utility
 *
 * This utility handles the logic for sharing multiple lab resources.
 * 
 * Labs:
 * 1. Middle School Computer Lab (grades 6-8)
 * 2. Main School Computer Lab (grades 9-10)
 * 3. Main School Home Science Lab (grades 9-10)
 * 4. Senior School Computer Lab (grades 11-12)
 */

export const LAB_GROUPS = {
    NONE: 'None',
    GROUP1: 'CSc Lab Group',
    GROUP2: 'DS/AI Lab Group'
};

export const LAB_SYSTEM = {
    MS_COMP: 'Middle School Computer Lab',
    MAIN_COMP: 'Main School Computer Lab',
    MAIN_HS: 'Main School Home Science Lab',
    SS_COMP: 'Senior School Computer Lab',
    PHY_LAB: 'Physics Lab',
    CHEM_LAB: 'Chemistry Lab',
    BIO_LAB: 'Biology Lab'
};

/**
 * Identifies which lab a specific subject and class combination uses.
 * @param {string} className 
 * @param {string} subject 
 * @returns {string|null} - Lab Name or null
 */
export const getLabForSubject = (className, subject) => {
    if (!className || !subject) return null;
    const gradeMatch = className.match(/^(\d+)/);
    if (!gradeMatch) return null;
    const grade = parseInt(gradeMatch[1]);
    const sub = subject.toUpperCase();

    // Computer Lab logic
    if (sub.includes('COMPUTER') || sub.includes('COMP') || sub === 'CSC' || sub === 'CS' || sub.includes('INFO') || sub === 'IP' || sub.includes('DATA SCIENCE') || sub.includes('ARTIFICIAL')) {
        if (grade >= 1 && grade <= 8) return LAB_SYSTEM.MS_COMP;
        if (grade >= 9 && grade <= 10) return LAB_SYSTEM.MAIN_COMP;
        if (grade >= 11 && grade <= 12) return LAB_SYSTEM.SS_COMP;
    }

    // Home Science logic
    if (sub.includes('HOME SCIENCE') || sub === 'HS' || sub === 'HSC') {
        if (grade >= 9 && grade <= 12) return LAB_SYSTEM.MAIN_HS;
    }

    // Science Labs (Usually for Senior secondary)
    if (grade >= 9) {
        if (sub.includes('PHYSICS') || sub === 'PHY' || sub === 'PH') return LAB_SYSTEM.PHY_LAB;
        if (sub.includes('CHEMISTRY') || sub === 'CHEM' || sub === 'CH') return LAB_SYSTEM.CHEM_LAB;
        if (sub.includes('BIOLOGY') || sub === 'BIO' || (sub.includes('BIO') && sub.includes('LOGY'))) return LAB_SYSTEM.BIO_LAB;
        if (sub.includes('SCIENCE') && !sub.includes('SOCIAL') && !sub.includes('COMPUTER')) {
            // General science might use a lab depending on the school, 
            // but let's be conservative to avoid unnecessary blocking
        }
    }

    return null;
};

// All classes that might use any lab - broadened
export const TARGET_LAB_CLASSES = [
    '1A', '1B', '1C', '1D', '1E', '1F', '1G',
    '2A', '2B', '2C', '2D', '2E', '2F', '2G',
    '3A', '3B', '3C', '3D', '3E', '3F', '3G',
    '4A', '4B', '4C', '4D', '4E', '4F', '4G',
    '5A', '5B', '5C', '5D', '5E', '5F', '5G',
    '6A', '6B', '6C', '6D', '6E', '6F', '6G',
    '7A', '7B', '7C', '7D', '7E', '7F', '7G',
    '8A', '8B', '8C', '8D', '8E', '8F', '8G',
    '9A', '9B', '9C', '9D', '9E', '9F', '9G',
    '10A', '10B', '10C', '10D', '10E', '10F', '10G',
    '11A', '11B', '11C', '11D', '11E', '11F', '11S', '11C', '11A', '11G',
    '12A', '12B', '12C', '12D', '12E', '12F', '12S', '12C', '12A', '12G'
];

/**
 * Validates if there is a lab conflict for a specific slot and lab.
 */
export const detectLabConflict = (classTimetables, className, day, period, labGroup, subject) => {
    const targetLab = getLabForSubject(className, subject);
    if (!targetLab) return false;

    // Discover dynamic classes from the current state if available
    const activeClasses = classTimetables ? Object.keys(classTimetables) : TARGET_LAB_CLASSES;

    for (const otherClassName of activeClasses) {
        if (otherClassName === className) continue; // Check other classes

        const classTT = classTimetables[otherClassName];
        if (!classTT || !classTT[day]) continue;

        const slot = classTT[day][period];
        if (!slot) continue;

        // If other class is in a lab period
        if (slot.isLabPeriod) {
            // Check if it's using the SAME lab
            const otherLab = getLabForSubject(otherClassName, slot.fullSubject || slot.subject);
            if (otherLab === targetLab) {
                // Shared Lab Groups (like Multiple Teachers in same lab at same time)
                // If they are in the SAME lab group, it's NOT a conflict
                if (labGroup && labGroup !== 'None' && slot.labGroup === labGroup) {
                    return false;
                }
                return true;
            }
        }

        if (slot.isStream && slot.subjects) {
            if (slot.subjects.some(s => {
                if (!s.isLabPeriod) return false;
                const otherLab = getLabForSubject(otherClassName, s.subject);
                if (otherLab === targetLab) {
                    if (labGroup && labGroup !== 'None' && s.labGroup === labGroup) return false;
                    return true;
                }
                return false;
            })) return true;
        }
    }
    return false;
};

/**
 * Automatically determines if a newly placed period should be LAB or THEORY.
 */
export const determineLabStatus = (classTimetables, taskData, day, period) => {
    const { className, subject, labGroup, targetLabCount } = taskData;

    // If targetLabCount is 0, then it's definitely NOT a lab period
    const limit = Number(targetLabCount || 0);
    if (limit <= 0) return false;

    const targetLab = getLabForSubject(className, subject);

    // 1. Check if the lab resource is already occupied by another class
    if (targetLab && detectLabConflict(classTimetables, className, day, period, labGroup, subject)) {
        return false;
    }

    // 2. Count existing lab periods already placed for this specific assignment (Class + Subject)
    let labCount = 0;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];

    if (classTimetables[className]) {
        days.forEach(d => {
            periods.forEach(p => {
                const s = classTimetables[className][d][p];
                if (!s) return;

                if (s.isLabPeriod) {
                    if (s.fullSubject === subject || s.subject === subject) {
                        labCount++;
                    } else if (s.isStream && s.subjects) {
                        const subMatch = s.subjects.find(sub => sub.subject === subject);
                        if (subMatch && subMatch.isLabPeriod) labCount++;
                    }
                }
            });
        });
    }

    // If we haven't reached the requested lab period quota, mark it as LAB
    if (labCount < limit) return true;

    return false;
};
