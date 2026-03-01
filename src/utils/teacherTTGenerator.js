// Utility functions shared by the TeacherTT tab and any helpers that
// operate on teacher timetables.  The goal is to keep merging logic
// (lab periods, block periods, etc.) out of the giant JSX blob in
// timetable.jsx and make it easier to reason about.

// exported constants for reuse elsewhere if needed
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const PERIODS = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];
// periods that should never be treated as the start of a merged pair
// they are the *second* element of the common two-slot pairs
export const MERGE_END_PERIODS = ['S2', 'S5', 'S9', 'S11'];

// abbreviated subject names shown in the teacher timetable grid
export function getSubAbbr(sub) {
    if (!sub) return '';
    const map = {
        'SANSKRIT': 'Skt',
        'PHYSICS': 'phy',
        'CHEMISTRY': 'Chem',
        'MATHEMATICS': 'Mat',
        'MATH': 'Mat',
        'BIOLOGY': 'Bio',
        'ENGLISH': 'Eng',
        'MALAYALAM': 'Mal',
        'HINDI': 'Hin',
        'HISTORY': 'His',
        'GEOGRAPHY': 'Geo',
        'SOCIAL SCIENCE': 'SS',
        'COMPUTER SCIENCE': 'CS',
        'PHYSICAL EDUCATION': 'PE',
        'ECONOMICS': 'Eco',
        'BUSINESS STUDIES': 'BST',
        'ACCOUNTANCY': 'Acc'
    };
    const upper = sub.trim().toUpperCase();
    return map[upper] || (sub.length > 4 ? sub.substring(0, 3) : sub);
}

// take a class string like "10E/10F" or "9A,9B" and return an object
// that allows us to render the number and divisions separately for
// legibility
export function getFormattedClass(className) {
    if (!className || className === '-' || className === 'EMPTY TEMPLATE') return { num: className, div: '' };
    const parts = className.split(/[\/,,]/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
        let commonNum = '';
        let allDivs = '';
        let consistent = true;
        parts.forEach((p, idx) => {
            const match = p.match(/^(\d+)([A-Z])$/);
            if (match) {
                if (idx === 0) commonNum = match[1];
                else if (commonNum !== match[1]) consistent = false;
                allDivs += match[2];
            } else {
                consistent = false;
            }
        });
        if (consistent && commonNum) {
            return { num: commonNum, div: allDivs };
        }
    }
    const singleMatch = className.match(/^(\d+)([A-Z])$/);
    if (singleMatch) {
        return { num: singleMatch[1], div: singleMatch[2] };
    }
    return { num: className, div: '' };
}

// determine whether two adjacent slots should be merged for display.
// the existing teacher tab already merges lab pairs by comparing the
// JSON stringified contents.  block periods (isBlock/isTBlock/isLBlock)
// are treated separately because the underlying objects may not be
// completely identical in all cases even though they represent the same
// class+subject.
export function isDoublePeriodStart(currentSlot, nextSlot, period) {
    if (!currentSlot || !nextSlot) return false;
    if (MERGE_END_PERIODS.includes(period)) return false;

    // simple equality check handles most lab-double cases
    try {
        if (JSON.stringify(currentSlot) === JSON.stringify(nextSlot)) {
            return true;
        }
    } catch {
        // ignore
    }

    // explicit block merge: both slots marked as block and share class/subject
    if (currentSlot.isBlock && nextSlot.isBlock &&
        currentSlot.className === nextSlot.className &&
        currentSlot.subject === nextSlot.subject) {
        return true;
    }

    return false;
}

export function isDoublePeriodEnd(currentSlot, prevSlot, period) {
    if (!currentSlot || !prevSlot) return false;
    if (!MERGE_END_PERIODS.includes(period)) return false;

    try {
        if (JSON.stringify(currentSlot) === JSON.stringify(prevSlot)) {
            return true;
        }
    } catch {
        // ignore
    }

    if (currentSlot.isBlock && prevSlot.isBlock &&
        currentSlot.className === prevSlot.className &&
        currentSlot.subject === prevSlot.subject) {
        return true;
    }

    return false;
}
