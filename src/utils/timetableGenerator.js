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

    mappings.forEach((mapping, index) => {
        const teacher = mapping.teacher;
        const subject = mapping.subject;

        // Get classes array (handle both property names)
        const classes = mapping.selectedClasses || mapping.classes || [];

        if (!teacher || !subject) {
            console.log(`  ⚠️ Mapping ${index} missing teacher/subject, skipping`);
            skippedMappings++;
            return;
        }

        if (classes.length === 0) {
            console.log(`  ⚠️ ${teacher} - ${subject} has no classes, skipping`);
            skippedMappings++;
            return;
        }

        console.log(`📋 Processing ${teacher} - ${subject} (${classes.length} classes)`);

        // Build a flat list of allocation units taking merged groups into account
        const allocations = [];
        const mergedForSubject = (distribution && distribution.__merged && distribution.__merged[subject]) || [];
        const handledClasses = new Set();

        // handle groups first
        mergedForSubject.forEach(g => {
            // find intersection with this mapping's classes
            const overlap = g.classes.filter(c => classes.includes(c));
            if (overlap.length > 0) {
                for (let t = 0; t < g.total; t++) {
                    // use first class name as representative
                    allocations.push({ className: overlap[0], group: g, classes: overlap });
                }
                overlap.forEach(c => handledClasses.add(c));
            }
        });

        // handle remaining individual classes using their distribution value
        classes.forEach(c => {
            if (handledClasses.has(c)) return;
            const v = (distribution && distribution[c] && distribution[c][subject]) || 0;
            for (let t = 0; t < v; t++) {
                allocations.push({ className: c, group: null, classes: [c] });
            }
        });

        // Perform allocations based on the expanded list
        allocations.forEach((alloc, allocIdx) => {
            const dayIndex = (totalAllocations + allocIdx) % days.length;
            const periodIndex = (totalAllocations + allocIdx) % 8; // 0-7 for P1-P8

            const day = days[dayIndex];
            const period = `P${periodIndex + 1}`;
            const className = alloc.className;

            // SAFETY CHECK: Ensure class exists
            if (!classTimetables[className]) {
                console.warn(`  ⚠️ Class ${className} not found, creating...`);
                classTimetables[className] = {};
                days.forEach(d => {
                    classTimetables[className][d] = {
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
            if (!classTimetables[className][day]) {
                console.warn(`  ⚠️ Class ${className} missing day ${day}, creating...`);
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
            }

            // Place in class timetable; if this is a merged group allocation, fill every class
            alloc.classes.forEach(cn => {
                if (!classTimetables[cn]) return;
                // ensure day record exists (should)
                classTimetables[cn][day][period] = {
                    subject: getAbbreviation(subject),
                    teacher: teacher,
                    fullSubject: subject
                };
            });

            // SAFETY CHECK: Ensure teacher exists
            if (!teacherTimetables[teacher]) {
                console.warn(`  ⚠️ Teacher ${teacher} not found, creating...`);
                teacherTimetables[teacher] = {};
                days.forEach(d => {
                    teacherTimetables[teacher][d] = {
                        CT: '', P1: '', P2: '', P3: '', P4: '', P5: '', P6: '', P7: '', P8: '',
                        periodCount: 0
                    };
                });
                teacherTimetables[teacher].weeklyPeriods = 0;
            }

            // SAFETY CHECK: Ensure day exists for teacher
            if (!teacherTimetables[teacher][day]) {
                console.warn(`  ⚠️ Teacher ${teacher} missing day ${day}, creating...`);
                teacherTimetables[teacher][day] = {
                    CT: '', P1: '', P2: '', P3: '', P4: '', P5: '', P6: '', P7: '', P8: '',
                    periodCount: 0
                };
            }

            // Place in teacher timetable; show all target classes separated by '/'
            teacherTimetables[teacher][day][period] = alloc.classes.join('/');
            teacherTimetables[teacher][day].periodCount =
                (teacherTimetables[teacher][day].periodCount || 0) + 1;
            teacherTimetables[teacher].weeklyPeriods =
                (teacherTimetables[teacher].weeklyPeriods || 0) + 1;
        });

        totalAllocations += allocations.length;
    });

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
