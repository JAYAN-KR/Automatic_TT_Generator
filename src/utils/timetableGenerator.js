import { getAbbreviation } from './subjectAbbreviations';

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
        // Middle (6-10): Skip S3, S7 (Breaks), S9 (Lunch). Available: S1,S2,S4,S5,S6,S8,S10,S11
        // Senior (11-12): Skip S3, S7 (Breaks), S10 (Lunch). Available: S1,S2,S4,S5,S6,S8,S9,S11
        return level === 'Senior'
            ? ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S11']
            : ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S10', 'S11'];
    };

    const getBlockPairs = (className) => {
        const slots = getAvailableSlots(className);
        // Returns pairs of adjacent available slots that don't cross a break/lunch
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
    // Also include teachers from streams
    streams.forEach(stream => {
        stream.subjects?.forEach(s => {
            if (s.teacher) teacherSet.add(s.teacher);
        });
    });

    const teacherList = Array.from(teacherSet);
    console.log(`👩‍🏫 Found ${teacherList.length} unique teachers`);

    // ============ INITIALIZE DATA STRUCTURES SAFELY ============
    const classTimetables = {};
    const teacherTimetables = {};

    // Initialize ALL classes with empty schedules
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

    // Initialize ALL teachers with empty schedules
    teacherList.forEach(teacher => {
        teacherTimetables[teacher] = { weeklyPeriods: 0 };
        days.forEach(day => {
            teacherTimetables[teacher][day] = { periodCount: 0 };
            allPeriods.forEach(p => {
                const isBreak = p === 'S3' || p === 'S7';
                // Note: teacher lunch depends on WHICH class they are teaching at that time,
                // but we can mark the likely lunch slots as 'LUNCH' preliminarily.
                // However, teachers might teach across levels. For now, we just mark breaks.
                teacherTimetables[teacher][day][p] = isBreak ? 'BREAK' : '';
            });
        });
    });

    console.log('📊 Initialized:', {
        classes: Object.keys(classTimetables).length,
        teachers: Object.keys(teacherList).length
    });

    // ============ PROCESS MAPPINGS & STREAMS ============
    let totalAllocations = 0;
    let skippedMappings = 0;

    // ============ PREPARE ALL TASKS GLOBALLLY ============
    const allTasks = [];
    mappings.forEach((mapping) => {
        const teacher = mapping.teacher;
        const subject = mapping.subject;
        const classes = mapping.selectedClasses || mapping.classes || [];

        if (!teacher || !subject || classes.length === 0) {
            skippedMappings++;
            return;
        }

        const mergedForSubject = (distribution && distribution.__merged && distribution.__merged[subject]) || [];
        const handledClasses = new Set();

        // 1. Process merged groups
        mergedForSubject.forEach(g => {
            const overlap = g.classes.filter(c => classes.includes(c));
            if (overlap.length > 0) {
                const total = Number(g.total) || 0;
                const blocks = Number(g.blockPeriods) || 0;
                const singles = Math.max(0, total - (blocks * 2));
                const preferredDay = g.preferredDay || 'Any';

                for (let t = 0; t < blocks; t++) {
                    allTasks.push({ type: 'BLOCK', teacher, subject, className: overlap[0], classes: overlap, preferredDay });
                }
                for (let t = 0; t < singles; t++) {
                    allTasks.push({ type: 'SINGLE', teacher, subject, className: overlap[0], classes: overlap, preferredDay });
                }
                overlap.forEach(c => handledClasses.add(c));
            }
        });

        // 2. Process individual classes
        classes.forEach(c => {
            if (handledClasses.has(c)) return;
            const total = (distribution && distribution[c] && distribution[c][subject]) || 0;
            const blocks = (distribution && distribution.__blocks && distribution.__blocks[c] && distribution.__blocks[c][subject]) || 0;
            const singles = Math.max(0, total - (blocks * 2));
            const preferredDay = (distribution && distribution.__days && distribution.__days[c] && distribution.__days[c][subject]) || 'Any';

            for (let t = 0; t < blocks; t++) {
                allTasks.push({ type: 'BLOCK', teacher, subject, className: c, classes: [c], preferredDay });
            }
            for (let t = 0; t < singles; t++) {
                allTasks.push({ type: 'SINGLE', teacher, subject, className: c, classes: [c], preferredDay });
            }
        });
    });

    // 3. Process Streams
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

    // Sort tasks: BLOCKS first, then STREAMS (more constraints), then SINGLES
    allTasks.sort((a, b) => {
        const priority = { 'BLOCK': 0, 'STREAM': 1, 'SINGLE': 2 };
        return priority[a.type] - priority[b.type];
    });

    console.log(`📋 Total tasks to place: ${allTasks.length}`);

    // ============ PLACEMENT ENGINE ============
    allTasks.forEach((task, taskIdx) => {
        let placed = false;

        // Determine days to search
        let candidateDays = [...days];
        const dayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday' };

        if (task.preferredDay && task.preferredDay !== 'Any') {
            const targetDay = dayMap[task.preferredDay] || task.preferredDay;
            candidateDays = candidateDays.filter(d => d === targetDay);
        }

        // Randomize day search start to distribute better (only if multiple candidates)
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

                    if (teacherFree && classesFree) {
                        placeTask(task, day, p1, true);
                        placeTask(task, day, p2, true);
                        placed = true;
                        break;
                    }
                }
            } else if (task.type === 'STREAM') {
                const availableSlots = getAvailableSlots(task.className);
                const pStart = Math.floor(Math.random() * availableSlots.length);
                for (let p = 0; p < availableSlots.length; p++) {
                    const period = availableSlots[(pStart + p) % availableSlots.length];

                    // Check if ALL teachers in the stream are free
                    const teachersFree = task.subjects.every(s =>
                        teacherTimetables[s.teacher] &&
                        teacherTimetables[s.teacher][day][period] === ''
                    );

                    // Check if the class is free
                    const classFree = classTimetables[task.className] &&
                        classTimetables[task.className][day][period].subject === '';

                    if (teachersFree && classFree) {
                        placeStreamTask(task, day, period);
                        placed = true;
                        break;
                    }
                }
            } else {
                const availableSlots = getAvailableSlots(task.className);
                const pStart = Math.floor(Math.random() * availableSlots.length);
                for (let p = 0; p < availableSlots.length; p++) {
                    const period = availableSlots[(pStart + p) % availableSlots.length];
                    const teacherFree = teacherTimetables[task.teacher] && teacherTimetables[task.teacher][day][period] === '';
                    const classesFree = task.classes.every(cn =>
                        classTimetables[cn] && classTimetables[cn][day] &&
                        classTimetables[cn][day][period].subject === ''
                    );

                    if (teacherFree && classesFree) {
                        placeTask(task, day, period, false);
                        placed = true;
                        break;
                    }
                }
            }
        }

        if (!placed) {
            let conflictReason = 'No free slot';
            if (task.type === 'STREAM') {
                const dayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday' };
                const day = (task.preferredDay && task.preferredDay !== 'Any')
                    ? (dayMap[task.preferredDay] || task.preferredDay)
                    : days[taskIdx % days.length];

                // Inspect why it failed for this day specifically (or just generally)
                const busyTeachers = task.subjects.filter(s =>
                    teacherTimetables[s.teacher] &&
                    Object.values(teacherTimetables[s.teacher][day]).some(v => v !== '' && typeof v === 'object')
                ).map(s => s.teacher);

                if (busyTeachers.length > 0) {
                    conflictReason = `Teachers busy: ${busyTeachers.join(', ')}`;
                }
            }

            console.warn(`  🔴 Conflict: ${conflictReason} for ${task.teacher || task.name} - ${task.subject || 'STREAM'} (${task.type}) - Forcing placement`);
            const dayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday' };
            const day = (task.preferredDay && task.preferredDay !== 'Any')
                ? (dayMap[task.preferredDay] || task.preferredDay)
                : days[taskIdx % days.length];

            const availableSlots = getAvailableSlots(task.className);
            const period = availableSlots[(taskIdx % availableSlots.length)];

            if (task.type === 'STREAM') {
                placeStreamTask(task, day, period);
            } else {
                placeTask(task, day, period, task.type === 'BLOCK');
                if (task.type === 'BLOCK') {
                    const pIndex = Number(period.substring(1));
                    const nextPeriod = `P${(pIndex % 8) + 1}`;
                    placeTask(task, day, nextPeriod, true);
                }
            }
        }
    });

    function placeTask(task, day, period, isBlock) {
        task.classes.forEach(cn => {
            if (!classTimetables[cn]) return;
            classTimetables[cn][day][period] = {
                subject: getAbbreviation(task.subject),
                teacher: task.teacher,
                fullSubject: task.subject,
                isBlock: isBlock
            };
        });

        if (!teacherTimetables[task.teacher]) return;
        teacherTimetables[task.teacher][day][period] = {
            className: task.classes.join('/'),
            subject: task.subject,
            isBlock: isBlock
        };
        teacherTimetables[task.teacher][day].periodCount++;
        teacherTimetables[task.teacher].weeklyPeriods++;
        totalAllocations++;
    }

    function placeStreamTask(task, day, period) {
        // Update Class Timetable
        if (classTimetables[task.className]) {
            classTimetables[task.className][day][period] = {
                subject: getAbbreviation(task.name), // e.g. "2nd Language"
                isStream: true,
                streamName: task.name,
                subjects: task.subjects
            };
        }

        // Update each teacher's timetable
        task.subjects.forEach(s => {
            if (teacherTimetables[s.teacher]) {
                teacherTimetables[s.teacher][day][period] = {
                    className: task.className,
                    subject: s.subject,
                    groupName: s.groupName,
                    isStream: true,
                    streamName: task.name
                };
                teacherTimetables[s.teacher][day].periodCount++;
                teacherTimetables[s.teacher].weeklyPeriods++;
                totalAllocations++;
            }
        });
    }

    console.log(`📊 Total allocations: ${totalAllocations}`);

    const errors = [];
    return {
        teacherTimetables,
        classTimetables,
        errors
    };
};
