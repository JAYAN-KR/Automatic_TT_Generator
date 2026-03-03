import { getAbbreviation } from './subjectAbbreviations.js';
import { detectLabConflict, determineLabStatus, getLabForSubject, LAB_SYSTEM } from './labSharingValidation.js';

// Timetable Generation Engine
export const generateTimetable = (mappings, distribution, bellTimings, streams = []) => {
    console.log('🔄 Starting timetable generation...', {
        mappingsCount: mappings?.length || 0,
        streamsCount: streams?.length || 0
    });

    // ============ CONSTANTS ============
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    // helper list that excludes Saturday since it's treated as a holiday by default
    const WEEKDAYS = days.slice(0, 5);
    const allPeriods = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'];

    // Level-aware slot logic
    // Level-aware slot logic
    const getLevel = (className) => {
        const grade = parseInt(className) || 0;
        return grade >= 9 ? 'Senior' : 'Middle';
    };

    const getBuilding = (className) => {
        if (!className) return null;
        const grade = parseInt(className.split('/')[0]) || 0;
        return (grade >= 11) ? 'Senior' : 'Main';
    };

    const getAvailableSlots = (className) => {
        const level = getLevel(className);
        return level === 'Senior'
            ? ['P1', 'P2', 'P4', 'P5', 'P6', 'P8', 'P9', 'P11']
            : ['P1', 'P2', 'P4', 'P5', 'P6', 'P8', 'P10', 'P11'];
    };

    const getBlockPairs = (className) => {
        const level = getLevel(className);
        return level === 'Senior'
            ? [['P1', 'P2'], ['P4', 'P5'], ['P5', 'P6'], ['P8', 'P9']]
            : [['P1', 'P2'], ['P4', 'P5'], ['P5', 'P6'], ['P10', 'P11']];
    };

    // ============ DISCOVER CLASSES & TEACHERS ============
    // Helper to extract classes from mappings
    const getClassesFromMappings = (mappings) => {
        const classes = new Set();
        mappings.forEach(m => {
            (m.selectedClasses || m.classes || []).forEach(c => classes.add(c));
        });
        return Array.from(classes);
    };

    // Helper to extract classes from streams
    const getClassesFromStreams = (streams) => {
        const classes = new Set();
        streams.forEach(stream => {
            if (stream.className) classes.add(stream.className);
        });
        return Array.from(classes);
    };

    const discoveredClasses = getClassesFromMappings(mappings);
    const allStreamClassNames = getClassesFromStreams(streams);

    const allClassNames = new Set([
        ...discoveredClasses,
        ...allStreamClassNames
    ]);

    const allTeacherNames = new Set();
    mappings.forEach(row => { // Renamed from allAllotmentRows to mappings
        if (row.teacher) allTeacherNames.add(row.teacher.trim());
    });
    streams.forEach(row => { // Renamed from allStreamRows to streams
        row.subjects.forEach(s => {
            if (s.teacher) allTeacherNames.add(s.teacher.trim());
        });
    });

    const teacherList = Array.from(allTeacherNames); // Updated to use allTeacherNames
    const finalDiscoveredClasses = Array.from(allClassNames); // Updated to use allClassNames
    console.log(`👩\u200D🏫 Found ${teacherList.length} unique teachers, ${finalDiscoveredClasses.length} unique classes`);

    // ============ INITIALIZE DATA STRUCTURES SAFELY ============
    const classTimetables = {};
    const teacherTimetables = {};

    // === report tracking ===
    let placedPeriods = 0;
    let failedPeriods = 0;
    const failedTasks = [];
    const preferenceViolations = [];

    finalDiscoveredClasses.forEach(className => { // Updated to use finalDiscoveredClasses
        classTimetables[className] = {};
        const level = getLevel(className);
        days.forEach(day => {
            classTimetables[className][day] = {};
            allPeriods.forEach(p => {
                const isBreak = p === 'P3' || p === 'P7';
                const isLunch = (level === 'Senior' && p === 'P10') || (level === 'Middle' && p === 'P9');
                classTimetables[className][day][p] = {
                    subject: isBreak ? 'BREAK' : (isLunch ? 'LUNCH' : ''),
                    teacher: '',
                    isReserved: isBreak || isLunch
                };
            });
        });
    });

    allTeacherNames.forEach(tName => {
        teacherTimetables[tName] = {};
        days.forEach(day => {
            teacherTimetables[tName][day] = { periodCount: 0 };
            allPeriods.forEach(p => { teacherTimetables[tName][day][p] = ''; });
        });
        teacherTimetables[tName].weeklyPeriods = 0;
    });

    // ============ PREPARE ALL TASKS GLOBALLLY ============
    const allTasks = [];
    mappings.forEach((mapping) => { // Renamed from allAllotmentRows to mappings
        const teacher = mapping.teacher ? mapping.teacher.trim() : '';
        const subject = mapping.subject ? mapping.subject.trim() : '';
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

    // Debugging: Track how many tasks were created for each teacher
    const teacherTaskCounts = {};
    allTasks.forEach(t => {
        if (t.teacher) {
            teacherTaskCounts[t.teacher] = (teacherTaskCounts[t.teacher] || 0) + (t.type === 'BLOCK' ? 2 : 1);
        } else if (t.subjects) {
            t.subjects.forEach(s => {
                const tName = s.teacher ? s.teacher.trim() : '';
                teacherTaskCounts[tName] = (teacherTaskCounts[tName] || 0) + 1;
            });
        }
    });

    Object.keys(teacherTimetables).forEach(t => {
        if (!teacherTaskCounts[t]) {
            console.warn(`⚠️ Teacher "${t}" has 0 periods identified for generation.`);
        }
    });

    console.log(`📋 Total generation tasks: ${allTasks.length}`);

    // STREAM processing
    streams.forEach(stream => {
        const total = Number(stream.periods) || 0;
        // respect any forced count/day settings for streams; treat the first `forceCount`
        // individual stream periods as having a hard preference for `forceDay` (usually Saturday).
        const forceCount = Math.min(Number(stream.forceCount) || 0, total);
        const forceDay = stream.forceDay || 'Saturday';
        for (let t = 0; t < total; t++) {
            const isForced = t < forceCount;
            allTasks.push({
                type: 'STREAM',
                name: stream.name,
                className: stream.className,
                classes: [stream.className],
                subjects: stream.subjects,
                // if this particular stream slot is part of the forced quota we give it
                // a target day; otherwise treat it as unconstrained ('Any') so the
                // scheduler will never push it to Saturday.
                preferredDay: isForced ? forceDay : 'Any'
            });
        }
    });

    // Apply force instructions coming from the distribution (used for the
    // batch/top‑level generator where allotment rows encode forced periods).
    // `distribution.__forced` is an array of objects {teacher,subject,className,count,day}.
    if (distribution && Array.isArray(distribution.__forced)) {
        distribution.__forced.forEach(f => {
            let remaining = f.count || 0;
            for (const t of allTasks) {
                if (remaining <= 0) break;
                if (t.teacher === f.teacher && t.subject === f.subject && t.className === f.className) {
                    // only touch tasks that don't already have a strict preferredDay
                    if (!t.preferredDay || t.preferredDay === 'Any') {
                        t.preferredDay = f.day;
                        remaining--;
                    }
                }
            }
            // if we couldn't assign all forced slots we'll rely on normal failure
            // reporting later; no extra action needed here.
        });
    }

    // ============ PRIORITY SORTING ============
    const getGradeNum = (className) => {
        const match = className.match(/^(\d+)/);
        return match ? parseInt(match[1]) : 0;
    };

    allTasks.sort((a, b) => {
        const getTaskPriorityScore = (t) => {
            // Priority 1: Fixed Day
            if (t.preferredDay && t.preferredDay !== 'Any') return 1;
            // Priority 2: Block Periods
            if (t.type === 'BLOCK') return 2;
            // Priority 3: Streams (Parallel)
            if (t.type === 'STREAM') return 3;
            // Priority 4: Single Periods
            return 4;
        };

        const pa = getTaskPriorityScore(a);
        const pb = getTaskPriorityScore(b);

        if (pa !== pb) return pa - pb;

        // Same priority level: Sort by grade level DESCENDING (12 down to 6)
        const ga = getGradeNum(a.className || '');
        const gb = getGradeNum(b.className || '');
        return gb - ga;
    });

    const isBuildingConstraintViolated = (teacher, day, period, className) => {
        const targetBuilding = getBuilding(className);
        const tTT = teacherTimetables[teacher]?.[day];
        if (!tTT) return false;

        const checkAdj = (adjP) => {
            const slot = tTT[adjP];
            if (slot && typeof slot === 'object' && slot.className) {
                const adjBuilding = getBuilding(slot.className);
                if (adjBuilding && adjBuilding !== targetBuilding) return true;
            }
            return false;
        };

        // Static adjacent pairs with no physical gaps
        if (period === 'P1' && checkAdj('P2')) return true;
        if (period === 'P2' && checkAdj('P1')) return true;
        if (period === 'P4' && checkAdj('P5')) return true;
        if (period === 'P5') { if (checkAdj('P4')) return true; if (checkAdj('P6')) return true; }
        if (period === 'P6' && checkAdj('P5')) return true;

        if (period === 'P8') {
            const p9 = tTT['P9'];
            if (p9 && typeof p9 === 'object' && getBuilding(p9.className) === 'Senior' && targetBuilding !== 'Senior') return true;
        }
        if (period === 'P9') {
            const level = getLevel(className);
            if (level === 'Senior') {
                if (checkAdj('P8')) return true;
                const p10 = tTT['P10'];
                if (p10 && typeof p10 === 'object' && getBuilding(p10.className) === 'Main' && targetBuilding !== 'Main') return true;
            }
        }
        if (period === 'P10') {
            const level = getLevel(className);
            if (level === 'Main') {
                if (checkAdj('P11')) return true;
                const p9 = tTT['P9'];
                if (p9 && typeof p9 === 'object' && getBuilding(p9.className) === 'Senior' && targetBuilding !== 'Senior') return true;
            }
        }
        if (period === 'P11') {
            const p10 = tTT['P10'];
            if (p10 && typeof p10 === 'object' && getBuilding(p10.className) === 'Main' && targetBuilding !== 'Main') return true;
        }
        return false;
    };

    // ============ PLACEMENT ENGINE ============
    allTasks.forEach((task, taskIdx) => {
        let placed = false;
        // by default, only weekdays are considered unless the task explicitly
        // requests a specific day (including Saturday).
        let candidateDays = [...WEEKDAYS];
        const dayMap = { 'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday', 'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday' };

        if (task.preferredDay && task.preferredDay !== 'Any') {
            const targetDay = dayMap[task.preferredDay] || task.preferredDay;
            // if preferred day is Saturday we must override the weekday restriction
            if (targetDay === 'Saturday') {
                candidateDays = ['Saturday'];
            } else {
                candidateDays = candidateDays.filter(d => d === targetDay);
            }
        }

        const dayStart = candidateDays.length > 1 ? Math.floor(Math.random() * candidateDays.length) : 0;

        // Multi-pass placement strategy:
        // Pass 1: Ideal (Free slots + No subject clustering + Under 6 periods)
        // Pass 2: Relax subject clustering, still respect 6 periods
        // Pass 3: Fallback (Current logic)

        const isSubjectOnDay = (day) => {
            const tTT = teacherTimetables[task.teacher]?.[day];
            if (!tTT) return false;
            const targetSub = (task.subject || '').toUpperCase();
            return Object.values(tTT).some(s =>
                s && typeof s === 'object' &&
                s.className === task.className &&
                (s.subject || '').toUpperCase() === targetSub
            );
        };

        const getTeacherLoad = (day) => teacherTimetables[task.teacher]?.[day]?.periodCount || 0;

        for (let pass = 1; pass <= 3 && !placed; pass++) {
            // Pass 1: Ideal Spread: No clustering (max 1 of same subject per day, NO singles on block days)
            // Pass 2: Relaxed Clustering: Max 2 units (e.g. 1 block + 0 singles, or 0 blocks + 2 singles)
            // Pass 3: Final Fallback: As much as fits within daily load limit of 6

            for (let d = 0; d < candidateDays.length && !placed; d++) {
                const day = candidateDays[(dayStart + d) % candidateDays.length];
                const currentLoad = getTeacherLoad(day);
                const alreadyOnDay = isSubjectOnDay(day);

                if (task.type === 'BLOCK') {
                    if (pass === 1 && alreadyOnDay) continue;
                    if (currentLoad + 2 > 6) continue;

                    const pairs = getBlockPairs(task.className);
                    for (const [p1, p2] of pairs) {
                        const teacherFree = teacherTimetables[task.teacher][day][p1] === '' && teacherTimetables[task.teacher][day][p2] === '';
                        const bConf = isBuildingConstraintViolated(task.teacher, day, p1, task.className) ||
                            isBuildingConstraintViolated(task.teacher, day, p2, task.className);
                        const classesFree = task.classes.every(cn => classTimetables[cn][day][p1].subject === '' && classTimetables[cn][day][p2].subject === '');
                        const labsFree = !task.classes.some(cn => detectLabConflict(classTimetables, cn, day, p1, task.labGroup, task.subject)) &&
                            !task.classes.some(cn => detectLabConflict(classTimetables, cn, day, p2, task.labGroup, task.subject));

                        if (teacherFree && !bConf && classesFree && labsFree) {
                            placeTask(task, day, p1, true);
                            placeTask(task, day, p2, true);
                            placed = true;
                            placedPeriods += 2; // block occupies two periods for the teacher
                            break;
                        }
                    }
                } else if (task.type === 'STREAM') {
                    // Streams are handled slightly differently but let's apply load limits
                    if (currentLoad + 1 > 6) continue;

                    const availableSlots = getAvailableSlots(task.className);
                    const pStart = Math.floor(Math.random() * availableSlots.length);
                    for (let pIdx = 0; pIdx < availableSlots.length; pIdx++) {
                        const period = availableSlots[(pStart + pIdx) % availableSlots.length];
                        const teachersFree = task.subjects.every(s => {
                            const tName = s.teacher ? s.teacher.trim() : '';
                            return teacherTimetables[tName] && teacherTimetables[tName][day][period] === '';
                        });
                        const bConf = task.subjects.some(s => isBuildingConstraintViolated(s.teacher.trim(), day, period, task.className));
                        const classFree = classTimetables[task.className][day][period].subject === '';
                        const labConflict = task.subjects.some(s => detectLabConflict(classTimetables, task.className, day, period, s.labGroup, s.subject));

                        if (teachersFree && !bConf && classFree && !labConflict) {
                            placeStreamTask(task, day, period);
                            placed = true;
                            // count one period for each teacher in stream
                            placedPeriods += task.subjects.length;
                            break;
                        }
                    }
                } else { // SINGLE
                    if (pass === 1 && alreadyOnDay) continue;
                    if (pass === 2 && currentLoad >= 2 && alreadyOnDay) continue; // Allow max 2 units per subject per day if clustered in pass 2
                    if (currentLoad + 1 > 6) continue;

                    const availableSlots = getAvailableSlots(task.className);
                    const pStart = Math.floor(Math.random() * availableSlots.length);
                    for (let pIdx = 0; pIdx < availableSlots.length; pIdx++) {
                        const period = availableSlots[(pStart + pIdx) % availableSlots.length];
                        const teacherFree = teacherTimetables[task.teacher][day][period] === '';
                        const bConf = isBuildingConstraintViolated(task.teacher, day, period, task.className);
                        const classesFree = task.classes.every(cn => classTimetables[cn][day][period].subject === '');
                        const labFree = !task.classes.some(cn => detectLabConflict(classTimetables, cn, day, period, task.labGroup, task.subject));

                        if (teacherFree && !bConf && classesFree && labFree) {
                            placeTask(task, day, period, false);
                            placed = true;
                            placedPeriods += 1;
                            break;
                        }
                    }
                }
            }
        }

        // Fallback for conflicts
        if (!placed) {
            // record failure before forcing placement
            const periodsForTask = task.type === 'BLOCK' ? 2 : (task.type === 'STREAM' ? task.subjects.length : 1);
            failedPeriods += periodsForTask;
            // choose a day respecting candidateDays if possible
            let fdDay;
            if (candidateDays && candidateDays.length > 0) {
                fdDay = candidateDays[taskIdx % candidateDays.length];
            } else {
                fdDay = days[taskIdx % days.length];
            }
            const availableSlots = getAvailableSlots(task.className);
            const fdPeriod = availableSlots[(taskIdx % availableSlots.length)];
            const reasonMsg = (task.preferredDay === 'Saturday')
                ? `Could not place forced Saturday; fallback on ${fdDay} ${fdPeriod}`
                : `Fallback placement on ${fdDay} ${fdPeriod}`;
            failedTasks.push({
                teacher: task.teacher || '',
                subject: task.subject || task.name || '',
                className: task.className,
                periods: periodsForTask,
                reason: reasonMsg
            });
            if (task.type === 'STREAM') placeStreamTask(task, fdDay, fdPeriod);
            else placeTask(task, fdDay, fdPeriod, task.type === 'BLOCK');
            // preference violation on forced fallback
            if (task.preferredDay && task.preferredDay !== 'Any' && task.preferredDay !== fdDay) {
                preferenceViolations.push({
                    teacher: task.teacher || '',
                    subject: task.subject || task.name || '',
                    className: task.className,
                    violationType: 'Preferred Day',
                    details: `Scheduled on ${fdDay} instead of preferred ${task.preferredDay}`
                });
            }
            // still count periods as placed since we force-filled
            if (task.type === 'BLOCK') placedPeriods += 2;
            else if (task.type === 'STREAM') placedPeriods += task.subjects.length;
            else placedPeriods += 1;
        }
    });

    function placeTask(task, day, period, isBlock) {
        // log preference violation if day differs from preferred
        if (task.preferredDay && task.preferredDay !== 'Any' && task.preferredDay !== day) {
            preferenceViolations.push({
                teacher: task.teacher || '',
                subject: task.subject,
                className: task.className,
                violationType: 'Preferred Day',
                details: `Scheduled on ${day} instead of preferred ${task.preferredDay}`
            });
        }
        // mark slot as forced saturday if this task was directed there
        const forcedSat = day === 'Saturday' && task.preferredDay === 'Saturday';
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
                isLabPeriod: isLab,
                otherClasses: task.classes.filter(c => c !== cn),
                ...(forcedSat ? { isForcedSaturday: true } : {})
            };
        });
        teacherTimetables[task.teacher][day][period] = {
            className: task.classes.join('/'),
            subject: task.subject,
            isBlock: isBlock,
            labGroup: task.labGroup || 'None',
            targetLabCount: task.targetLabCount,
            isLabPeriod: isLab,
            ...(forcedSat ? { isForcedSaturday: true } : {})
        };
        teacherTimetables[task.teacher][day].periodCount += 1; // Fixed: Only 1 period for the teacher
        teacherTimetables[task.teacher].weeklyPeriods += 1;     // Fixed: Only 1 period for the teacher
    }

    function placeStreamTask(task, day, period) {
        // each stream has multiple teachers; check each for preferred day
        task.subjects.forEach(s => {
            if (s.preferredDay && s.preferredDay !== 'Any' && s.preferredDay !== day) {
                preferenceViolations.push({
                    teacher: s.teacher || '',
                    subject: s.subject,
                    className: task.className,
                    violationType: 'Preferred Day',
                    details: `Scheduled on ${day} instead of preferred ${s.preferredDay}`
                });
            }
        });
        const abbr = getAbbreviation(task.name);
        const forcedSat = day === 'Saturday' && task.preferredDay === 'Saturday';
        if (classTimetables[task.className]) {
            classTimetables[task.className][day][period] = {
                subject: abbr,
                isStream: true,
                streamName: task.name,
                subjects: task.subjects,
                ...(forcedSat ? { isForcedSaturday: true } : {})
            };
        }

        task.subjects.forEach(s => {
            const tName = s.teacher ? s.teacher.trim() : '';
            const labStatusData = { className: task.className, subject: s.subject, labGroup: s.labGroup || 'None', targetLabCount: s.targetLabCount };
            const isLab = determineLabStatus(classTimetables, labStatusData, day, period);

            teacherTimetables[tName][day][period] = {
                className: task.className,
                subject: s.subject,
                fullSubject: s.subject,
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

            teacherTimetables[tName][day].periodCount++;
            teacherTimetables[tName].weeklyPeriods++;
        });
    }

    // ============ POPULATE LAB TIMETABLES ============
    const labTimetables = {};
    Object.values(LAB_SYSTEM).forEach(name => {
        labTimetables[name] = {};
        days.forEach(day => {
            labTimetables[name][day] = {};
            allPeriods.forEach(p => {
                labTimetables[name][day][p] = '-';
            });
        });
    });

    Object.keys(classTimetables).forEach(cn => {
        days.forEach(day => {
            allPeriods.forEach(p => {
                const slot = classTimetables[cn][day][p];
                if (slot && slot.isLabPeriod) {
                    const lab = getLabForSubject(cn, slot.fullSubject || slot.subject);
                    if (lab && labTimetables[lab]) {
                        labTimetables[lab][day][p] = cn;
                    }
                }
                if (slot && slot.isStream && slot.subjects) {
                    slot.subjects.forEach(s => {
                        if (s.isLabPeriod) {
                            const lab = getLabForSubject(cn, s.subject);
                            if (lab && labTimetables[lab]) {
                                labTimetables[lab][day][p] = cn;
                            }
                        }
                    });
                }
            });
        });
    });

    return {
        teacherTimetables,
        classTimetables,
        labTimetables,
        errors: [],
        report: {
            placedPeriods,
            failedPeriods,
            failedTasks,
            preferenceViolations
        }
    };
};
