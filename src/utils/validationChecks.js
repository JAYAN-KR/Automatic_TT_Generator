// validationChecks.js
// Contains utilities to validate a generated timetable against scheduling rules.

// Copies helper logic from timetableGenerator for level/building detection.
export const getLevel = (className) => {
    const grade = parseInt(className) || 0;
    return grade >= 9 ? 'Senior' : 'Middle';
};

export const getBuilding = (className) => {
    if (!className) return null;
    const grade = parseInt(className.split('/')[0]) || 0;
    return (grade >= 11) ? 'Senior' : 'Main';
};

const allPeriods = ['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11'];
const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// run all checks and return an array of violation objects
export function runValidationChecks({ classTimetables, teacherTimetables, labTimetables }) {
    const violations = [];

    // A. Teacher Daily Load Check
    Object.entries(teacherTimetables).forEach(([teacher, tt]) => {
        days.forEach(day => {
            const slots = tt[day] || {};
            let count = 0;
            allPeriods.forEach(p => {
                const slot = slots[p];
                if (slot && typeof slot === 'object' && slot.subject && slot.subject !== 'BREAK' && slot.subject !== 'LUNCH') {
                    count += 1;
                }
            });
            if (count > 6) {
                violations.push({
                    teacher,
                    subject: '',
                    className: '',
                    violationType: 'Daily Load',
                    details: `${count} periods on ${day} (exceeds max 6)`
                });
            }
        });
    });

    // B. Consecutive Period Check
    Object.entries(teacherTimetables).forEach(([teacher, tt]) => {
        days.forEach(day => {
            const slots = tt[day] || {};
            let seq = [];
            allPeriods.forEach(p => {
                const slot = slots[p];
                const isBreak = !slot || slot.subject === 'BREAK' || slot.subject === 'LUNCH' || slot.subject === '';
                if (!isBreak) {
                    seq.push(p);
                } else {
                    if (seq.length >= 4) {
                        violations.push({
                            teacher,
                            subject: '',
                            className: '',
                            violationType: '4+ Consecutive',
                            details: `${seq.length} consecutive periods on ${day} (${seq.join(',')})`
                        });
                    }
                    seq = [];
                }
            });
            if (seq.length >= 4) {
                violations.push({
                    teacher,
                    subject: '',
                    className: '',
                    violationType: '4+ Consecutive',
                    details: `${seq.length} consecutive periods on ${day} (${seq.join(',')})`
                });
            }
        });
    });

    // C. Building Transition Check
    Object.entries(teacherTimetables).forEach(([teacher, tt]) => {
        days.forEach(day => {
            const slots = tt[day] || {};
            for (let i = 0; i < allPeriods.length - 1; i++) {
                const p1 = allPeriods[i];
                const p2 = allPeriods[i+1];
                const slot1 = slots[p1];
                const slot2 = slots[p2];
                if (slot1 && slot2 && slot1.className && slot2.className) {
                    const b1 = getBuilding(slot1.className);
                    const b2 = getBuilding(slot2.className);
                    const isBreak1 = slot1.subject === 'BREAK' || slot1.subject === 'LUNCH' || slot1.subject === '';
                    const isBreak2 = slot2.subject === 'BREAK' || slot2.subject === 'LUNCH' || slot2.subject === '';
                    if (!isBreak1 && !isBreak2 && b1 && b2 && b1 !== b2) {
                        violations.push({
                            teacher,
                            subject: slot2.subject || '',
                            className: slot2.className,
                            violationType: 'Building Switch',
                            details: `${b1} Block (${p1}) → ${b2} Block (${p2}) with no break`
                        });
                    }
                }
            }
        });
    });

    // D. Multiple Blocks Same Day Check
    Object.entries(teacherTimetables).forEach(([teacher, tt]) => {
        days.forEach(day => {
            const slots = tt[day] || {};
            const blockMap = {};
            allPeriods.forEach(p => {
                const slot = slots[p];
                if (slot && slot.isBlock) {
                    const key = `${slot.className}||${slot.subject}`;
                    blockMap[key] = (blockMap[key] || 0) + 1;
                }
            });
            Object.entries(blockMap).forEach(([key, count]) => {
                if (count > 2) {
                    const [className, subject] = key.split('||');
                    violations.push({
                        teacher,
                        subject,
                        className,
                        violationType: 'Double Block',
                        details: `Two block periods of ${subject} for ${className} on ${day}`
                    });
                }
            });
        });
    });

    // E. Lab Resource Conflicts (use labTimetables if provided)
    if (labTimetables) {
        Object.entries(labTimetables).forEach(([lab, lt]) => {
            days.forEach(day => {
                const slots = lt[day] || {};
                allPeriods.forEach(p => {
                    const cls = slots[p];
                    if (cls && cls !== '-' && Array.isArray(cls)) {
                        // if the entry is array of classes, conflict
                        if (cls.length > 1) {
                            violations.push({
                                teacher: '',
                                subject: '',
                                className: cls.join(', '),
                                violationType: 'Lab Conflict',
                                details: `${lab} used by ${cls.join(' and ')} at ${day} ${p}`
                            });
                        }
                    }
                });
            });
        });
    }

    // F. Teacher Availability (double assignment)
    Object.entries(teacherTimetables).forEach(([teacher, tt]) => {
        days.forEach(day => {
            const slots = tt[day] || {};
            allPeriods.forEach(p => {
                const slot = slots[p];
                if (slot && slot.className && slot.className.includes('/')) {
                    // if there are two different class names separated by slash
                    const parts = slot.className.split('/').map(x=>x.trim()).filter(Boolean);
                    if (parts.length > 1) {
                        violations.push({
                            teacher,
                            subject: slot.subject || '',
                            className: slot.className,
                            violationType: 'Teacher Availability',
                            details: `Assigned to multiple classes (${slot.className}) at ${day} ${p}`
                        });
                    }
                }
            });
        });
    });

    // G. Class Double-Booking Check
    Object.entries(classTimetables).forEach(([className, ct]) => {
        days.forEach(day => {
            const slots = ct[day] || {};
            allPeriods.forEach(p => {
                const slot = slots[p];
                if (slot && slot.subject && slot.subject !== '' && slot.subject !== 'BREAK' && slot.subject !== 'LUNCH') {
                    // cannot be double-booked by structure, but we can log if teacher field contains '/'
                    if (slot.teacher && slot.teacher.includes('/')) {
                        violations.push({
                            teacher: slot.teacher,
                            subject: slot.subject,
                            className,
                            violationType: 'Class Double Booking',
                            details: `Multiple teachers assigned at ${day} ${p}`
                        });
                    }
                }
            });
        });
    });

    // H. Block Integrity Check (blocks should be consecutive)
    Object.entries(classTimetables).forEach(([className, ct]) => {
        days.forEach(day => {
            const slots = ct[day] || {};
            allPeriods.forEach((p, idx) => {
                const slot = slots[p];
                if (slot && slot.isBlock) {
                    // find adjacent period
                    const next = allPeriods[idx+1];
                    if (next) {
                        const nextSlot = slots[next];
                        if (!nextSlot || !nextSlot.isBlock || nextSlot.subject !== slot.subject) {
                            violations.push({
                                teacher: slot.teacher || '',
                                subject: slot.subject,
                                className,
                                violationType: 'Block Integrity',
                                details: `Block for ${slot.subject} at ${day} ${p} is not consecutive`
                            });
                        }
                    }
                }
            });
        });
    });

    return violations;
}
