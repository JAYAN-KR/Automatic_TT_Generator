import { getAbbreviation } from './subjectAbbreviations';

// Timetable Generation Engine
export const generateTimetable = (mappings, distribution, bellTimings) => {
    console.log('🔄 Starting timetable generation...', {
        mappingsCount: mappings?.length || 0
    });

    // ============ CONSTANTS ============
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = ['CT', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

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
    const teacherList = Array.from(teacherSet);
    console.log(`👩🏫 Found ${teacherList.length} unique teachers`);

    // ============ INITIALIZE DATA STRUCTURES SAFELY ============
    const classTimetables = {};
    const teacherTimetables = {};

    // Initialize ALL classes with empty schedules
    classList.forEach(className => {
        classTimetables[className] = {};
        days.forEach(day => {
            classTimetables[className][day] = {
                CT: { subject: '', teacher: '' },
                P1: { subject: '', teacher: '' },
                P2: { subject: '', teacher: '' },
                P3: { subject: '', teacher: '' },
                P4: { subject: '', teacher: '' },
                P5: { subject: '', teacher: '' },
                P6: { subject: '', teacher: '' },
                P7: { subject: '', teacher: '' },
                P8: { subject: '', teacher: '' }
            };
        });
    });

    // Initialize ALL teachers with empty schedules
    teacherList.forEach(teacher => {
        teacherTimetables[teacher] = {};
        days.forEach(day => {
            teacherTimetables[teacher][day] = {
                CT: '', P1: '', P2: '', P3: '', P4: '', P5: '', P6: '', P7: '', P8: '',
                periodCount: 0
            };
        });
        teacherTimetables[teacher].weeklyPeriods = 0;
    });

    console.log('📊 Initialized:', {
        classes: Object.keys(classTimetables).length,
        teachers: Object.keys(teacherTimetables).length
    });

    // ============ PROCESS MAPPINGS ============
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

                for (let t = 0; t < blocks; t++) {
                    allTasks.push({ type: 'BLOCK', teacher, subject, className: overlap[0], classes: overlap });
                }
                for (let t = 0; t < singles; t++) {
                    allTasks.push({ type: 'SINGLE', teacher, subject, className: overlap[0], classes: overlap });
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

            for (let t = 0; t < blocks; t++) {
                allTasks.push({ type: 'BLOCK', teacher, subject, className: c, classes: [c] });
            }
            for (let t = 0; t < singles; t++) {
                allTasks.push({ type: 'SINGLE', teacher, subject, className: c, classes: [c] });
            }
        });
    });

    // Sort tasks: BLOCKS first
    allTasks.sort((a, b) => (a.type === 'BLOCK' ? -1 : 1));
    console.log(`📋 Total tasks to place: ${allTasks.length} (${allTasks.filter(t => t.type === 'BLOCK').length} blocks)`);

    // ============ PLACEMENT ENGINE ============
    allTasks.forEach((task, taskIdx) => {
        let placed = false;

        // Randomize day search start to distribute better
        const dayStart = Math.floor(Math.random() * days.length);

        for (let d = 0; d < days.length && !placed; d++) {
            const day = days[(dayStart + d) % days.length];

            if (task.type === 'BLOCK') {
                const pairs = [['P1', 'P2'], ['P3', 'P4'], ['P5', 'P6'], ['P7', 'P8']];
                for (const [p1, p2] of pairs) {
                    const teacherFree = teacherTimetables[task.teacher][day][p1] === '' && teacherTimetables[task.teacher][day][p2] === '';
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
            } else {
                const periodList = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
                const pStart = Math.floor(Math.random() * 8);
                for (let p = 0; p < 8; p++) {
                    const period = periodList[(pStart + p) % 8];
                    const teacherFree = teacherTimetables[task.teacher][day][period] === '';
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
            console.warn(`  🔴 Conflict: No free slot for ${task.teacher} - ${task.subject} (${task.type}) - Forcing placement`);
            const day = days[taskIdx % days.length];
            const period = `P${(taskIdx % 8) + 1}`;
            placeTask(task, day, period, task.type === 'BLOCK');
            if (task.type === 'BLOCK') {
                const pIndex = Number(period.substring(1));
                const nextPeriod = `P${(pIndex % 8) + 1}`;
                placeTask(task, day, nextPeriod, true);
            }
        }
    });

    function placeTask(task, day, period, isBlock) {
        // Update Class Timetables
        task.classes.forEach(cn => {
            // SAFETY CHECK: Ensure class exists
            if (!classTimetables[cn]) {
                console.warn(`  ⚠️ Class ${cn} not found during placement, creating...`);
                classTimetables[cn] = {};
                days.forEach(d => {
                    classTimetables[cn][d] = {
                        CT: { subject: '', teacher: '' },
                        P1: { subject: '', teacher: '' },
                        P2: { subject: '', teacher: '' },
                        P3: { subject: '', teacher: '' },
                        P4: { subject: '', teacher: '' },
                        P5: { subject: '', teacher: '' },
                        P6: { subject: '', teacher: '' },
                        P7: { subject: '', teacher: '' },
                        P8: { subject: '', teacher: '' }
                    };
                });
            }
            // SAFETY CHECK: Ensure day exists for class
            if (!classTimetables[cn][day]) {
                console.warn(`  ⚠️ Class ${cn} missing day ${day} during placement, creating...`);
                classTimetables[cn][day] = {
                    CT: { subject: '', teacher: '' },
                    P1: { subject: '', teacher: '' },
                    P2: { subject: '', teacher: '' },
                    P3: { subject: '', teacher: '' },
                    P4: { subject: '', teacher: '' },
                    P5: { subject: '', teacher: '' },
                    P6: { subject: '', teacher: '' },
                    P7: { subject: '', teacher: '' },
                    P8: { subject: '', teacher: '' }
                };
            }

            classTimetables[cn][day][period] = {
                subject: getAbbreviation(task.subject),
                teacher: task.teacher,
                fullSubject: task.subject,
                isBlock: isBlock
            };
        });

        // Update Teacher Timetables
        // SAFETY CHECK: Ensure teacher exists
        if (!teacherTimetables[task.teacher]) {
            console.warn(`  ⚠️ Teacher ${task.teacher} not found during placement, creating...`);
            teacherTimetables[task.teacher] = {};
            days.forEach(d => {
                teacherTimetables[task.teacher][d] = {
                    CT: '', P1: '', P2: '', P3: '', P4: '', P5: '', P6: '', P7: '', P8: '',
                    periodCount: 0
                };
            });
            teacherTimetables[task.teacher].weeklyPeriods = 0;
        }
        // SAFETY CHECK: Ensure day exists for teacher
        if (!teacherTimetables[task.teacher][day]) {
            console.warn(`  ⚠️ Teacher ${task.teacher} missing day ${day} during placement, creating...`);
            teacherTimetables[task.teacher][day] = {
                CT: '', P1: '', P2: '', P3: '', P4: '', P5: '', P6: '', P7: '', P8: '',
                periodCount: 0
            };
        }

        teacherTimetables[task.teacher][day][period] = {
            className: task.classes.join('/'),
            isBlock: isBlock
        };
        teacherTimetables[task.teacher][day].periodCount++;
        teacherTimetables[task.teacher].weeklyPeriods++;
        totalAllocations++; // Increment total allocations here
    }

    console.log(`📊 Timetable Generation Completed Globaly`);

    console.log(`📊 Total allocations: ${totalAllocations}`);
    console.log(`⏭️ Skipped mappings: ${skippedMappings}`);

    // ============ VALIDATION ============
    const errors = [];

    // Check if any teachers have zero allocations
    teacherList.forEach(teacher => {
        if (teacherTimetables[teacher]?.weeklyPeriods === 0) {
            errors.push(`⚠️ Teacher ${teacher} has no periods assigned`);
        }
    });

    console.log('✅ Generation complete', {
        teachers: teacherList.length,
        allocations: totalAllocations,
        errors: errors.length
    });

    if (errors.length > 0) {
        console.warn('Validation errors:', errors);
    }

    return {
        teacherTimetables,
        classTimetables,
        errors
    };
};
