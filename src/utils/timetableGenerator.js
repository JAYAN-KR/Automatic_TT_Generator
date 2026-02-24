import { getAbbreviation } from './subjectAbbreviations';
import { detectLabConflict, determineLabStatus } from './labSharingValidation';

// Timetable Generation Engine
export const generateTimetable = (mappings, distribution, bellTimings, streams = []) => {
    console.log('🔄 Starting timetable generation...', {
        mappingsCount: mappings?.length || 0,
        streamsCount: streams?.length || 0
    });

    // ============ CONSTANTS ============
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const allPeriods = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];

    // Level-aware slot logic
    const getLevel = (className) => {
        const grade = parseInt(className) || 0;
        return grade >= 11 ? 'Senior' : 'Middle';
    };

    const getAvailableSlots = (className) => {
        const level = getLevel(className);
        return level === 'Senior'
            ? ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S11']
            : ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S10', 'S11'];
    };

    const getBlockPairs = (className) => {
        const slots = getAvailableSlots(className);
        return [
            [slots[0], slots[1]], // S1-S2
            [slots[2], slots[3]], // S4-S5
            [slots[3], slots[4]], // S5-S6
            [slots[6], slots[7]]  // S10-S11 or S9-S11
        ];
    };

    const classList = [
        '6A', '6B', '6C', '6D', '6E', '6F', '6G',
        '7A', '7B', '7C', '7D', '7E', '7F', '7G',
        '8A', '8B', '8C', '8D', '8E', '8F', '8G',
        '9A', '9B', '9C', '9D', '9E', '9F', '9G',
        '10A', '10B', '10C', '10D', '10E', '10F', '10G',
        '11A', '11B', '11C', '11D', '11E', '11F',
        '12A', '12B', '12C', '12D', '12E', '12F'
    ];

    // ============ GET UNIQUE TEACHERS ============
    const teacherSet = new Set();
    mappings.forEach(m => {
        if (m.teacher) teacherSet.add(m.teacher);
    });
    streams.forEach(stream => {
        stream.subjects?.forEach(s => {
            if (s.teacher) teacherSet.add(s.teacher);
        });
    });

    const teacherList = Array.from(teacherSet);
    console.log(`👩\u200D🏫 Found ${teacherList.length} unique teachers`);

    // ============ INITIALIZE DATA STRUCTURES SAFELY ============
    const classTimetables = {};
    const teacherTimetables = {};

    classList.forEach(className => {
        classTimetables[className] = {};
        const level = getLevel(className);
        days.forEach(day => {
            classTimetables[className][day] = {};
            allPeriods.forEach(p => {
                const isBreak = p === 'S3' || p === 'S7';
                const isLunch = (level === 'Senior' && p === 'S10') || (level === 'Middle' && p === 'S9');
                classTimetables[className][day][p] = {
                    subject: isBreak ? 'BREAK' : (isLunch ? 'LUNCH' : ''),
                    teacher: '',
                    isReserved: isBreak || isLunch
                };
            });
        });
    });

    teacherList.forEach(teacher => {
        teacherTimetables[teacher] = { weeklyPeriods: 0 };
        days.forEach(day => {
            teacherTimetables[teacher][day] = { periodCount: 0 };
            allPeriods.forEach(p => {
                const isBreak = p === 'S3' || p === 'S7';
                teacherTimetables[teacher][day][p] = isBreak ? 'BREAK' : '';
            });
        });
    });

    // ============ PREPARE ALL TASKS GLOBALLLY ============
    const allTasks = [];
    mappings.forEach((mapping) => {
        const teacher = mapping.teacher;
        const subject = mapping.subject;
        const classes = mapping.selectedClasses || mapping.classes || [];

        if (!teacher || !subject || classes.length === 0) return;

        classes.forEach(c => {
            const total = (distribution && distribution[c] && distribution[c][subject]) || 0;
            const blocks = (distribution && distribution.__blocks && distribution.__blocks[c] && distribution.__blocks[c][subject]) || 0;
            const singles = Math.max(0, total - (blocks * 2));
            const preferredDay = (distribution && distribution.__days && distribution.__days[c] && distribution.__days[c][subject]) || 'Any';

            // New structure: distribution.__labGroups[c][subject] is { labGroup, targetLabCount }
            const labInfo = (distribution && distribution.__labGroups && distribution.__labGroups[c] && distribution.__labGroups[c][subject]) || { labGroup: 'None', targetLabCount: 3 };
            const labGroup = labInfo.labGroup || 'None';
            const targetLabCount = labInfo.targetLabCount !== undefined ? labInfo.targetLabCount : 3;

            for (let t = 0; t < blocks; t++) {
                allTasks.push({ type: 'BLOCK', teacher, subject, className: c, classes: [c], preferredDay, labGroup, targetLabCount });
            }
            for (let t = 0; t < singles; t++) {
                allTasks.push({ type: 'SINGLE', teacher, subject, className: c, classes: [c], preferredDay, labGroup, targetLabCount });
            }
        });
    });

    // STREAM processing
    streams.forEach(stream => {
        const total = Number(stream.periods) || 0;
        for (let t = 0; t < total; t++) {
            allTasks.push({
                type: 'STREAM',
                name: stream.name,
                className: stream.className,
                classes: [stream.className],
                subjects: stream.subjects,
                preferredDay: 'Any'
            });
        }
    });

    allTasks.sort((a, b) => {
        const priority = { 'BLOCK': 0, 'STREAM': 1, 'SINGLE': 2 };
        return priority[a.type] - priority[b.type];
    });

    // ============ PLACEMENT ENGINE ============
    allTasks.forEach((task, taskIdx) => {
        let placed = false;
        let candidateDays = [...days];
        const dayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday' };

        if (task.preferredDay && task.preferredDay !== 'Any') {
            const targetDay = dayMap[task.preferredDay] || task.preferredDay;
            candidateDays = candidateDays.filter(d => d === targetDay);
        }

        const dayStart = candidateDays.length > 1 ? Math.floor(Math.random() * candidateDays.length) : 0;

        for (let d = 0; d < candidateDays.length && !placed; d++) {
            const day = candidateDays[(dayStart + d) % candidateDays.length];

            if (task.type === 'BLOCK') {
                const pairs = getBlockPairs(task.className);
                for (const [p1, p2] of pairs) {
                    const teacherFree = teacherTimetables[task.teacher] && teacherTimetables[task.teacher][day][p1] === '' && teacherTimetables[task.teacher][day][p2] === '';
                    const classesFree = task.classes.every(cn =>
                        classTimetables[cn] && classTimetables[cn][day] &&
                        classTimetables[cn][day][p1].subject === '' &&
                        classTimetables[cn][day][p2].subject === ''
                    );

                    const lab1Free = task.labGroup === 'None' || !task.classes.some(cn => detectLabConflict(classTimetables, cn, day, p1, task.labGroup));
                    const lab2Free = task.labGroup === 'None' || !task.classes.some(cn => detectLabConflict(classTimetables, cn, day, p2, task.labGroup));

                    if (teacherFree && classesFree && lab1Free && lab2Free) {
                        placeTask(task, day, p1, true);
                        placeTask(task, day, p2, true);
                        placed = true;
                        break;
                    }
                }
            } else if (task.type === 'STREAM') {
                const availableSlots = getAvailableSlots(task.className);
                const pStart = Math.floor(Math.random() * availableSlots.length);
                for (let pIdx = 0; pIdx < availableSlots.length; pIdx++) {
                    const period = availableSlots[(pStart + pIdx) % availableSlots.length];
                    const teachersFree = task.subjects.every(s => teacherTimetables[s.teacher] && teacherTimetables[s.teacher][day][period] === '');
                    const classFree = classTimetables[task.className] && classTimetables[task.className][day][period].subject === '';

                    let labConflict = false;
                    for (const s of task.subjects) {
                        if (s.labGroup && s.labGroup !== 'None') {
                            if (detectLabConflict(classTimetables, task.className, day, period, s.labGroup)) {
                                labConflict = true;
                                break;
                            }
                        }
                    }

                    if (teachersFree && classFree && !labConflict) {
                        placeStreamTask(task, day, period);
                        placed = true;
                        break;
                    }
                }
            } else { // SINGLE
                const availableSlots = getAvailableSlots(task.className);
                const pStart = Math.floor(Math.random() * availableSlots.length);
                for (let pIdx = 0; pIdx < availableSlots.length; pIdx++) {
                    const period = availableSlots[(pStart + pIdx) % availableSlots.length];
                    const teacherFree = teacherTimetables[task.teacher] && teacherTimetables[task.teacher][day][period] === '';
                    const classesFree = task.classes.every(cn => classTimetables[cn] && classTimetables[cn][day] && classTimetables[cn][day][period].subject === '');

                    const labFree = task.labGroup === 'None' || !task.classes.some(cn => detectLabConflict(classTimetables, cn, day, period, task.labGroup));

                    if (teacherFree && classesFree && labFree) {
                        placeTask(task, day, period, false);
                        placed = true;
                        break;
                    }
                }
            }
        }

        // Fallback for conflicts
        if (!placed) {
            const day = days[taskIdx % days.length];
            const availableSlots = getAvailableSlots(task.className);
            const period = availableSlots[(taskIdx % availableSlots.length)];
            if (task.type === 'STREAM') placeStreamTask(task, day, period);
            else placeTask(task, day, period, task.type === 'BLOCK');
        }
    });

    function placeTask(task, day, period, isBlock) {
        const abbr = getAbbreviation(task.subject);
        const labStatusData = { className: task.classes[0], subject: task.subject, labGroup: task.labGroup || 'None', targetLabCount: task.targetLabCount };
        const isLab = determineLabStatus(classTimetables, labStatusData, day, period);

        task.classes.forEach(cn => {
            classTimetables[cn][day][period] = {
                subject: abbr,
                teacher: task.teacher,
                fullSubject: task.subject,
                isBlock: isBlock,
                labGroup: task.labGroup || 'None',
                targetLabCount: task.targetLabCount,
                isLabPeriod: isLab
            };
        });

        teacherTimetables[task.teacher][day][period] = {
            className: task.classes.join('/'),
            subject: task.subject,
            isBlock: isBlock,
            labGroup: task.labGroup || 'None',
            targetLabCount: task.targetLabCount,
            isLabPeriod: isLab
        };
        teacherTimetables[task.teacher][day].periodCount++;
        teacherTimetables[task.teacher].weeklyPeriods++;
    }

    function placeStreamTask(task, day, period) {
        const abbr = getAbbreviation(task.name);
        if (classTimetables[task.className]) {
            classTimetables[task.className][day][period] = {
                subject: abbr,
                isStream: true,
                streamName: task.name,
                subjects: task.subjects
            };
        }

        task.subjects.forEach(s => {
            const labStatusData = { className: task.className, subject: s.subject, labGroup: s.labGroup || 'None', targetLabCount: s.targetLabCount };
            const isLab = determineLabStatus(classTimetables, labStatusData, day, period);

            teacherTimetables[s.teacher][day][period] = {
                className: task.className,
                subject: s.subject,
                groupName: s.groupName,
                isStream: true,
                streamName: task.name,
                labGroup: s.labGroup || 'None',
                targetLabCount: s.targetLabCount,
                isLabPeriod: isLab
            };

            if (classTimetables[task.className][day][period] && !classTimetables[task.className][day][period].labGroup) {
                classTimetables[task.className][day][period].labGroup = s.labGroup || 'None';
                classTimetables[task.className][day][period].isLabPeriod = isLab;
            }

            teacherTimetables[s.teacher][day].periodCount++;
            teacherTimetables[s.teacher].weeklyPeriods++;
        });
    }

    return { teacherTimetables, classTimetables, errors: [] };
};
