import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractSubjectsFromPDF } from '../utils/pdfExtractor';
import {
    generateTeacherTimetableHTML,
    generateClassTimetableHTML,
    generateFullPrintHTML
} from '../utils/timetablePrintLayout';
import { generateTimetable } from '../utils/timetableGenerator';
import { saveTimetableMappings, loadTimetableMappings, publishTimetableVersion, publishTimetableToAPK } from '../services/timetableFirestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import {
    ALL_CLASSES,
    loadDistribution,
    saveDistribution,
    getValue,
    setValue,
    setBulkValues,
    getAllSubjects,
    renameSubject,
    deleteSubject,
    syncSubjectsFromMappings,
    // merged group helpers
    addMergedGroup,
    removeMergedGroup,
    isClassMerged,
    getGroupForClass,
    getMergedGroups
} from '../utils/periodDistributionStore';

// component for feature experimentation
import FormatTTPreview from '../components/FormatTTPreview';

// --- Constants ---
const COMMON_SUBJECTS = [
    'ENGLISH', 'MATHEMATICS', 'PHYSICS', 'BIOLOGY', 'CHEMISTRY',
    'ACCOUNTANCY', 'HISTORY', 'GEOGRAPHY', 'ECONOMICS', 'BUSINESS STUDIES',
    'MALAYALAM', 'HINDI', 'SOCIAL SCIENCE', 'COMPUTER SCIENCE',
    'PHYSICAL EDUCATION', 'ART', 'WORK EXPERIENCE', 'SANSKRIT',
    'ARABIC', 'FRENCH', 'ENTREPRENEURSHIP', 'SOCIOLOGY', 'POLITICAL SCIENCE'
];

const TAB_GRADIENTS = [
    'linear-gradient(135deg, #0891b2, #06b6d4)', // Tab 1 (Cyan)
    'linear-gradient(135deg, #7e22ce, #9333ea)', // Tab 2 (Purple)
    'linear-gradient(135deg, #b45309, #d97706)', // Tab 3 (Orange)
    'linear-gradient(135deg, #059669, #10b981)', // Tab 4 (Green)
    'linear-gradient(135deg, #b91c1c, #dc2626)', // Tab 5 (Red)
];

const CLASSROOMS = [
    '6A', '6B', '6C', '6D', '6E', '6F', '6G',
    '7A', '7B', '7C', '7D', '7E', '7F', '7G',
    '8A', '8B', '8C', '8D', '8E', '8F', '8G',
    '9A', '9B', '9C', '9D', '9E', '9F', '9G',
    '10A', '10B', '10C', '10D', '10E', '10F', '10G',
    '11A', '11B', '11C', '11D', '11E', '11F',
    '12A', '12B', '12C', '12D', '12E', '12F'
];

// --- Timetable Cell Styles for 6A Template ---
function ttCellHeader(extra = {}) {
    return {
        border: '1px solid #64748b',
        background: '#0f172a',
        color: '#f1f5f9',
        fontWeight: 900,
        fontSize: '1.1em',
        textAlign: 'center',
        padding: '0.7em 0.3em',
        ...extra
    };
}
function ttCell(extra = {}) {
    return {
        border: '1px solid #64748b',
        background: '#1e293b',
        color: '#f1f5f9',
        fontWeight: 500,
        fontSize: '1.1em',
        textAlign: 'center',
        minWidth: 60,
        height: 44,
        ...extra
    };
}
function ttCellDay(extra = {}) {
    return {
        border: '1px solid #64748b',
        background: '#0f172a',
        color: '#fbbf24',
        fontWeight: 900,
        fontSize: '1.1em',
        textAlign: 'center',
        minWidth: 60,
        height: 44,
        ...extra
    };
}
function ttCellBreak(label, rowSpan) {
    return {
        border: '1px solid #64748b',
        background: '#1e293b',
        color: '#fbbf24',
        fontWeight: 900,
        fontSize: '1.1em',
        textAlign: 'center',
        minWidth: 60,
        height: 44 * rowSpan,
        verticalAlign: 'middle',
        ...((label === 'LUNCH BREAK') ? { color: '#38bdf8' } : {})
    };
}

// --- Subject Abbreviation Mapping ---
const SUBJECT_ABBR = {
    'ENGLISH': 'ENG',
    'HINDI': 'HIN',
    'FRENCH': 'FRE',
    'MALAYALAM': 'MAL',
    'SANSKRIT': 'SAN',
    'MATHEMATICS': 'MATH',
    'SCIENCE': 'SCI',
    'SOCIAL STUDIES': 'SST',
    'PAINTING': 'PTG',
    'COMPUTER APPLICATION': 'CA',
    'HOME SCIENCE': 'HSC',
    'ARTIFICIAL INTELLIGENCE': 'AI',
    'INTRODUCTION TO FINANCIAL MARKETS': 'IFM',
    'FOOD PRODUCTION': 'FP',
    'DATA SCIENCE': 'DS',
    'PHYSICS': 'PHY',
    'CHEMISTRY': 'CHE',
    'ACCOUNTANCY': 'ACC',
    'BUSINESS STUDIES': 'BUS',
    'SOCIOLOGY': 'SOC',
    'PSYCHOLOGY': 'PSY',
    'COMPUTER SCIENCE': 'CS',
    'BIOLOGY': 'BIO',
    'ECONOMICS': 'ECO',
    'HISTORY': 'HIS',
    'ENTREPRENEURSHIP': 'ENT',
    'INFORMATICS PRACTICES': 'IP',
    'LEGAL STUDIES': 'LEG',
    'APPLIED MATHEMATICS': 'APP M',
    'POLITICAL SCIENCE': 'POL SC',
    'PHYSICAL EDUCATION': 'PE',
    'SWIMMING': 'SWM',
    'MAJOR ARTS': 'MART',
    'MAJOR SPORTS': 'MSPT',
    'SKILL': 'SKL'
};

// --- Sub-components ---

/**
 * A beautiful simple dropdown for selecting Grade only (Dark Mode)
 */
const GradeDropdown = ({ onSelect, onClose, anchorRect }) => {
    const grades = [6, 7, 8, 9, 10, 11, 12];

    return (
        <div style={{
            position: 'fixed',
            top: anchorRect.bottom + 5,
            left: Math.min(anchorRect.left, window.innerWidth - 150),
            zIndex: 1000,
            background: '#1e293b',
            borderRadius: '0.75rem',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
            border: '1px solid #334155',
            padding: '0.5rem',
            width: '120px',
            animation: 'fadeInScale 0.15s ease-out'
        }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.2rem' }}>
                {grades.map(g => (
                    <button
                        key={g}
                        onClick={() => onSelect(g.toString())}
                        style={{
                            padding: '0.6rem',
                            border: 'none',
                            borderRadius: '0.4rem',
                            background: 'transparent',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            color: '#f1f5f9',
                            cursor: 'pointer',
                            transition: 'all 0.1s'
                        }}
                        onMouseOver={(e) => e.target.style.background = '#334155'}
                        onMouseOut={(e) => e.target.style.background = 'transparent'}
                    >
                        Grade {g}
                    </button>
                ))}
                <button
                    onClick={() => onSelect(null)}
                    style={{
                        padding: '0.6rem',
                        border: 'none',
                        borderRadius: '0.4rem',
                        background: 'transparent',
                        textAlign: 'left',
                        fontSize: '0.9rem',
                        fontWeight: '600',
                        color: '#f87171',
                        cursor: 'pointer'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#450a0a'}
                    onMouseOut={(e) => e.target.style.background = 'transparent'}
                >
                    Clear
                </button>
            </div>
            <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.95) translateY(-5px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
        </div>
    );
};

export default function TimetablePage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(() => {
        const saved = localStorage.getItem('tt_active_tab');
        return saved ? parseInt(saved) : 0;
    });

    // Tab 1 (Subjects) State
    const [subjects, setSubjects] = useState(() => {
        const saved = localStorage.getItem('tt_subjects');
        return saved ? JSON.parse(saved) : [];
    });
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [newSubject, setNewSubject] = useState('');
    const [errorStatus, setErrorStatus] = useState(null);
    // new states for combined tab
    const [uploadedFileName, setUploadedFileName] = useState('');
    const [showAddTeacher, setShowAddTeacher] = useState(false);
    const [showAddSubject, setShowAddSubject] = useState(false);
    const [mappingRows, setMappingRows] = useState(() => {
        const saved = localStorage.getItem('tt_mapping_rows');
        return saved ? JSON.parse(saved) : [];
    });
    const [addingTeacherRowId, setAddingTeacherRowId] = useState(null);
    const [newTeacherValue, setNewTeacherValue] = useState('');
    const [addingSubjectRowId, setAddingSubjectRowId] = useState(null);
    const [newSubjectValue, setNewSubjectValue] = useState('');

    // Format TT Tab - Grade Sub-tab State
    const [activeGradeSubTab, setActiveGradeSubTab] = useState('6');

    // Tab 2 (Teachers) State
    const [teachers, setTeachers] = useState(() => {
        const saved = localStorage.getItem('tt_teachers');
        return saved ? JSON.parse(saved) : [];
    });

    // Tab 3 (Mappings) State
    const [teacherSubjectMappings, setTeacherSubjectMappings] = useState(() => {
        const saved = localStorage.getItem('tt_mappings');
        return saved ? JSON.parse(saved) : [];
    });
    const [selectedMappingFile, setSelectedMappingFile] = useState(null);
    const [isUploadingMapping, setIsUploadingMapping] = useState(false);
    const [mappingError, setMappingError] = useState(null);

    // UI State for Grid Dropdown
    const [dropdownConfig, setDropdownConfig] = useState(null); // { mappingId, slotIndex, rect }
    const [academicYear, setAcademicYear] = useState('2026-2027');
    const [hasNewExtraction, setHasNewExtraction] = useState(() => {
        return localStorage.getItem('tt_lock') === 'true';
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [currentVersion, setCurrentVersion] = useState(null);
    const [generatedTimetable, setGeneratedTimetable] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // Tab 3 - Manual entry states
    const [showNewTeacherInput, setShowNewTeacherInput] = useState(null);
    const [showNewSubjectInput, setShowNewSubjectInput] = useState(null);
    const [newTeacherName, setNewTeacherName] = useState('');
    const [newSubjectName, setNewSubjectName] = useState('');
    const [activeSubjectMappingId, setActiveSubjectMappingId] = useState(null);

    // Tab 4 (Distribution) State - 47 COLUMN VERSION
    const [distribution47, setDistribution47] = useState(loadDistribution());
    const [editingCell, setEditingCell] = useState(null);
    const [editValue, setEditValue] = useState('');
    // we maintain both per-cell selection for merging and a simple class list for bulk edits
    const [selectedClasses, setSelectedClasses] = useState([]);
    const [selectedCells, setSelectedCells] = useState([]); // {subject,className}
    const selectedCellsRef = useRef([]); // mirror to avoid stale state when toggling fast
    const [selectedSubjects, setSelectedSubjects] = useState(new Set());
    const [currentBulkSubject, setCurrentBulkSubject] = useState(null);
    const [bulkPeriodValue, setBulkPeriodValue] = useState('5');
    const [lastSelectedClass, setLastSelectedClass] = useState(null);
    // merge UI state (no longer needed separate prompt state)
    // const [showMergePrompt, setShowMergePrompt] = useState(false);
    // drag-selection state
    const [mouseDown, setMouseDown] = useState(false);
    // flag to remember if last mouse down was a ctrl-selection
    const ctrlSelecting = useRef(false);

    // helper to toggle ctrl-selection (used by mouse events)
    const toggleCtrlSelect = (subject, className) => {
        if (isClassMerged(distribution47, subject, className)) return;
        // also maintain selectedClasses list for bulk editing
        setSelectedClasses(prev => {
            if (prev.includes(className)) {
                return prev.filter(c => c !== className);
            } else {
                return [...prev, className];
            }
        });
        // update ref for immediate consistency
        let newList;
        if (currentBulkSubject && currentBulkSubject !== subject) {
            newList = [{ subject, className }];
            setCurrentBulkSubject(subject);
        } else {
            const exists = selectedCellsRef.current.find(c => c.subject === subject && c.className === className);
            if (exists) {
                newList = selectedCellsRef.current.filter(c => !(c.subject === subject && c.className === className));
            } else {
                newList = [...selectedCellsRef.current, { subject, className }];
            }
            setCurrentBulkSubject(subject);
        }
        selectedCellsRef.current = newList;
        setSelectedCells(newList);
    };

    useEffect(() => {
        const onGlobalMouseUp = () => {
            setMouseDown(false);
            ctrlSelecting.current = false;
        };
        window.addEventListener('mouseup', onGlobalMouseUp);
        return () => window.removeEventListener('mouseup', onGlobalMouseUp);
    }, []);
    const [editingSubjectName, setEditingSubjectName] = useState(null);
    const [subjectRenameValue, setSubjectRenameValue] = useState('');
    // toast messages
    const [toasts, setToasts] = useState([]);
    const addToast = (msg, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, msg, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    };

    // Tab 5 (Bell Timings) State
    const [bellTimings, setBellTimings] = useState({
        middleSchool: {
            CT: '8:00 - 8:35',
            P1: '8:35 - 9:15',
            P2: '9:15 - 9:55',
            Break1: '9:55 - 10:10',
            P3: '10:10 - 10:50',
            P4: '10:50 - 11:30',
            P5: '11:30 - 12:10',
            Break2: '12:10 - 12:20',
            P6: '12:20 - 13:00',
            Lunch: '13:00 - 13:30',
            P7: '13:30 - 14:05',
            P8: '14:05 - 14:55'
        },
        seniorSchool: {
            CT: '8:00 - 8:35',
            P1: '8:35 - 9:15',
            P2: '9:15 - 9:55',
            Break1: '9:55 - 10:10',
            P3: '10:10 - 10:50',
            P4: '10:50 - 11:30',
            P5: '11:30 - 12:10',
            Break2: '12:10 - 12:20',
            P6: '12:20 - 13:00',
            P7: '13:00 - 13:30',
            Lunch: '13:30 - 14:05',
            P8: '14:05 - 14:55'
        }
    });

    // --- Authentication Flow (Auto-Anonymous) ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                console.log(`[Auth] User detected: ${user.isAnonymous ? 'Anonymous' : user.email} (UID: ${user.uid})`);
            } else {
                console.log('[Auth] No user. Attempting anonymous sign-in...');
                signInAnonymously(auth)
                    .then(() => console.log('[Auth] Signed in anonymously'))
                    .catch(err => console.error('[Auth] Anon login failed:', err));
            }
        });
        return () => unsubscribe();
    }, []);

    // --- Local Persistence ---
    useEffect(() => {
        localStorage.setItem('tt_mappings', JSON.stringify(teacherSubjectMappings));
        localStorage.setItem('tt_subjects', JSON.stringify(subjects));
        localStorage.setItem('tt_teachers', JSON.stringify(teachers));
        localStorage.setItem('tt_lock', hasNewExtraction.toString());
        localStorage.setItem('tt_active_tab', activeTab.toString());
    }, [teacherSubjectMappings, subjects, teachers, hasNewExtraction, activeTab]);

    // Sort mappings whenever list length changes (e.g. initial load from localStorage)
    useEffect(() => {
        if (teacherSubjectMappings.length > 0) {
            const isSorted = teacherSubjectMappings.every((m, i, arr) =>
                i === 0 || arr[i - 1].teacher <= m.teacher
            );

            if (!isSorted) {
                const sortedMappings = [...teacherSubjectMappings]
                    .sort((a, b) => a.teacher.localeCompare(b.teacher))
                    .map((mapping, index) => ({
                        ...mapping,
                        id: index + 1
                    }));
                setTeacherSubjectMappings(sortedMappings);
            }
        }
    }, [teacherSubjectMappings.length]);

    // Auto-sync: When Tab 3 mappings change, update Tab 4 subjects
    useEffect(() => {
        console.log('🔄 Tab 3 mappings changed, checking sync...');

        if (teacherSubjectMappings && teacherSubjectMappings.length > 0) {
            console.log(`Processing ${teacherSubjectMappings.length} mappings for sync`);

            // Get current distribution
            const currentDist = distribution47 || loadDistribution();

            // Sync subjects from mappings
            const updatedDistribution = syncSubjectsFromMappings(
                { ...currentDist },
                teacherSubjectMappings
            );

            // Check if anything changed
            const currentStr = JSON.stringify(currentDist);
            const updatedStr = JSON.stringify(updatedDistribution);

            if (currentStr !== updatedStr) {
                console.log('✅ Distribution updated, saving...');
                setDistribution47(updatedDistribution);
                saveDistribution(updatedDistribution);
            } else {
                console.log('No changes needed');
            }
        } else {
            console.log('No mappings to sync');
        }
    }, [teacherSubjectMappings]); // Run whenever mappings change

    // Debug: Log when distribution changes
    useEffect(() => {
        console.log('📊 Distribution updated. Subjects:', getAllSubjects(distribution47));
    }, [distribution47]);

    const loadMappingsForYear = async (year, force = false) => {
        if (!year) return;

        // PROTECTION: If we have newly extracted data that hasn't been saved, don't overwrite it unless forced
        if (hasNewExtraction && !force) {
            console.log('[Lock] Skipping auto-load to protect unsaved extraction data');
            return;
        }

        setIsLoading(true);

        try {
            const result = await loadTimetableMappings(year);

            if (result.mappings && result.mappings.length > 0) {
                // SORT MAPPINGS ALPHABETICALLY BY TEACHER NAME
                const sortedMappings = [...result.mappings].sort((a, b) =>
                    a.teacher.localeCompare(b.teacher)
                ).map((mapping, index) => ({
                    ...mapping,
                    id: index + 1
                }));

                setTeacherSubjectMappings(sortedMappings);
                setCurrentVersion(result.version);

                // After loading mappings, sync subjects to distribution
                const updatedDistribution = syncSubjectsFromMappings(
                    loadDistribution(), // Get current saved distribution
                    sortedMappings
                );
                setDistribution47(updatedDistribution);
                saveDistribution(updatedDistribution);

                console.log(`✅ Loaded ${result.mappings.length} mappings for ${year} (sorted alphabetically)`);
            } else {
                setTeacherSubjectMappings([]);
                setCurrentVersion(null);
                console.log(`No mappings found for ${year}`);
            }
        } catch (error) {
            console.error('Load error:', error);
            // Don't show alert on auto-load, just console
        } finally {
            setIsLoading(false);
        }
    };


    useEffect(() => {
        // AUTO-LOAD POLICY:
        // Only trigger auto-load if:
        // 1. We are on the Mapping Tab
        // 2. We don't have newly extracted data (hasNewExtraction is false)
        // 3. The current list is empty
        if (activeTab === 1 && !hasNewExtraction && teacherSubjectMappings.length === 0) {
            console.log(`[AutoLoad] Triggering load for ${academicYear} (Reason: Tab 2 active, List empty, No fresh extraction)`);
            loadMappingsForYear(academicYear);
        } else if (activeTab === 2) {
            console.log(`[AutoLoad] Blocked. state: {hasNewExtraction: ${hasNewExtraction}, listLength: ${teacherSubjectMappings.length}}`);
        }
    }, [activeTab, academicYear, hasNewExtraction, teacherSubjectMappings.length]);

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
            setSelectedFile(file);
            setErrorStatus(null);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUploading(true);
        setUploadedFileName(file.name);
        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target.result;
            const rows = text.split('\n').map(r => r.trim()).filter(r => r);
            const newRows = [];
            const teacherSet = new Set();
            const subjectSet = new Set();
            for (const r of rows) {
                const [teacher, subject, level] = r.split(',').map(x => x.trim());
                if (!teacher || !subject) continue;
                teacherSet.add(teacher);
                subjectSet.add(subject);
                newRows.push({
                    id: Date.now() + Math.random(),
                    teacher,
                    subject,
                    abbreviation: SUBJECT_ABBR[subject.toUpperCase()] || '—',
                    level: level || 'Main'
                });
            }
            setTeachers(Array.from(teacherSet));
            setSubjects(Array.from(subjectSet));
            setMappingRows(newRows);
            setIsUploading(false);
        };
        reader.readAsText(file);
    };

    const handleMappingFileSelect = (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
            setSelectedMappingFile(file);
            setMappingError(null);
        }
    };

    const handleMappingUpload = async () => {
        if (!selectedMappingFile) return;
        setIsUploadingMapping(true);
        try {
            const result = await extractSubjectsFromPDF(selectedMappingFile);
            setIsUploadingMapping(false);

            if (result.teachers && result.teachers.length > 0) {
                setTeachers(prev => Array.from(new Set([...prev, ...result.teachers])).sort());
            }

            if (result.mappings && result.mappings.length > 0) {
                setTeacherSubjectMappings(prev => {
                    const map = new Map(prev.map(m => [`${m.teacher}-${m.subject}`, m]));
                    result.mappings.forEach(newM => {
                        const key = `${newM.teacher}-${newM.subject}`;
                        if (map.has(key)) {
                            const existing = map.get(key);
                            const combinedClasses = Array.from(new Set([...existing.classes, ...newM.classes])).sort((a, b) => parseInt(a) - parseInt(b));
                            map.set(key, { ...existing, classes: combinedClasses });
                        } else {
                            // Use a more unique ID to avoid React key collisions
                            map.set(key, { ...newM, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}` });
                        }
                    });
                    return Array.from(map.values()).sort((a, b) => a.teacher.localeCompare(b.teacher));
                });
                setHasNewExtraction(true); // LOCK STATE: Prevent auto-reloads from overwriting this list
                // Sync subjects to distribution will happen automatically via useEffect
                addToast(`✅ Extracted ${result.mappings.length} mappings!\n\n✅ Subjects auto-synced to Period Distribution tab!`, 'success');
            } else {
                setMappingError("No teacher-subject-class mappings found.");
            }
            setSelectedMappingFile(null);
        } catch (error) {
            setIsUploadingMapping(false);
            setMappingError(error.message);
        }
    };

    const handleSetGrade = (mappingId, slotIndex, grade) => {
        setTeacherSubjectMappings(prev => prev.map(m => {
            if (m.id === mappingId) {
                const newClasses = [...m.classes];
                if (grade === null) {
                    newClasses.splice(slotIndex, 1);
                } else {
                    newClasses[slotIndex] = grade;
                }
                const cleaned = Array.from(new Set(newClasses.filter(Boolean))).sort((a, b) => parseInt(a) - parseInt(b));
                return { ...m, classes: cleaned };
            }
            return m;
        }));
        setDropdownConfig(null);
    };

    const handleUpdateSubject = (mappingId, newSub) => {
        setTeacherSubjectMappings(prev => prev.map(m =>
            m.id === mappingId ? { ...m, subject: newSub } : m
        ));
    };

    const handleUpdateTeacher = (mappingId, newTeacher) => {
        setTeacherSubjectMappings(prev => prev.map(m =>
            m.id === mappingId ? { ...m, teacher: newTeacher } : m
        ));
    };

    const handleAddMappingLine = () => {
        const newLine = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            teacher: '',
            subject: '',
            classes: []
        };
        // Add new line and sort — empty teacher names go to end
        const updatedMappings = [...teacherSubjectMappings, newLine]
            .sort((a, b) => {
                if (!a.teacher) return 1;
                if (!b.teacher) return -1;
                return a.teacher.localeCompare(b.teacher);
            })
            .map((mapping, index) => ({
                ...mapping,
                id: typeof mapping.id === 'number' ? index + 1 : mapping.id
            }));
        setTeacherSubjectMappings(updatedMappings);
    };

    // ============ TAB 4 HANDLERS ============

    const handleSelectAll = () => {
        if (selectedClasses.length === ALL_CLASSES.length) {
            setSelectedClasses([]);
        } else {
            setSelectedClasses([...ALL_CLASSES]);
        }
        setSelectedCells([]);
    };

    const handleSubjectSelect = (subject) => {
        const newSelected = new Set(selectedSubjects);
        if (newSelected.has(subject)) {
            newSelected.delete(subject);
            if (currentBulkSubject === subject) setCurrentBulkSubject(null);
        } else {
            newSelected.add(subject);
            setCurrentBulkSubject(subject);
        }
        setSelectedSubjects(newSelected);
    };

    const handleGradeBulk = (grade) => {
        const gradeClasses = ALL_CLASSES.filter(cls => cls.startsWith(grade));
        setSelectedClasses(gradeClasses);
        setSelectedCells([]);
    };

    const handleBulkApply = () => {
        if (!currentBulkSubject) {
            addToast('Please select a subject first by clicking on it', 'warning');
            return;
        }

        if (selectedClasses.length === 0) {
            addToast('Please select at least one class', 'warning');
            return;
        }

        const value = parseInt(bulkPeriodValue) || 0;
        let updated = { ...distribution47 };
        updated = setBulkValues(updated, currentBulkSubject, selectedClasses, value);
        setDistribution47(updated);
        saveDistribution(updated);

        addToast(`✅ Set ${currentBulkSubject} to ${value} periods for ${selectedClasses.length} classes`, 'success');
    };

    const handleSaveMappings = async () => {
        if (teacherSubjectMappings.length === 0) {
            addToast('No mappings to save', 'warning');
            return;
        }

        setIsSaving(true);

        try {
            const user = auth.currentUser;
            const createdBy = user?.email || user?.displayName || 'admin';

            console.log(`[Save] Starting save of ${teacherSubjectMappings.length} mappings...`);
            const result = await saveTimetableMappings(teacherSubjectMappings, academicYear, createdBy);
            console.log('[Save] Firestore confirmed save:', result);

            addToast(`✅ Successfully saved ${teacherSubjectMappings.length} mappings!\nVersion ID: ${result.versionId}\nAcademic Year: ${academicYear}`, 'success');

            // UNLOCK & RELOAD
            setHasNewExtraction(false);
            localStorage.removeItem('tt_lock');
            localStorage.removeItem('tt_mappings');
            await loadMappingsForYear(academicYear, true);
        } catch (error) {
            console.error('[Save] Error:', error);
            addToast(`❌ Failed to save mappings: ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handlePublishVersion = async () => {
        if (!currentVersion?.id) {
            addToast('No version selected to publish', 'warning');
            return;
        }

        if (!generatedTimetable) {
            addToast('⚠️ Please generate timetable first before publishing', 'warning');
            return;
        }

        if (!confirm(`📱 PUBLISH TIMETABLE TO ALL TEACHERS?

Academic Year: ${academicYear}
Version: ${currentVersion.version}
Teachers: ${Object.keys(generatedTimetable.teacherTimetables).length}
Classes: 47

This will:
• Set as ACTIVE timetable
• Send PUSH NOTIFICATION to all teachers
• Update teacher APKs immediately

Proceed?`)) {
            return;
        }

        setIsPublishing(true);

        try {
            // 1. Update version status to active
            await publishTimetableVersion(currentVersion.id);

            // 2. Push to APK with full timetable data and bell timings
            const result = await publishTimetableToAPK(
                currentVersion.id,
                academicYear,
                generatedTimetable.classTimetables,
                generatedTimetable.teacherTimetables,
                bellTimings
            );

            // 3. Update local state
            setCurrentVersion({
                ...currentVersion,
                status: 'active'
            });

            // 4. Show success with APK confirmation
            addToast(`✅ TIMETABLE PUBLISHED SUCCESSFULLY!
📅 Academic Year: ${academicYear}
🏷️ Version: ${currentVersion.version}
👩‍🏫 Teachers: ${result.teacherCount}
🏫 Classes: 47
📱 Push notifications: SENT to all teachers

Teachers can now see their timetable in the AutoSubs app.`, 'success');

            // 5. Optional: Show preview of what teachers see
            const firstTeacher = Object.keys(generatedTimetable.teacherTimetables)[0];
            if (firstTeacher) {
                console.log('📱 Sample teacher data for APK:', {
                    teacher: firstTeacher,
                    monday: generatedTimetable.teacherTimetables[firstTeacher]?.Monday
                });
            }
        } catch (error) {
            console.error('Publish error:', error);
            addToast(`❌ Failed to publish: ${error.message}`, 'error');
        } finally {
            setIsPublishing(false);
        }
    };


    const handleGenerateTimetable = async () => {
        console.log('🔵 ===== GENERATE BUTTON CLICKED =====');
        console.log('1. Current state teacherSubjectMappings:', teacherSubjectMappings);
        console.log('2. teacherSubjectMappings length:', teacherSubjectMappings?.length);
        console.log('3. teacherSubjectMappings type:', typeof teacherSubjectMappings);
        console.log('4. Is array?', Array.isArray(teacherSubjectMappings));

        if (teacherSubjectMappings && teacherSubjectMappings.length > 0) {
            console.log('5. First mapping sample:', teacherSubjectMappings[0]);
            console.log('6. All teachers:', teacherSubjectMappings.map(m => m.teacher));
            console.log('7. Unique teachers:', [...new Set(teacherSubjectMappings.map(m => m.teacher))]);
            console.log('8. First teacher classes:', teacherSubjectMappings[0].selectedClasses);
        } else {
            console.log('5. teacherSubjectMappings is empty or undefined');
        }

        if (!currentVersion) {
            console.log('9. No current version found');
            addToast('⚠️ Please save your mappings first (Tab 3)', 'warning');
            return;
        }

        console.log('10. Version check passed');
        setIsGenerating(true);

        try {
            let timetable;
            // Try using local state first
            if (teacherSubjectMappings && teacherSubjectMappings.length > 0) {
                console.log('11. Using local state with', teacherSubjectMappings.length, 'mappings');

                // Log what we're passing to generator
                console.log('12. Passing to generateTimetable:');
                console.log('   - mappings count:', teacherSubjectMappings.length);
                console.log('   - distribution47 exists:', !!distribution47);
                console.log('   - bellTimings exists:', !!bellTimings);

                // Test if generateTimetable function exists
                console.log('13. generateTimetable function:', generateTimetable);

                timetable = generateTimetable(
                    teacherSubjectMappings,
                    distribution47,
                    bellTimings
                );

                console.log('14. Generation complete. Result:', timetable);
                console.log('15. Teacher keys in result:', Object.keys(timetable.teacherTimetables));
                console.log('16. Teacher count:', Object.keys(timetable.teacherTimetables).length);

                setGeneratedTimetable(timetable);

                addToast(`✅ Timetable generated!

47 Classes scheduled
${Object.keys(timetable.teacherTimetables).length} Teachers scheduled
${timetable.errors?.length || 0} warnings`, 'success');
                console.log('11. Local state empty, trying Firebase...');
                const result = await loadTimetableMappings(academicYear);
                console.log('12. Firebase load result:', result);

                if (!result.mappings || result.mappings.length === 0) {
                    addToast('No teacher mappings found. Please add teachers in Tab 3.', 'warning');
                    setIsGenerating(false);
                    return;
                }

                console.log('13. Using Firebase mappings:', result.mappings.length);
                timetable = generateTimetable(
                    result.mappings,
                    distribution47,
                    bellTimings
                );

                console.log('14. Generation complete:', timetable);
                setGeneratedTimetable(timetable);

                addToast(`✅ Timetable generated!

47 Classes scheduled
${Object.keys(timetable.teacherTimetables).length} Teachers scheduled
${timetable.errors?.length || 0} warnings`, 'success');
            }

        } catch (error) {
            console.error('❌ ERROR IN GENERATION:');
            console.error('Error name:', error.name);
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
            addToast(`❌ Failed: ${error.message}`, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const tabs = [
        { id: 0, label: '�‍🏫 Teachers & Subjects' },
        { id: 1, label: '🎓 Format TT' },
        { id: 2, label: '📊 Distribution' },
        { id: 3, label: '⚙️ Generate' }
    ];

    return (
        <div style={{
            minHeight: '100vh',
            background: '#0f172a',
            color: '#f1f5f9',
            padding: '2rem',
            maxWidth: '100%',
            margin: '0 auto',
            fontFamily: 'Inter, sans-serif'
        }}>
            {/* Toast notifications */}
            {toasts.map(t => (
                <div key={t.id} style={{
                    position: 'fixed',
                    top: '1rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: t.type === 'error' ? '#dc2626' : t.type === 'warning' ? '#fbbf24' : '#10b981',
                    color: 'white',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    zIndex: 1000,
                    marginBottom: '0.5rem',
                    whiteSpace: 'pre-wrap'
                }}>
                    {t.msg}
                </div>
            ))}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', maxWidth: '1440px', margin: '0 auto 2rem auto' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: '900', margin: 0, letterSpacing: '-0.025em' }}>Timetable Studio</h1>
                    <p style={{ color: '#94a3b8' }}>Configuration & AI Generation</p>
                </div>
                <button
                    onClick={() => navigate('/')}
                    style={{
                        padding: '0.7rem 1.4rem',
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '0.8rem',
                        color: 'white',
                        cursor: 'pointer',
                        fontWeight: '700',
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#334155'}
                    onMouseOut={(e) => e.target.style.background = '#1e293b'}
                >
                    Back to Dashboard
                </button>
            </div>

            {/* Tabs Container */}
            <div style={{
                maxWidth: '1440px',
                margin: '0 auto',
                display: 'flex',
                gap: '0.6rem',
                background: '#1e293b',
                padding: '0.6rem',
                borderRadius: '1rem',
                marginBottom: '2rem',
                border: '1px solid #334155'
            }}>
                {tabs.map((tab, idx) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1,
                            padding: '1rem 0.5rem',
                            border: 'none',
                            borderRadius: '0.7rem',
                            background: activeTab === tab.id ? '#4f46e5' : TAB_GRADIENTS[idx],
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.95rem',
                            cursor: 'pointer',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: activeTab === tab.id ? '0 10px 15px -3px rgba(79, 70, 229, 0.4)' : 'none',
                            transform: activeTab === tab.id ? 'translateY(-2px)' : 'none',
                            opacity: activeTab === tab.id ? 1 : 0.85
                        }}
                        onMouseOver={(e) => {
                            if (activeTab !== tab.id) e.target.style.opacity = '1';
                        }}
                        onMouseOut={(e) => {
                            if (activeTab !== tab.id) e.target.style.opacity = '0.85';
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div style={{
                maxWidth: '1440px',
                margin: '0 auto',
                background: '#1e293b',
                borderRadius: '1.5rem',
                padding: '2.5rem',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
                border: '1px solid #334155'
            }}>

                {/* Tab 0: Teachers & Subjects with mapping table (selection-only) */}
                {activeTab === 0 && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                        {/* upload button */}
                        <div style={{ marginBottom: '2rem' }}>
                            <label style={{
                                display: 'inline-block',
                                padding: '0.6rem 1rem',
                                background: '#10b981',
                                color: 'white',
                                borderRadius: '0.8rem',
                                cursor: 'pointer'
                            }}>
                                📤 Upload CSV
                                <input
                                    type="file"
                                    accept=".csv,.xlsx"
                                    style={{ display: 'none' }}
                                    onChange={handleUpload}
                                />
                            </label>
                            {uploadedFileName && (
                                <span style={{ marginLeft: '1rem', color: '#10b981' }}>✓ {uploadedFileName}</span>
                            )}
                        </div>

                        {/* mapping table */}
                        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'collapse',
                                border: '1px solid #334155'
                            }}>
                                <thead>
                                    <tr style={{ background: '#0f172a' }}>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', borderBottom: '2px solid #334155' }}>Teacher</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', borderBottom: '2px solid #334155', width: '16%' }}>Subject</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', borderBottom: '2px solid #334155', width: '70px' }}>Abbr</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', borderBottom: '2px solid #334155' }}>Level</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', borderBottom: '2px solid #334155', width: '100px' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mappingRows.map((row, idx) => (
                                        <tr key={row.id} style={{ borderBottom: '1px solid #334155' }}>
                                            <td style={{ padding: '0.8rem' }}>
                                                {addingTeacherRowId === row.id ? (
                                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                        <input
                                                            type="text"
                                                            value={newTeacherValue}
                                                            onChange={e => setNewTeacherValue(e.target.value)}
                                                            placeholder="New teacher..."
                                                            style={{
                                                                flex: 1,
                                                                padding: '0.5rem',
                                                                background: '#0f172a',
                                                                color: '#f1f5f9',
                                                                border: '1px solid #10b981',
                                                                borderRadius: '0.4rem'
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                if (newTeacherValue.trim()) {
                                                                    setTeachers(prev => Array.from(new Set([...prev, newTeacherValue.trim()])).sort());
                                                                    const updated = [...mappingRows];
                                                                    updated[idx].teacher = newTeacherValue.trim();
                                                                    setMappingRows(updated);
                                                                    setNewTeacherValue('');
                                                                    setAddingTeacherRowId(null);
                                                                }
                                                            }}
                                                            style={{
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#10b981',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '0.4rem',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem'
                                                            }}
                                                        >✓</button>
                                                        <button
                                                            onClick={() => {
                                                                setNewTeacherValue('');
                                                                setAddingTeacherRowId(null);
                                                            }}
                                                            style={{
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#ef4444',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '0.4rem',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem'
                                                            }}
                                                        >✕</button>
                                                    </div>
                                                ) : (
                                                    <select
                                                        value={row.teacher}
                                                        onChange={(e) => {
                                                            if (e.target.value === '_type_new') {
                                                                setAddingTeacherRowId(row.id);
                                                                setNewTeacherValue('');
                                                            } else {
                                                                const updated = [...mappingRows];
                                                                updated[idx].teacher = e.target.value;
                                                                setMappingRows(updated);
                                                            }
                                                        }}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.6rem',
                                                            background: '#0f172a',
                                                            color: '#f1f5f9',
                                                            border: '1px solid #334155',
                                                            borderRadius: '0.4rem'
                                                        }}
                                                    >
                                                        <option value="">-- select teacher --</option>
                                                        {[...teachers].sort().map(t => (
                                                            <option key={t} value={t}>{t}</option>
                                                        ))}
                                                        <option disabled>──────────────</option>
                                                        <option value="_type_new">✏️ Type New Teacher</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.8rem', width: '16%' }}>
                                                {addingSubjectRowId === row.id ? (
                                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                        <input
                                                            type="text"
                                                            value={newSubjectValue}
                                                            onChange={e => setNewSubjectValue(e.target.value)}
                                                            placeholder="New subject..."
                                                            style={{
                                                                flex: 1,
                                                                padding: '0.5rem',
                                                                background: '#0f172a',
                                                                color: '#f1f5f9',
                                                                border: '1px solid #10b981',
                                                                borderRadius: '0.4rem'
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                if (newSubjectValue.trim()) {
                                                                    setSubjects(prev => Array.from(new Set([...prev, newSubjectValue.trim()])).sort());
                                                                    const updated = [...mappingRows];
                                                                    updated[idx].subject = newSubjectValue.trim();
                                                                    updated[idx].abbreviation = SUBJECT_ABBR[newSubjectValue.trim().toUpperCase()] || '—';
                                                                    setMappingRows(updated);
                                                                    setNewSubjectValue('');
                                                                    setAddingSubjectRowId(null);
                                                                }
                                                            }}
                                                            style={{
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#10b981',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '0.4rem',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem'
                                                            }}
                                                        >✓</button>
                                                        <button
                                                            onClick={() => {
                                                                setNewSubjectValue('');
                                                                setAddingSubjectRowId(null);
                                                            }}
                                                            style={{
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#ef4444',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '0.4rem',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem'
                                                            }}
                                                        >✕</button>
                                                    </div>
                                                ) : (
                                                    <select
                                                        value={row.subject}
                                                        onChange={(e) => {
                                                            if (e.target.value === '_type_new') {
                                                                setAddingSubjectRowId(row.id);
                                                                setNewSubjectValue('');
                                                            } else {
                                                                const updated = [...mappingRows];
                                                                updated[idx].subject = e.target.value;
                                                                updated[idx].abbreviation = SUBJECT_ABBR[e.target.value.toUpperCase()] || '—';
                                                                setMappingRows(updated);
                                                            }
                                                        }}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.6rem',
                                                            background: '#0f172a',
                                                            color: '#f1f5f9',
                                                            border: '1px solid #334155',
                                                            borderRadius: '0.4rem'
                                                        }}
                                                    >
                                                        <option value="">-- select subject --</option>
                                                        {[...subjects].sort().map(s => (
                                                            <option key={s} value={s}>{s}</option>
                                                        ))}
                                                        <option disabled>──────────────</option>
                                                        <option value="_type_new">✏️ Type New Subject</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.8rem', textAlign: 'center', fontWeight: 'bold', textTransform: 'uppercase', background: '#232b3b', color: '#fff', width: '70px' }}>
                                                {row.abbreviation || '—'}
                                            </td>
                                            <td style={{ padding: '0.8rem', textAlign: 'center' }}>
                                                <select
                                                    value={row.level}
                                                    onChange={(e) => {
                                                        const updated = [...mappingRows];
                                                        updated[idx].level = e.target.value;
                                                        setMappingRows(updated);
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        padding: '0.6rem',
                                                        background: '#0f172a',
                                                        color: '#f1f5f9',
                                                        border: '1px solid #334155',
                                                        borderRadius: '0.4rem'
                                                    }}
                                                >
                                                    <option value="Main">Main</option>
                                                    <option value="Middle">Middle</option>
                                                    <option value="Senior">Senior</option>
                                                    <option value="Middle&Main">Middle & Main</option>
                                                    <option value="Main&Senior">Main & Senior</option>
                                                    <option value="Middle&Senior">Middle & Senior</option>
                                                    <option value="Middle,Main&Senior">Middle, Main & Senior</option>
                                                </select>
                                            </td>
                                            <td style={{ padding: '0.8rem', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => {
                                                        setMappingRows(mappingRows.filter((_, i) => i !== idx));
                                                    }}
                                                    style={{
                                                        padding: '0.4rem 0.8rem',
                                                        background: '#ef4444',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '0.4rem',
                                                        cursor: 'pointer',
                                                        fontSize: '0.85rem'
                                                    }}
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* add new row button */}
                        <button
                            onClick={() => {
                                setMappingRows([...mappingRows, {
                                    id: Date.now(),
                                    teacher: '',
                                    subject: '',
                                    level: 'Main'
                                }]);
                            }}
                            style={{
                                padding: '0.8rem 1.5rem',
                                background: '#4f46e5',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.8rem',
                                cursor: 'pointer',
                                marginBottom: '1.5rem'
                            }}
                        >
                            + Add New Row
                        </button>

                        {/* summary stats */}
                        <div style={{ color: '#94a3b8', fontSize: '0.95rem', padding: '1rem', background: '#0f172a', borderRadius: '0.8rem' }}>
                            <div>📊 Teachers: <span style={{ color: '#10b981', fontWeight: 'bold' }}>{teachers.length}</span></div>
                            <div>📚 Subjects: <span style={{ color: '#10b981', fontWeight: 'bold' }}>{subjects.length}</span></div>
                            <div>🔗 Mappings: <span style={{ color: '#10b981', fontWeight: 'bold' }}>{mappingRows.length}</span></div>
                            {uploadedFileName && <div>📄 Last file: {uploadedFileName}</div>}
                        </div>
                    </div>
                )}

                {/* Tab 1: Format TT */}
                {activeTab === 1 && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                        {/* Grade Sub-tabs */}
                        <div style={{
                            display: 'flex',
                            gap: '0.6rem',
                            marginBottom: '2rem',
                            background: '#1e293b',
                            padding: '0.8rem',
                            borderRadius: '0.8rem',
                            border: '1px solid #334155',
                            flexWrap: 'wrap'
                        }}>
                            {[6, 7, 8, 9, 10, 11, 12].map(grade => (
                                <button
                                    key={grade}
                                    onClick={() => setActiveGradeSubTab(grade.toString())}
                                    style={{
                                        padding: '0.7rem 1.2rem',
                                        border: 'none',
                                        borderRadius: '0.6rem',
                                        background: activeGradeSubTab === grade.toString() ? '#4f46e5' : '#334155',
                                        color: 'white',
                                        fontWeight: '700',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: activeGradeSubTab === grade.toString() ? '0 4px 12px rgba(79, 70, 229, 0.3)' : 'none',
                                        transform: activeGradeSubTab === grade.toString() ? 'translateY(-2px)' : 'none'
                                    }}
                                    onMouseOver={(e) => {
                                        if (activeGradeSubTab !== grade.toString()) {
                                            e.target.style.background = '#475569';
                                            e.target.style.transform = 'translateY(-1px)';
                                        }
                                    }}
                                    onMouseOut={(e) => {
                                        if (activeGradeSubTab !== grade.toString()) {
                                            e.target.style.background = '#334155';
                                            e.target.style.transform = 'none';
                                        }
                                    }}
                                >
                                    Grade {grade}
                                </button>
                            ))}
                        </div>

                        {/* Content for active grade */}
                        {activeGradeSubTab === '6' ? (
                            <div style={{
                                background: '#1e293b',
                                borderRadius: '1rem',
                                padding: '2rem',
                                border: '1px solid #334155',
                                minHeight: '400px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                textAlign: 'center',
                                maxWidth: '100%',
                            }}>
                            {/* render preview component for iterative development */}
                            <FormatTTPreview />
                                {/* HEADER SECTION */}
                                <div style={{ marginBottom: '1.5rem', width: '100%' }}>
                                    <div style={{ fontSize: '2.1rem', fontWeight: 900, color: '#f1f5f9', letterSpacing: '0.01em', textAlign: 'center' }}>
                                        THE CHOICE SCHOOL, Tripunithura
                                    </div>
                                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#a5b4fc', marginTop: '0.2rem', textAlign: 'center' }}>
                                        2026-27
                                    </div>
                                    <div style={{ fontSize: '3rem', fontWeight: 900, color: '#4f46e5', marginTop: '0.2rem', textAlign: 'center', letterSpacing: '0.04em' }}>
                                        6A
                                    </div>
                                </div>
                                {/* TIMETABLE GRID */}
                                <div style={{
                                    overflowX: 'auto',
                                    width: '100%',
                                    maxWidth: 1200,
                                    margin: '0 auto',
                                }}>
                                    <table style={{
                                        borderCollapse: 'collapse',
                                        width: '100%',
                                        minWidth: 1100,
                                        background: 'transparent',
                                        color: '#f1f5f9',
                                        fontFamily: 'inherit',
                                    }}>
                                        <thead>
                                            <tr>
                                                <th style={ttCellHeader({})}></th>
                                                <th style={ttCellHeader({})}>1<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>8:35-9:15</span></th>
                                                <th style={ttCellHeader({})}>2<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>9:15-9:55</span></th>
                                                <th style={ttCellHeader({})}>BREAK-I<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>9:55-10:10</span></th>
                                                <th style={ttCellHeader({})}>3<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>10:10-10:50</span></th>
                                                <th style={ttCellHeader({})}>4<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>10:50-11:30</span></th>
                                                <th style={ttCellHeader({})}>5<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>11:30-12:10</span></th>
                                                <th style={ttCellHeader({})}>BREAK-II<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>12:10-12:20</span></th>
                                                <th style={ttCellHeader({})}>6<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>12:20-13:00</span></th>
                                                <th style={ttCellHeader({})}>LUNCH<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>13:00-13:30</span></th>
                                                <th style={ttCellHeader({})}>7<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>13:30-14:05</span></th>
                                                <th style={ttCellHeader({})}>8<br /><span style={{ fontWeight: 400, fontSize: '0.8em' }}>14:05-14:55</span></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day, i) => (
                                                <tr key={day}>
                                                    <th style={ttCellDay()}>{day}</th>
                                                    {/* 1 */}
                                                    <td style={ttCell()}></td>
                                                    {/* 2 */}
                                                    <td style={ttCell()}></td>
                                                    {/* BREAK-I (merged) */}
                                                    {i === 0 ? (
                                                        <td style={ttCellBreak('BREAK - I', 6)} rowSpan={6}>
                                                            <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#fbbf24', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>
                                                                BREAK - I
                                                            </span>
                                                        </td>
                                                    ) : null}
                                                    {/* 3 */}
                                                    <td style={ttCell()}></td>
                                                    {/* 4 */}
                                                    <td style={ttCell()}></td>
                                                    {/* 5 */}
                                                    <td style={ttCell()}></td>
                                                    {/* BREAK-II (merged) */}
                                                    {i === 0 ? (
                                                        <td style={ttCellBreak('BREAK - II', 6)} rowSpan={6}>
                                                            <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#fbbf24', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>
                                                                BREAK - II
                                                            </span>
                                                        </td>
                                                    ) : null}
                                                    {/* 6 */}
                                                    <td style={ttCell()}></td>
                                                    {/* LUNCH (merged) */}
                                                    {i === 0 ? (
                                                        <td style={ttCellBreak('LUNCH BREAK', 6)} rowSpan={6}>
                                                            <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#38bdf8', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>
                                                                LUNCH BREAK
                                                            </span>
                                                        </td>
                                                    ) : null}
                                                    {/* 7 */}
                                                    <td style={ttCell()}></td>
                                                    {/* 8 */}
                                                    <td style={ttCell()}></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Print/Screen CSS */}
                                <style>{`
                                    @media print {
                                        body { background: white !important; color: black !important; }
                                        table, th, td { color: black !important; border-color: #222 !important; }
                                    }
                                `}</style>
                            </div>
                        ) : (
                            <div style={{
                                background: '#1e293b',
                                borderRadius: '1rem',
                                padding: '2rem',
                                border: '1px solid #334155',
                                minHeight: '400px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                textAlign: 'center',
                            }}>
                                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎓</div>
                                <h3 style={{
                                    fontSize: '1.8rem',
                                    fontWeight: '900',
                                    color: '#f1f5f9',
                                    margin: '0 0 0.5rem 0'
                                }}>
                                    Grade {activeGradeSubTab} Timetable Format
                                </h3>
                                <p style={{
                                    fontSize: '1.1rem',
                                    color: '#94a3b8',
                                    margin: '0.5rem 0 0 0'
                                }}>
                                    Format settings for Grade {activeGradeSubTab} - Coming Soon
                                </p>
                                <div style={{
                                    marginTop: '2rem',
                                    padding: '1.5rem',
                                    background: '#0f172a',
                                    borderRadius: '0.8rem',
                                    border: '1px dashed #4f46e5',
                                    maxWidth: '500px'
                                }}>
                                    <p style={{ color: '#94a3b8', fontSize: '0.95rem', margin: 0 }}>
                                        This section will allow you to configure custom formatting and layout options specific to Grade {activeGradeSubTab} timetables.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 4: Subject Period Distribution */}
                {activeTab === 2 && (
                    <div>
                        {/* Header with Title and Actions */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '1.5rem',
                            flexWrap: 'wrap',
                            gap: '1rem'
                        }}>
                            <div>
                                <h3 style={{ fontSize: '1.3rem', fontWeight: '600', color: '#f1f5f9' }}>
                                    📊 Subject Period Distribution - 47 Classrooms
                                </h3>
                                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                                    Click any cell to edit • Bulk select with checkboxes • Shift+click for range
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button
                                    onClick={() => setShowAddSubject(true)}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#4f46e5',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.5rem',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    ➕ ADD NEW SUBJECT
                                </button>

                                <button
                                    onClick={() => {
                                        console.log('Manual sync triggered');
                                        const updated = syncSubjectsFromMappings(
                                            { ...distribution47 },
                                            teacherSubjectMappings
                                        );
                                        setDistribution47(updated);
                                        saveDistribution(updated);
                                        addToast('✅ Subjects synced from Tab 3!', 'success');
                                    }}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#2563eb',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.5rem',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    🔄 SYNC FROM TAB 3
                                </button>

                                <button
                                    onClick={() => {
                                        saveDistribution(distribution47);
                                        addToast('✅ Period distribution saved for 47 classrooms!', 'success');
                                    }}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#10b981',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.5rem',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    💾 SAVE DISTRIBUTION
                                </button>
                            </div>
                        </div>

                        {/* Add New Subject Modal */}
                        {showAddSubject && (
                            <div style={{
                                background: '#1e293b',
                                borderRadius: '0.75rem',
                                padding: '1.5rem',
                                marginBottom: '1.5rem',
                                border: '2px solid #4f46e5'
                            }}>
                                <h4 style={{ color: '#f1f5f9', fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
                                    Add New Subject
                                </h4>
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        value={newSubjectName}
                                        onChange={(e) => setNewSubjectName(e.target.value)}
                                        placeholder="Enter subject name (e.g. 'ECONOMICS')"
                                        style={{
                                            flex: 1,
                                            padding: '0.75rem 1rem',
                                            background: '#0f172a',
                                            border: '1px solid #4f46e5',
                                            borderRadius: '0.5rem',
                                            color: '#f1f5f9',
                                            fontSize: '1rem'
                                        }}
                                        autoFocus
                                    />
                                    <button
                                        onClick={() => {
                                            if (newSubjectName.trim()) {
                                                const subject = newSubjectName.trim().toUpperCase();
                                                let updated = { ...distribution47 };
                                                // Initialize with zeros for all classes
                                                ALL_CLASSES.forEach(className => {
                                                    if (!updated[className]) updated[className] = {};
                                                    updated[className][subject] = 0;
                                                });
                                                setDistribution47(updated);
                                                saveDistribution(updated);
                                                setNewSubjectName('');
                                                setShowAddSubject(false);
                                            }
                                        }}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: '#10b981',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.5rem',
                                            fontWeight: '600',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        ADD
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowAddSubject(false);
                                            setNewSubjectName('');
                                        }}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: '#64748b',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.5rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        CANCEL
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Bulk Edit Toolbar */}
                        <div style={{
                            background: '#1e293b',
                            borderRadius: '0.75rem',
                            padding: '1rem 1.5rem',
                            marginBottom: '1.5rem',
                            border: '1px solid #4f46e5',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1.5rem',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{ color: '#f1f5f9', fontWeight: '500' }}>BULK EDIT:</span>
                                <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                                    {selectedClasses.length} classes selected
                                </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#f1f5f9' }}>Set periods to:</span>
                                <input
                                    type="number"
                                    value={bulkPeriodValue}
                                    onChange={(e) => setBulkPeriodValue(e.target.value)}
                                    min="0"
                                    max="8"
                                    style={{
                                        width: '60px',
                                        padding: '0.5rem',
                                        background: '#0f172a',
                                        border: '1px solid #334155',
                                        borderRadius: '0.375rem',
                                        color: '#f1f5f9',
                                        textAlign: 'center'
                                    }}
                                />
                                <button
                                    onClick={handleBulkApply}
                                    disabled={!currentBulkSubject || selectedClasses.length === 0}
                                    style={{
                                        padding: '0.5rem 1.25rem',
                                        background: !currentBulkSubject || selectedClasses.length === 0 ? '#64748b' : '#10b981',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.375rem',
                                        fontWeight: '600',
                                        cursor: !currentBulkSubject || selectedClasses.length === 0 ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    APPLY TO SELECTED
                                </button>
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {['6', '7', '8', '9', '10', '11', '12'].map(grade => (
                                    <button
                                        key={grade}
                                        onClick={() => handleGradeBulk(grade)}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            background: '#334155',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Grade {grade}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Merge Selected Toolbar (appears when eligible) */}
                        {selectedCells.length > 1 && currentBulkSubject &&
                            selectedCells.every(c => c.subject === currentBulkSubject) &&
                            selectedCells.every(c => !isClassMerged(distribution47, currentBulkSubject, c.className)) &&
                            <div style={{
                                marginBottom: '1rem',
                                padding: '0.75rem 1rem',
                                background: '#7c3aed',
                                color: 'white',
                                borderRadius: '0.5rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                <span>{selectedCells.length} classes selected for <strong>{currentBulkSubject}</strong></span>
                                <button
                                    onClick={() => {
                                        const answer = prompt('Enter total weekly periods for this combined group:', '5');
                                        if (answer !== null) {
                                            const total = parseInt(answer) || 0;
                                            // create merged group
                                            const classListForMerge = selectedCells.map(c => c.className);
                                            const updated = addMergedGroup(
                                                { ...distribution47 },
                                                currentBulkSubject,
                                                classListForMerge,
                                                total
                                            );
                                            // set first class raw value and clear others
                                            if (selectedCells.length > 0) {
                                                const first = selectedCells[0].className;
                                                updated[first][currentBulkSubject] = total;
                                                selectedCells.slice(1).forEach(c => {
                                                    updated[c.className][currentBulkSubject] = 0;
                                                });
                                            }
                                            setDistribution47(updated);
                                            saveDistribution(updated);
                                            setSelectedClasses([]);
                                            selectedCellsRef.current = [];
                                            setSelectedCells([]);
                                            addToast('✅ Classes merged', 'success');
                                        }
                                    }}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: '#4f46e5',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.375rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    🔗 Merge Selected
                                </button>
                            </div>
                        }

                        {/* 47-COLUMN GRID with FROZEN SUBJECT COLUMN */}
                        <div style={{
                            background: '#1e293b',
                            borderRadius: '1rem',
                            border: '1px solid #334155',
                            overflow: 'auto',
                            maxHeight: 'calc(100vh - 300px)',
                            position: 'relative'
                        }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'separate',
                                borderSpacing: '0',
                                minWidth: '1200px'
                            }}>
                                {/* FROZEN HEADER ROW */}
                                <thead style={{
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 20,
                                    background: '#0f172a'
                                }}>
                                    <tr>
                                        {/* Checkbox Column Header */}
                                        <th style={{
                                            padding: '0.75rem 0.5rem',
                                            background: '#0f172a',
                                            borderBottom: '2px solid #4f46e5',
                                            borderRight: '1px solid #334155',
                                            position: 'sticky',
                                            left: 0,
                                            zIndex: 30,
                                            minWidth: '40px'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedClasses.length === ALL_CLASSES.length}
                                                onChange={handleSelectAll}
                                                style={{
                                                    width: '18px',
                                                    height: '18px',
                                                    cursor: 'pointer',
                                                    accentColor: '#4f46e5'
                                                }}
                                            />
                                        </th>

                                        {/* FROZEN SUBJECT COLUMN HEADER */}
                                        <th style={{
                                            padding: '1rem',
                                            textAlign: 'left',
                                            color: '#f1f5f9',
                                            fontSize: '0.95rem',
                                            background: '#0f172a',
                                            borderBottom: '2px solid #4f46e5',
                                            borderRight: '2px solid #4f46e5',
                                            position: 'sticky',
                                            left: '58px',
                                            zIndex: 25,
                                            minWidth: '180px'
                                        }}>
                                            SUBJECT
                                        </th>

                                        {/* ALL 47 CLASS COLUMN HEADERS */}
                                        {ALL_CLASSES.map(className => (
                                            <th key={className} style={{
                                                padding: '0.75rem 0.5rem',
                                                textAlign: 'center',
                                                color: className.includes('11') || className.includes('12') ? '#d97706' : '#06b6d4',
                                                fontSize: '0.85rem',
                                                fontWeight: '600',
                                                background: '#0f172a',
                                                borderBottom: '2px solid #4f46e5',
                                                borderLeft: '1px solid #334155',
                                                minWidth: '50px',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {className}
                                            </th>
                                        ))}

                                        {/* Actions Column Header */}
                                        <th style={{
                                            padding: '0.75rem 1rem',
                                            background: '#0f172a',
                                            borderBottom: '2px solid #4f46e5',
                                            borderLeft: '1px solid #334155',
                                            minWidth: '80px',
                                            color: '#f1f5f9',
                                            fontSize: '0.85rem'
                                        }}>
                                            ACTIONS
                                        </th>
                                    </tr>
                                </thead>

                                {/* TABLE BODY - SUBJECT ROWS */}
                                <tbody>
                                    {getAllSubjects(distribution47).map((subject) => (
                                        <tr
                                            key={subject}
                                            style={{
                                                borderBottom: '1px solid #334155',
                                                background: subject === currentBulkSubject ? 'rgba(79, 70, 229, 0.1)' : 'transparent'
                                            }}
                                        >
                                            {/* Checkbox Cell - FROZEN */}
                                            <td style={{
                                                padding: '0.75rem 0.5rem',
                                                background: '#1e293b',
                                                borderRight: '1px solid #334155',
                                                position: 'sticky',
                                                left: 0,
                                                zIndex: 10,
                                                textAlign: 'center'
                                            }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSubjects.has(subject)}
                                                    onChange={() => handleSubjectSelect(subject)}
                                                    style={{
                                                        width: '18px',
                                                        height: '18px',
                                                        cursor: 'pointer',
                                                        accentColor: '#4f46e5'
                                                    }}
                                                />
                                            </td>

                                            {/* FROZEN SUBJECT COLUMN */}
                                            <td style={{
                                                padding: '0.75rem 1rem',
                                                background: subject === currentBulkSubject ? 'rgba(79, 70, 229, 0.2)' : '#1e293b',
                                                borderRight: '2px solid #4f46e5',
                                                position: 'sticky',
                                                left: '58px',
                                                zIndex: 5,
                                                fontWeight: '500',
                                                color: '#f1f5f9'
                                            }}>
                                                {editingSubjectName === subject ? (
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                        <input
                                                            type="text"
                                                            value={subjectRenameValue}
                                                            onChange={(e) => setSubjectRenameValue(e.target.value)}
                                                            style={{
                                                                padding: '0.4rem 0.75rem',
                                                                background: '#0f172a',
                                                                border: '1px solid #4f46e5',
                                                                borderRadius: '0.375rem',
                                                                color: '#f1f5f9',
                                                                fontSize: '0.95rem',
                                                                width: '140px'
                                                            }}
                                                            autoFocus
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                if (subjectRenameValue.trim() && subjectRenameValue !== subject) {
                                                                    const updated = renameSubject(
                                                                        { ...distribution47 },
                                                                        subject,
                                                                        subjectRenameValue.trim().toUpperCase()
                                                                    );
                                                                    setDistribution47(updated);
                                                                    saveDistribution(updated);
                                                                }
                                                                setEditingSubjectName(null);
                                                                setSubjectRenameValue('');
                                                            }}
                                                            style={{
                                                                padding: '0.4rem 0.8rem',
                                                                background: '#10b981',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '0.375rem',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            ✓
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setEditingSubjectName(null);
                                                                setSubjectRenameValue('');
                                                            }}
                                                            style={{
                                                                padding: '0.4rem 0.8rem',
                                                                background: '#64748b',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '0.375rem',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            ✗
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <span
                                                            style={{
                                                                color: '#f1f5f9',
                                                                fontWeight: '600',
                                                                cursor: 'pointer',
                                                                padding: '0.25rem 0.5rem',
                                                                borderRadius: '0.25rem'
                                                            }}
                                                            onClick={() => {
                                                                setEditingSubjectName(subject);
                                                                setSubjectRenameValue(subject);
                                                                setCurrentBulkSubject(subject);
                                                            }}
                                                            onMouseEnter={(e) => e.target.style.background = '#334155'}
                                                            onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                                        >
                                                            {subject}
                                                        </span>
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(`Delete subject "${subject}" from ALL 47 classes? This cannot be undone.`)) {
                                                                    const updated = deleteSubject({ ...distribution47 }, subject);
                                                                    setDistribution47(updated);
                                                                    saveDistribution(updated);
                                                                    if (currentBulkSubject === subject) setCurrentBulkSubject(null);
                                                                }
                                                            }}
                                                            style={{
                                                                padding: '0.25rem 0.5rem',
                                                                background: 'transparent',
                                                                color: '#ef4444',
                                                                border: '1px solid #ef4444',
                                                                borderRadius: '0.25rem',
                                                                fontSize: '0.75rem',
                                                                cursor: 'pointer',
                                                                opacity: 0.7
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                e.target.style.opacity = '1';
                                                                e.target.style.background = '#ef4444';
                                                                e.target.style.color = 'white';
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.target.style.opacity = '0.7';
                                                                e.target.style.background = 'transparent';
                                                                e.target.style.color = '#ef4444';
                                                            }}
                                                        >
                                                            🗑️
                                                        </button>
                                                    </div>
                                                )}
                                            </td>

                                            {/* 47 CLASS CELLS - EDITABLE PERIOD COUNTS */}
                                            {ALL_CLASSES.map(className => {
                                                const cellKey = `${subject}-${className}`;
                                                const isEditing = editingCell === cellKey;
                                                const rawValue = getValue(distribution47, subject, className);
                                                const group = getGroupForClass(distribution47, subject, className);
                                                const isMerged = !!group;
                                                const isFirst = group && group.classes[0] === className;
                                                const displayValue = isMerged
                                                    ? (isFirst ? `${group.total} periods` : `↳ ${group.total}`)
                                                    : rawValue;
                                                const bgColor = isMerged ? '#9333ea' : (rawValue > 0 ? '#4f46e5' : 'transparent');
                                                const textColor = isMerged ? 'white' : (rawValue > 0 ? 'white' : '#94a3b8');

                                                return (
                                                    <td
                                                        key={className}
                                                        style={{
                                                            padding: '0.5rem 0.25rem',
                                                            textAlign: 'center',
                                                            background: selectedCells.some(c => c.subject === subject && c.className === className) ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
                                                            borderLeft: '1px solid #334155',
                                                            cursor: 'pointer'
                                                        }}
                                                        onMouseDown={(e) => {
                                                            if (e.ctrlKey || e.metaKey) {
                                                                toggleCtrlSelect(subject, className);
                                                                setMouseDown(true);
                                                                ctrlSelecting.current = true; // remember to suppress click
                                                            } else {
                                                                ctrlSelecting.current = false;
                                                            }
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            if (mouseDown && (e.ctrlKey || e.metaKey)) {
                                                                toggleCtrlSelect(subject, className);
                                                            }
                                                        }}
                                                        onClick={(e) => {
                                                            // Handle shift+click range selection
                                                            if (e.shiftKey && lastSelectedClass) {
                                                                const start = ALL_CLASSES.indexOf(lastSelectedClass);
                                                                const end = ALL_CLASSES.indexOf(className);
                                                                const [min, max] = [Math.min(start, end), Math.max(start, end)];
                                                                const range = ALL_CLASSES.slice(min, max + 1);
                                                                setSelectedClasses(prev => {
                                                                    const newSelection = [...new Set([...prev, ...range])];
                                                                    return newSelection;
                                                                });
                                                                // if we're merging within a subject, also add to selectedCells
                                                                if (currentBulkSubject && currentBulkSubject === subject) {
                                                                    setSelectedCells(prev => {
                                                                        const added = range.map(cn => ({ subject, className: cn }));
                                                                        // merge unique
                                                                        const all = [...prev, ...added];
                                                                        const uniq = [];
                                                                        all.forEach(x => {
                                                                            if (!uniq.find(y => y.subject === x.subject && y.className === x.className)) {
                                                                                uniq.push(x);
                                                                            }
                                                                        });
                                                                        selectedCellsRef.current = uniq;
                                                                        return uniq;
                                                                    });
                                                                }
                                                            }
                                                            setLastSelectedClass(className);
                                                        }}
                                                    >
                                                        {isEditing ? (
                                                            <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                                                                <input
                                                                    type="number"
                                                                    value={editValue}
                                                                    onChange={(e) => setEditValue(e.target.value)}
                                                                    onBlur={() => {
                                                                        let updated = { ...distribution47 };
                                                                        if (isMerged && isFirst) {
                                                                            // change group total
                                                                            const grp = getGroupForClass(updated, subject, className);
                                                                            if (grp) {
                                                                                grp.total = parseInt(editValue) || 0;
                                                                                // also mirror value in the first cell
                                                                                updated[className][subject] = grp.total;
                                                                            }
                                                                        } else {
                                                                            updated = setValue(updated, subject, className, editValue);
                                                                        }
                                                                        setDistribution47(updated);
                                                                        saveDistribution(updated);
                                                                        setEditingCell(null);
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            let updated = { ...distribution47 };
                                                                            if (isMerged && isFirst) {
                                                                                const grp = getGroupForClass(updated, subject, className);
                                                                                if (grp) {
                                                                                    grp.total = parseInt(editValue) || 0;
                                                                                    updated[className][subject] = grp.total;
                                                                                }
                                                                            } else {
                                                                                updated = setValue(updated, subject, className, editValue);
                                                                            }
                                                                            setDistribution47(updated);
                                                                            saveDistribution(updated);
                                                                            setEditingCell(null);
                                                                        }
                                                                    }}
                                                                    min="0"
                                                                    max="8"
                                                                    style={{
                                                                        width: '45px',
                                                                        padding: '0.3rem',
                                                                        background: '#0f172a',
                                                                        border: '2px solid #4f46e5',
                                                                        borderRadius: '0.25rem',
                                                                        color: '#f1f5f9',
                                                                        textAlign: 'center',
                                                                        fontWeight: '600'
                                                                    }}
                                                                    autoFocus
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // if previous mousedown triggered ctrl-selection, do not start edit
                                                                    if (ctrlSelecting.current) {
                                                                        ctrlSelecting.current = false;
                                                                        return;
                                                                    }
                                                                    if (e.ctrlKey || e.metaKey) {
                                                                        // ignore ctrl-clicks to avoid toggling edit mode
                                                                        return;
                                                                    }
                                                                    if (isMerged && !isFirst) return; // don't edit non-first merged cells
                                                                    // normal click goes into edit mode; selection handled separately on mouseDown
                                                                    setSelectedClasses([]);
                                                                    selectedCellsRef.current = [];
                                                                    setSelectedCells([]);
                                                                    setEditingCell(cellKey);
                                                                    setEditValue(rawValue);
                                                                    setCurrentBulkSubject(subject);
                                                                }}
                                                                style={{
                                                                    padding: '0.5rem 0.25rem',
                                                                    background: bgColor,
                                                                    color: textColor,
                                                                    borderRadius: '0.25rem',
                                                                    fontWeight: isMerged || rawValue > 0 ? '600' : '400',
                                                                    transition: 'all 0.1s',
                                                                    width: '100%',
                                                                    textAlign: 'center',
                                                                    position: 'relative'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    if (!isMerged && rawValue === 0) {
                                                                        e.target.style.background = '#334155';
                                                                    }
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    if (!isMerged && rawValue === 0) {
                                                                        e.target.style.background = 'transparent';
                                                                    }
                                                                }}
                                                            >
                                                                {displayValue}
                                                                {/* demerge button on first cell */}
                                                                {isMerged && isFirst && (
                                                                    <button
                                                                        onClick={(ev) => {
                                                                            ev.stopPropagation();
                                                                            if (confirm('Remove merged group?')) {
                                                                                const grp = getGroupForClass(distribution47, subject, className);
                                                                                let updated = { ...distribution47 };
                                                                                updated = removeMergedGroup(updated, subject, grp.id);
                                                                                // reset individual values to zero
                                                                                grp.classes.forEach(cl => {
                                                                                    updated[cl][subject] = 0;
                                                                                });
                                                                                setDistribution47(updated);
                                                                                saveDistribution(updated);
                                                                                setSelectedClasses([]);
                                                                            }
                                                                        }}
                                                                        style={{
                                                                            position: 'absolute',
                                                                            top: '2px',
                                                                            right: '2px',
                                                                            background: 'transparent',
                                                                            color: 'white',
                                                                            border: 'none',
                                                                            fontSize: '0.7rem',
                                                                            cursor: 'pointer',
                                                                            padding: '0',
                                                                            lineHeight: '1'
                                                                        }}
                                                                        title="Demerge group"
                                                                    >
                                                                        ×
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            })}

                                            {/* Actions Cell */}
                                            <td style={{
                                                padding: '0.75rem',
                                                textAlign: 'center',
                                                borderLeft: '1px solid #334155'
                                            }}>
                                                <button
                                                    onClick={() => {
                                                        setCurrentBulkSubject(subject);
                                                        addToast(`Selected subject: ${subject}. Use bulk edit toolbar to set periods.`, 'success');
                                                    }}
                                                    style={{
                                                        padding: '0.4rem 0.8rem',
                                                        background: currentBulkSubject === subject ? '#4f46e5' : '#334155',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '0.375rem',
                                                        fontSize: '0.75rem',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    ✎ Bulk
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {getAllSubjects(distribution47).length === 0 && (
                                <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No subjects yet</p>
                                    <p style={{ fontSize: '0.95rem' }}>Add subjects from Tab 3 or click "ADD NEW SUBJECT" above</p>
                                </div>
                            )}
                        </div>

                        {/* Legend and Stats */}
                        <div style={{
                            marginTop: '1.5rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            color: '#94a3b8',
                            fontSize: '0.85rem',
                            borderTop: '1px solid #334155',
                            paddingTop: '1rem'
                        }}>
                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                <span>📘 <span style={{ color: '#4f46e5' }}>Blue cells</span> = Subject taught</span>
                                <span>📗 <span style={{ color: '#06b6d4' }}>Teal headers</span> = Grades 6-10</span>
                                <span>📙 <span style={{ color: '#d97706' }}>Orange headers</span> = Grades 11-12</span>
                                <span>✅ <span style={{ color: '#10b981' }}>Bulk edit</span> = Select classes → Set value → Apply</span>
                                <span>🔗 <span style={{ color: '#9333ea' }}>Purple cells</span> = Merged group</span>
                            </div>
                            <div>
                                Total subjects: {getAllSubjects(distribution47).length} | Total classes: 47
                            </div>
                        </div>
                        {/* Merge summary list */}
                        {Object.keys(getMergedGroups(distribution47)).length > 0 && (
                            <div style={{ marginTop: '1rem', color: '#d1d5db', fontSize: '0.9rem' }}>
                                <strong>Combined groups:</strong>
                                <ul style={{ marginLeft: '1rem', marginTop: '0.25rem' }}>
                                    {Object.entries(getMergedGroups(distribution47)).map(([subject, groups]) =>
                                        groups.map(g => (
                                            <li key={g.id}>
                                                {subject}: {g.classes.join(' + ')} = {g.total} periods/week
                                            </li>
                                        ))
                                    )}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 5: Generate */}
                {
                    activeTab === 3 && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out', padding: '2rem 0' }}>
                            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                                {/* Bell Timings Configuration */}
                                <div style={{ marginBottom: '3rem' }}>
                                    <h3 style={{ fontSize: '1.8rem', fontWeight: '900', color: '#f1f5f9', marginBottom: '1.5rem', textAlign: 'left' }}>
                                        ⏰ Bell Timings Configuration
                                    </h3>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        {/* Middle School Card */}
                                        <div style={{
                                            background: '#1e293b',
                                            borderRadius: '1rem',
                                            padding: '1.5rem',
                                            border: '1px solid #334155',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                        }}>
                                            <h4 style={{ color: '#06b6d4', fontSize: '1.1rem', fontWeight: '800', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                🏫 Middle School (Grades 6,7,8)
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                {Object.entries(bellTimings.middleSchool).map(([period, time]) => (
                                                    <div key={period} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                                        <span style={{ width: '90px', color: '#94a3b8', fontSize: '0.85rem', fontWeight: '700' }}>{period}:</span>
                                                        <input
                                                            type="text"
                                                            value={time}
                                                            onChange={(e) => setBellTimings({
                                                                ...bellTimings,
                                                                middleSchool: { ...bellTimings.middleSchool, [period]: e.target.value }
                                                            })}
                                                            style={{
                                                                flex: 1,
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#0f172a',
                                                                border: '1px solid #334155',
                                                                borderRadius: '0.5rem',
                                                                color: '#f1f5f9',
                                                                fontSize: '0.9rem',
                                                                fontFamily: 'monospace'
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Senior School Card */}
                                        <div style={{
                                            background: '#1e293b',
                                            borderRadius: '1rem',
                                            padding: '1.5rem',
                                            border: '1px solid #334155',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                        }}>
                                            <h4 style={{ color: '#d97706', fontSize: '1.1rem', fontWeight: '800', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                🏛️ Senior School (Grades 9,10,11,12)
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                {Object.entries(bellTimings.seniorSchool).map(([period, time]) => (
                                                    <div key={period} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                                        <span style={{ width: '90px', color: '#94a3b8', fontSize: '0.85rem', fontWeight: '700' }}>{period}:</span>
                                                        <input
                                                            type="text"
                                                            value={time}
                                                            onChange={(e) => setBellTimings({
                                                                ...bellTimings,
                                                                seniorSchool: { ...bellTimings.seniorSchool, [period]: e.target.value }
                                                            })}
                                                            style={{
                                                                flex: 1,
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#0f172a',
                                                                border: '1px solid #334155',
                                                                borderRadius: '0.5rem',
                                                                color: '#f1f5f9',
                                                                fontSize: '0.9rem',
                                                                fontFamily: 'monospace'
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div style={{
                                    background: '#0f172a',
                                    padding: '3rem',
                                    borderRadius: '1.5rem',
                                    maxWidth: '600px',
                                    margin: '0 auto',
                                    border: '1px solid #334155'
                                }}>
                                    <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🤖</div>
                                    <h3 style={{ fontSize: '2rem', fontWeight: '900', color: '#f1f5f9', marginBottom: '1rem' }}>Generate Timetable</h3>
                                    <p style={{ color: '#94a3b8', fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '2.5rem' }}>
                                        Ready to generate a conflict-free expert timetable? Our AI algorithm will process your teacher mappings and class distribution to create the perfect schedule.
                                    </p>
                                    <button
                                        onClick={handleGenerateTimetable}
                                        disabled={isGenerating}
                                        style={{
                                            padding: '1rem 2rem',
                                            background: isGenerating ? '#64748b' : '#b91c1c',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.75rem',
                                            fontSize: '1.2rem',
                                            fontWeight: '700',
                                            cursor: isGenerating ? 'not-allowed' : 'pointer',
                                            width: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.75rem',
                                            marginBottom: '2rem',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isGenerating) e.target.style.background = '#991b1b';
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isGenerating) e.target.style.background = '#b91c1c';
                                        }}
                                    >
                                        {isGenerating ? (
                                            <>⚙️ GENERATING TIMETABLE... Please wait</>
                                        ) : (
                                            <>🚀 GENERATE MASTER TIMETABLE</>
                                        )}
                                    </button>
                                </div>

                                {/* Print Buttons */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '1rem',
                                    marginTop: '2rem'
                                }}>
                                    <button
                                        onClick={() => {
                                            if (!generatedTimetable) {
                                                addToast('Please generate timetable first', 'warning');
                                                return;
                                            }
                                            const teacherCards = Object.keys(generatedTimetable.teacherTimetables)
                                                .slice(0, 18) // First 18 teachers = 3 pages (6 per page)
                                                .map(teacherName =>
                                                    generateTeacherTimetableHTML(
                                                        generatedTimetable.teacherTimetables,
                                                        teacherName,
                                                        academicYear,
                                                        bellTimings
                                                    )
                                                );
                                            const printHTML = generateFullPrintHTML(teacherCards, 'teacher', academicYear, bellTimings);
                                            const printWindow = window.open('', '_blank');
                                            printWindow.document.write(printHTML);
                                            printWindow.document.close();
                                        }}
                                        disabled={!generatedTimetable}
                                        style={{
                                            padding: '1rem',
                                            background: generatedTimetable ? '#4f46e5' : '#64748b',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.75rem',
                                            fontSize: '1rem',
                                            fontWeight: '600',
                                            cursor: generatedTimetable ? 'pointer' : 'not-allowed',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        🖨️ PRINT TEACHER TIMETABLES (6 per page)
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (!generatedTimetable) {
                                                addToast('Please generate timetable first', 'warning');
                                                return;
                                            }
                                            const classList = [
                                                '6A', '6B', '6C', '6D', '6E', '6F', '6G',
                                                '7A', '7B', '7C', '7D', '7E', '7F', '7G',
                                                '8A', '8B', '8C', '8D', '8E', '8F', '8G',
                                                '9A', '9B', '9C', '9D', '9E', '9F', '9G',
                                                '10A', '10B', '10C', '10D', '10E', '10F', '10G',
                                                '11A', '11B', '11C', '11D', '11E', '11F',
                                                '12A', '12B', '12C', '12D', '12E', '12F'
                                            ];
                                            const classCards = classList
                                                .filter(cn => generatedTimetable.classTimetables[cn])
                                                .map(className =>
                                                    generateClassTimetableHTML(
                                                        generatedTimetable.classTimetables,
                                                        className,
                                                        academicYear,
                                                        bellTimings
                                                    )
                                                );
                                            const printHTML = generateFullPrintHTML(classCards, 'class', academicYear, bellTimings);
                                            const printWindow = window.open('', '_blank');
                                            printWindow.document.write(printHTML);
                                            printWindow.document.close();
                                        }}
                                        disabled={!generatedTimetable}
                                        style={{
                                            padding: '1rem',
                                            background: generatedTimetable ? '#059669' : '#64748b',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.75rem',
                                            fontSize: '1rem',
                                            fontWeight: '600',
                                            cursor: generatedTimetable ? 'pointer' : 'not-allowed',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        🖨️ PRINT CLASS TIMETABLES (6 per page)
                                    </button>
                                </div>

                                {/* Footer Branding */}
                                <div style={{
                                    marginTop: '3rem',
                                    paddingTop: '1.5rem',
                                    borderTop: '1px solid #334155',
                                    textAlign: 'center',
                                    color: '#94a3b8',
                                    fontSize: '0.85rem'
                                }}>
                                    created by @jayankrtripunithura {new Date().getFullYear()} • Academic Year {academicYear}
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Tab 1, 2 Placeholders */}
                {
                    activeTab === 0 && (
                        <div style={{ textAlign: 'center', padding: '8rem 2rem', animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🏗️</div>
                            <h3 style={{ color: '#f1f5f9', fontSize: '2rem', fontWeight: '900' }}>{tabs[activeTab].label}</h3>
                            <p style={{ color: '#94a3b8', fontSize: '1.2rem', marginTop: '1rem' }}>This component is currently under development.</p>
                        </div>
                    )
                }

                {/* Dropdown */}
                {
                    dropdownConfig && (
                        <GradeDropdown
                            anchorRect={dropdownConfig.rect}
                            onClose={() => setDropdownConfig(null)}
                            onSelect={(grade) => handleSetGrade(dropdownConfig.mappingId, dropdownConfig.slotIndex, grade)}
                        />
                    )
                }

            </div >

            {dropdownConfig && (
                <div onClick={() => setDropdownConfig(null)} style={{ position: 'fixed', inset: 0, zIndex: 999 }}></div>
            )}

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                body {
                    margin: 0;
                    padding: 0;
                    background: #0f172a;
                }
                * {
                    box-sizing: border-box;
                }
            `}</style>
            <footer style={{ marginTop: '3rem', textAlign: 'center', opacity: 0.5, fontSize: '0.9rem', color: '#94a3b8', fontWeight: '600' }}>
                created by @jayankrtripunithura 2026
            </footer>
        </div >
    );
}
