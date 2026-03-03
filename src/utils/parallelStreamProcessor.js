import { detectLabConflict, getLabForSubject } from './labSharingValidation';

// Block pairs that do NOT cross breaks (middle vs senior are determined externally)
const VALID_BLOCK_PAIRS_MIDDLE = [['P1','P2'], ['P4','P5'], ['P5','P6'], ['P10','P11']];
const VALID_BLOCK_PAIRS_SENIOR = [['P1','P2'], ['P4','P5'], ['P5','P6'], ['P8','P9']];

function getValidPairs(isMiddle) {
    return isMiddle ? VALID_BLOCK_PAIRS_MIDDLE : VALID_BLOCK_PAIRS_SENIOR;
}

/**
 * Checks whether a particular day (or any day when dayPref === 'Any') can accommodate
 * the requested number of 2-period blocks without lab or teacher conflicts.
 *
 * @param {*} stream - the stream definition containing subjects and teachers
 * @param {*} classTimetables - current class timetables
 * @param {*} teacherTimetables - current teacher timetables
 * @param {string} dayPref - either a specific day or 'Any'
 * @param {number} count - total periods requested for this block type (2 or 4)
 * @param {boolean} isLab - whether this check is for a lab block (true) or theory (false)
 * @returns {{ok:boolean, details:string}} - ok false with detail if no slot found
 */
function checkBlockAvailability(stream, classTimetables, teacherTimetables, dayPref, count, isLab) {
    const neededBlocks = Math.ceil(count / 2);
    const classNames = (stream.className || '').split('/').map(s => s.trim()).filter(Boolean);
    const isMiddle = classNames.length && parseInt(classNames[0]) < 11;
    const pairs = getValidPairs(isMiddle);
    const daysToTry = dayPref === 'Any'
        ? ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        : [dayPref];

    for (const day of daysToTry) {
        let found = 0;
        for (const [p1,p2] of pairs) {
            // lab check only if isLab and subject actually requires lab
            let conflict = false;

            if (isLab) {
                for (const subj of stream.subjects) {
                    const labName = getLabForSubject(classNames[0], subj.subject);
                    if (!labName) continue; // this subject doesn't need a lab
                    for (const cn of classNames) {
                        if (detectLabConflict(classTimetables, cn, day, p1, subj.labGroup, subj.subject) ||
                            detectLabConflict(classTimetables, cn, day, p2, subj.labGroup, subj.subject)) {
                            conflict = true;
                            break;
                        }
                    }
                    if (conflict) break;
                }
            }

            if (conflict) continue;

            // teacher availability check (every teacher must be free both periods)
            for (const subj of stream.subjects) {
                const t = (subj.teacher || '').trim();
                if (!t) continue;
                const tt = teacherTimetables[t];
                if (tt && ((tt[day] && tt[day][p1] && tt[day][p1] !== '') || (tt[day] && tt[day][p2] && tt[day][p2] !== ''))) {
                    conflict = true;
                    break;
                }
            }
            if (conflict) continue;

            // this pair is good
            found++;
            if (found >= neededBlocks) {
                return { ok: true };
            }
        }
        // if we looked for a specific day and didn't satisfy, break early
        if (dayPref !== 'Any' && found < neededBlocks) {
            // record why
            return { ok: false, details: `No ${isLab ? 'lab' : 'theory'} block of ${count} found on ${day}` };
        }
    }

    return { ok: false, details: `Insufficient ${isLab ? 'lab' : 'theory'} block slots for ${count} periods` };
}

/**
 * Validates the given stream object against current timetables.
 * Returns {ok:boolean, messages:Array<string>}.
 */
export function validateStream(stream, classTimetables, teacherTimetables) {
    const msgs = [];

    // block sum cannot exceed weekly load
    const totalLoad = Number(stream.periods) || 0;
    const tb = Number(stream.tBlock) || 0;
    const lb = Number(stream.lBlock) || 0;
    if (tb + lb > totalLoad) {
        msgs.push(`Total blocks (TB + LB = ${tb + lb}) exceed weekly load of ${totalLoad}`);
    }

    // theory block validation
    if (tb > 0) {
        const res = checkBlockAvailability(stream, classTimetables, teacherTimetables, stream.tbDay || 'Any', tb, false);
        if (!res.ok) msgs.push(`Theory block issue: ${res.details}`);
    }

    // lab block validation
    if (lb > 0) {
        const res = checkBlockAvailability(stream, classTimetables, teacherTimetables, stream.lbDay || 'Any', lb, true);
        if (!res.ok) msgs.push(`Lab block issue: ${res.details}`);
    }

    return { ok: msgs.length === 0, messages: msgs };
}