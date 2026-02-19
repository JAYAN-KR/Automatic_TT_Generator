// Period Distribution Store - 47 COLUMN VERSION
// Tracks period counts for each subject for EACH of 47 classrooms

// ============ ALL 47 CLASSROOMS ============
export const ALL_CLASSES = [
    // Grade 6 (7 sections)
    '6A', '6B', '6C', '6D', '6E', '6F', '6G',
    // Grade 7 (7 sections)
    '7A', '7B', '7C', '7D', '7E', '7F', '7G',
    // Grade 8 (7 sections)
    '8A', '8B', '8C', '8D', '8E', '8F', '8G',
    // Grade 9 (7 sections)
    '9A', '9B', '9C', '9D', '9E', '9F', '9G',
    // Grade 10 (7 sections)
    '10A', '10B', '10C', '10D', '10E', '10F', '10G',
    // Grade 11 (6 sections)
    '11A', '11B', '11C', '11D', '11E', '11F',
    // Grade 12 (6 sections)
    '12A', '12B', '12C', '12D', '12E', '12F'
];

// ============ DEFAULT VALUES ============
export const getDefaultDistribution = () => {
    const dist = {};

    ALL_CLASSES.forEach(className => {
        dist[className] = {};
    });

    return dist;
};

// Default period counts per subject per class
export const DEFAULT_SUBJECT_VALUES = {
    'ENGLISH': { default: 5, grade6: 5, grade7: 6, grade8: 6, grade9: 5, grade10: 5, grade11: 5, grade12: 5 },
    'MATHEMATICS': { default: 5, grade6: 5, grade7: 5, grade8: 5, grade9: 5, grade10: 5, grade11: 5, grade12: 5 },
    'PHYSICS': { default: 0, grade9: 3, grade10: 3, grade11: 4, grade12: 4 },
    'CHEMISTRY': { default: 0, grade9: 3, grade10: 3, grade11: 4, grade12: 4 },
    'BIOLOGY': { default: 0, grade9: 3, grade10: 3, grade11: 4, grade12: 4 },
    'HISTORY': { default: 2, grade6: 2, grade7: 2, grade8: 2, grade9: 3, grade10: 3, grade11: 0, grade12: 0 },
    'GEOGRAPHY': { default: 2, grade6: 2, grade7: 2, grade8: 2, grade9: 3, grade10: 3, grade11: 0, grade12: 0 },
    'COMPUTER SCIENCE': { default: 1, grade6: 1, grade7: 1, grade8: 1, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'ACCOUNTANCY': { default: 0, grade11: 4, grade12: 4 },
    'BUSINESS': { default: 0, grade11: 4, grade12: 4 },
    'ECONOMICS': { default: 0, grade11: 4, grade12: 4 },
    'PSYCHOLOGY': { default: 0, grade11: 4, grade12: 4 },
    'SOCIOLOGY': { default: 0, grade11: 4, grade12: 4 },
    'LANGUAGE': { default: 4, grade6: 4, grade7: 4, grade8: 4, grade9: 3, grade10: 3, grade11: 3, grade12: 3 },
    'MALAYALAM': { default: 3, grade6: 3, grade7: 3, grade8: 3, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'HINDI': { default: 3, grade6: 3, grade7: 3, grade8: 3, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'PHYSICAL EDUCATION': { default: 2, grade6: 2, grade7: 2, grade8: 2, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'ART EDUCATION': { default: 1, grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 0, grade12: 0 },
    'MUSIC': { default: 1, grade6: 1, grade7: 1, grade8: 1, grade9: 0, grade10: 0, grade11: 0, grade12: 0 },
    'WORK EXPERIENCE': { default: 1, grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 0, grade12: 0 },
    'CLASS TEACHER TIME': { default: 1, grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 1, grade12: 1 },
    'SKILL': { default: 0, grade9: 2, grade10: 2 },
    'STEM': { default: 1, grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 0, grade12: 0 }
};

// ============ BACKWARD COMPATIBILITY ============
// timetableGenerator.js imports this
export const defaultPeriodDistribution = {
    'ENGLISH': { grade6: 5, grade7: 6, grade8: 6, grade9: 5, grade10: 5, grade11: 5, grade12: 5 },
    'MATHEMATICS': { grade6: 5, grade7: 5, grade8: 5, grade9: 5, grade10: 5, grade11: 5, grade12: 5 },
    'PHYSICS': { grade6: 0, grade7: 0, grade8: 0, grade9: 3, grade10: 3, grade11: 4, grade12: 4 },
    'CHEMISTRY': { grade6: 0, grade7: 0, grade8: 0, grade9: 3, grade10: 3, grade11: 4, grade12: 4 },
    'BIOLOGY': { grade6: 0, grade7: 0, grade8: 0, grade9: 3, grade10: 3, grade11: 4, grade12: 4 },
    'HISTORY': { grade6: 2, grade7: 2, grade8: 2, grade9: 3, grade10: 3, grade11: 0, grade12: 0 },
    'GEOGRAPHY': { grade6: 2, grade7: 2, grade8: 2, grade9: 3, grade10: 3, grade11: 0, grade12: 0 },
    'COMPUTER SCIENCE': { grade6: 1, grade7: 1, grade8: 1, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'LANGUAGE': { grade6: 4, grade7: 4, grade8: 4, grade9: 3, grade10: 3, grade11: 3, grade12: 3 },
    'MALAYALAM': { grade6: 3, grade7: 3, grade8: 3, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'HINDI': { grade6: 3, grade7: 3, grade8: 3, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'PHYSICAL EDUCATION': { grade6: 2, grade7: 2, grade8: 2, grade9: 2, grade10: 2, grade11: 2, grade12: 2 },
    'ART EDUCATION': { grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 0, grade12: 0 },
    'MUSIC': { grade6: 1, grade7: 1, grade8: 1, grade9: 0, grade10: 0, grade11: 0, grade12: 0 },
    'WORK EXPERIENCE': { grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 0, grade12: 0 },
    'CLASS TEACHER TIME': { grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 1, grade12: 1 },
    'SKILL': { grade6: 0, grade7: 0, grade8: 0, grade9: 2, grade10: 2, grade11: 0, grade12: 0 },
    'STEM': { grade6: 1, grade7: 1, grade8: 1, grade9: 1, grade10: 1, grade11: 0, grade12: 0 }
};

// ============ LOAD / SAVE ============
export const loadDistribution = () => {
    const saved = localStorage.getItem('periodDistribution47');
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error('Error loading distribution', e);
        }
    }

    // Initialize empty distribution
    const distribution = {};

    ALL_CLASSES.forEach(className => {
        distribution[className] = {};
    });

    return distribution;
};

export const saveDistribution = (distribution) => {
    localStorage.setItem('periodDistribution47', JSON.stringify(distribution));
    return distribution;
};

// ============ GET / SET VALUES ============
export const getValue = (distribution, subject, className) => {
    if (distribution[className] && distribution[className][subject] !== undefined) {
        return distribution[className][subject];
    }
    return 0;
};

export const setValue = (distribution, subject, className, value) => {
    if (!distribution[className]) {
        distribution[className] = {};
    }
    distribution[className][subject] = parseInt(value) || 0;
    return distribution;
};

// ============ BULK OPERATIONS ============
export const setBulkValues = (distribution, subject, classList, value) => {
    classList.forEach(className => {
        if (!distribution[className]) {
            distribution[className] = {};
        }
        distribution[className][subject] = parseInt(value) || 0;
    });
    return distribution;
};

// ============ SUBJECT MANAGEMENT ============
export const getAllSubjects = (distribution) => {
    const subjects = new Set();

    Object.keys(distribution).forEach(className => {
        Object.keys(distribution[className]).forEach(subject => {
            subjects.add(subject);
        });
    });

    return Array.from(subjects).sort();
};

export const addSubject = (distribution, subjectName) => {
    // Subject will be added when first value is set
    return distribution;
};

export const renameSubject = (distribution, oldName, newName) => {
    if (oldName === newName) return distribution;

    Object.keys(distribution).forEach(className => {
        if (distribution[className][oldName] !== undefined) {
            distribution[className][newName] = distribution[className][oldName];
            delete distribution[className][oldName];
        }
    });

    return distribution;
};

export const deleteSubject = (distribution, subjectName) => {
    Object.keys(distribution).forEach(className => {
        delete distribution[className][subjectName];
    });
    return distribution;
};

// ============ AUTO-SYNC FROM MAPPINGS ============
export const syncSubjectsFromMappings = (distribution, mappings) => {
    console.log('🔄 Syncing subjects from mappings to distribution...');

    if (!mappings || !Array.isArray(mappings)) {
        console.log('No mappings to sync');
        return distribution;
    }

    const newDistribution = JSON.parse(JSON.stringify(distribution));
    let changed = false;
    let addedCount = 0;

    mappings.forEach(mapping => {
        const subject = mapping.subject;
        if (!subject || subject.trim() === '') return;

        // Get classes from either selectedClasses or classes property
        const classes = mapping.selectedClasses || mapping.classes || [];
        classes.forEach(className => {
            if (!newDistribution[className]) {
                newDistribution[className] = {};
            }
            if (newDistribution[className][subject] === undefined) {
                newDistribution[className][subject] = 0;
                changed = true;
                addedCount++;
                console.log(`✅ Added subject "${subject}" to ${className}`);
            }
        });
    });

    // Also ensure subject appears in ALL classes where it might be needed
    // This is for subjects that should be available for all classes of a grade
    ALL_CLASSES.forEach(className => {
        mappings.forEach(mapping => {
            const subject = mapping.subject;
            if (!subject || subject.trim() === '') return;

            // If this subject exists in ANY class of same grade, add to all classes of that grade
            const grade = className.match(/\d+/)[0];
            const subjectExistsInGrade = mappings.some(m =>
                m.subject === subject &&
                (m.selectedClasses || m.classes || []).some(c => c.startsWith(grade))
            );

            if (subjectExistsInGrade) {
                if (!newDistribution[className]) {
                    newDistribution[className] = {};
                }
                if (newDistribution[className][subject] === undefined) {
                    newDistribution[className][subject] = 0;
                    changed = true;
                    addedCount++;
                    console.log(`✅ Added subject "${subject}" to all ${grade} classes`);
                }
            }
        });
    });

    if (changed) {
        console.log(`✅ Sync complete: Added ${addedCount} new subject-class entries`);
    } else {
        console.log('No new subjects to sync');
    }

    return changed ? newDistribution : distribution;
};

