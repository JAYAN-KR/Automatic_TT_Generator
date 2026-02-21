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
import { auth } from '../firebase';
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

// Firebase imports
import { db } from '../firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

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
    'linear-gradient(135deg, #2563eb, #3b82f6)', // Tab 4 (Blue) - DPT
    'linear-gradient(135deg, #059669, #10b981)', // Tab 5 (Green)
    'linear-gradient(135deg, #b91c1c, #dc2626)', // Tab 6 (Red)
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
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
        </div>
    );
};

const formatClasses = (classes) => {
    if (!classes || classes.length === 0) return '';
    if (classes.length === 1) return classes[0];
    const grade = classes[0].match(/\d+/)?.[0] || '';
    const sections = classes.map(c => c.replace(grade, '')).sort().join('');
    return `${grade}${sections}`;
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

    // -- Classes Alloted (new Tab 1) State --
    const [selectedGroups, setSelectedGroups] = useState([]); // Array of { rowId, groupIndex }
    const [mergePopup, setMergePopup] = useState(null); // { rowId, groupIndices, grade, rect }

    // --- Interactive Builder State ---
    const [creationStatus, setCreationStatus] = useState(null); // { teacher, subject, messages: [], progress: 0, completedCount: 0, isError: false }
    const [completedCreations, setCompletedCreations] = useState(new Set());

    const [allotmentRows, setAllotmentRows] = useState(() => {
        const saved = localStorage.getItem('tt_allotments');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                const rows = data.rows || [];
                return rows.map(r => {
                    // Migrate single allotment object to array
                    if (r.allotments && !Array.isArray(r.allotments)) {
                        return {
                            ...r,
                            allotments: [{ id: Date.now() + Math.random(), classes: [r.allotments.class || '6A'], periods: r.allotments.periods || 0, isMerged: false }]
                        };
                    }
                    return r;
                });
            } catch { }
        }

        // build rows directly from teacher-subject pairs (one row per pair)
        const pairs = localStorage.getItem('tt_teacher_subject_pairs');
        if (pairs) {
            try {
                const pairsArray = JSON.parse(pairs);
                if (pairsArray.length > 0) {
                    return pairsArray.map(p => ({
                        id: `${p.teacher}||${p.subject}`,
                        teacher: p.teacher,
                        subject: p.subject,
                        allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, blockPeriods: 0, preferredDay: 'Any', isMerged: false }],
                        total: 0
                    }));
                }
            } catch { }
        }

        // fallback single empty row
        return [{
            id: Date.now(),
            teacher: '',
            subject: '',
            allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, blockPeriods: 0, preferredDay: 'Any', isMerged: false }],
            total: 0
        }];
    });

    // helper constants for dropdowns
    const CLASS_OPTIONS = [
        '6A', '6B', '6C', '6D', '6E', '6F', '6G',
        '7A', '7B', '7C', '7D', '7E', '7F', '7G',
        '8A', '8B', '8C', '8D', '8E', '8F', '8G',
        '9A', '9B', '9C', '9D', '9E', '9F', '9G',
        '10A', '10B', '10C', '10D', '10E', '10F', '10G',
        '11A', '11B', '11C', '11D', '11E', '11F',
        '12A', '12B', '12C', '12D', '12E', '12F'
    ];
    const PERIOD_OPTIONS = Array.from({ length: 11 }, (_, i) => i);

    const addAllotmentRow = () => {
        setAllotmentRows(prev => [...prev, {
            id: Date.now(),
            teacher: '',
            subject: '',
            allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, blockPeriods: 0, preferredDay: 'Any', isMerged: false }],
            total: 0
        }]);
    };
    const deleteAllotmentRow = (id) => {
        setAllotmentRows(prev => {
            if (prev.length <= 1) return prev; // keep at least one
            return prev.filter(r => r.id !== id);
        });
    };
    const updateAllotmentField = (id, field, value) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== id) return r;
            return { ...r, [field]: value };
        }));
    };
    const updateAllotmentGroup = (rowId, groupIndex, field, value) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            const newGroups = [...r.allotments];
            const updatedGroup = { ...newGroups[groupIndex] };

            if (field === 'class') {
                updatedGroup.classes = [value];
            } else if (field === 'periods') {
                const numVal = Number(value);
                updatedGroup.periods = numVal;
                // When PPS goes to 0, automatically reset blocks and day
                if (numVal === 0) {
                    updatedGroup.blockPeriods = 0;
                    updatedGroup.preferredDay = 'Any';
                }
            } else if (field === 'blockPeriods') {
                updatedGroup.blockPeriods = Number(value);
            } else if (field === 'preferredDay') {
                updatedGroup.preferredDay = value;
            }

            newGroups[groupIndex] = updatedGroup;
            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));
    };
    const addAllotmentGroup = (rowId) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            return {
                ...r,
                allotments: [...r.allotments, { id: Date.now() + Math.random(), classes: ['6A'], periods: 0, blockPeriods: 0, preferredDay: 'Any', isMerged: false }]
            };
        }));
    };
    const deleteAllotmentGroup = (rowId, groupIndex) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;

            // If it's the last group, reset it instead of deleting
            if (r.allotments.length <= 1) {
                const lastGroup = r.allotments[r.allotments.length - 1];
                const grade = lastGroup?.classes[0]?.match(/\d+/)?.[0];
                const newGroup = { id: Date.now() + Math.random(), classes: [grade ? grade + 'A' : '6A'], periods: 0, blockPeriods: 0, preferredDay: 'Any', isMerged: false };
                return {
                    ...r,
                    allotments: [newGroup],
                    total: 0
                };
            }

            const newGroups = r.allotments.filter((_, idx) => idx !== groupIndex);
            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));
    };

    const unmergeGroup = (rowId, groupIndex) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            const group = r.allotments[groupIndex];
            if (!group || !group.isMerged) return r;

            // Split merged group into individual class allotments
            const newGroups = [...r.allotments];
            const splitGroups = group.classes.map(c => ({
                id: Date.now() + Math.random(),
                classes: [c],
                periods: group.periods,
                blockPeriods: 0,
                preferredDay: group.preferredDay || 'Any',
                isMerged: false
            }));

            newGroups.splice(groupIndex, 1, ...splitGroups);
            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));
        addToast('Group unmerged', 'success');
    };

    const handleMergeConfirm = (periods) => {
        if (!mergePopup) return;
        const numPeriods = Number(periods) || 0;

        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== mergePopup.rowId) return r;

            // Get classes from all selected indices
            const mergedClasses = mergePopup.groupIndices.flatMap(idx => r.allotments[idx].classes);

            // Create the new merged group
            const newGroup = {
                id: Date.now() + Math.random(),
                classes: [...new Set(mergedClasses)], // Dedupe just in case
                periods: numPeriods,
                blockPeriods: 0,
                preferredDay: 'Any',
                isMerged: true
            };

            // Filter out the items that were merged
            const remainingGroups = r.allotments.filter((_, idx) => !mergePopup.groupIndices.includes(idx));

            // Add the new merged group at the position of the first selected index
            const insertIdx = Math.min(...mergePopup.groupIndices);
            const newGroups = [...remainingGroups];
            newGroups.splice(insertIdx, 0, newGroup);

            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));

        setMergePopup(null);
        setSelectedGroups([]);
        addToast('Classes merged successfully', 'success');
    };

    // Persistent Storage Management for Allotments
    const saveAllotments = async (rows) => {
        const dataToSave = rows || allotmentRows;
        console.log('📦 Starting save process...', { rowCount: dataToSave.length });

        // 1. Save to localStorage (Instant fallback)
        try {
            localStorage.setItem('tt_allotments', JSON.stringify({ rows: dataToSave }));
            console.log('✅ LocalStorage backup updated');
        } catch (e) { console.error('❌ Local save failed', e); }

        // 2. Save to Firestore (Permanent Cloud Storage)
        try {
            setIsSaving(true);
            console.log('📡 Attempting Cloud Save to Firestore...');

            const docRef = doc(db, 'allotments', academicYear);

            // Add a 10-second timeout so the button doesn't stay stuck
            const savePromise = setDoc(docRef, {
                rows: dataToSave,
                lastUpdated: new Date().toISOString(),
                academicYear
            });

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Cloud request timed out. Check your internet or Firebase Rules.')), 10000)
            );

            await Promise.race([savePromise, timeoutPromise]);

            console.log('🚀 Cloud Save Successful!');
            addToast('✅ Data saved to Cloud & Browser', 'success');
        } catch (e) {
            console.error('❌ Cloud save failed error:', e);
            addToast(`⚠️ Browser save only: ${e.message}`, 'warning');
        } finally {
            setIsSaving(false);
        }
    };

    const loadAllotments = async () => {
        setIsLoading(true);
        try {
            // 1. Try Firestore first (Primary source)
            const docRef = doc(db, 'allotments', academicYear);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.rows && data.rows.length > 0) {
                    setAllotmentRows(data.rows);
                    localStorage.setItem('tt_allotments', JSON.stringify({ rows: data.rows }));
                    addToast('☁️ Loaded from Cloud', 'success');
                    setIsLoading(false);
                    return true;
                }
            }

            // 2. Fallback to localStorage if Firestore is empty/fails
            const localSaved = localStorage.getItem('tt_allotments');
            if (localSaved) {
                const data = JSON.parse(localSaved);
                if (data.rows && data.rows.length > 0) {
                    setAllotmentRows(data.rows);
                    addToast('📋 Loaded from Browser backup', 'success');
                    setIsLoading(false);
                    return true;
                }
            }
        } catch (e) {
            console.error('Data load error:', e);
            addToast('❌ Failed to load cloud data', 'error');
        } finally {
            setIsLoading(false);
        }
        return false;
    };

    const clearAllotments = async () => {
        if (confirm('⚠️ Are you sure? This will delete all saved allotments from CLOUD and browser.')) {
            try {
                // Clear Cloud
                const docRef = doc(db, 'allotments', academicYear);
                await deleteDoc(docRef);

                // Clear Local
                localStorage.removeItem('tt_allotments');

                // Reset to default from teacher-subject pairs if possible
                const pairs = localStorage.getItem('tt_teacher_subject_pairs');
                if (pairs) {
                    const pairsArray = JSON.parse(pairs);
                    const resetRows = pairsArray.map(p => ({
                        id: `${p.teacher}||${p.subject}`,
                        teacher: p.teacher,
                        subject: p.subject,
                        allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, isMerged: false }],
                        total: 0
                    }));
                    setAllotmentRows(resetRows);
                } else {
                    setAllotmentRows([{
                        id: Date.now(),
                        teacher: '',
                        subject: '',
                        allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, isMerged: false }],
                        total: 0
                    }]);
                }
                addToast('🧹 All data cleared permanently', 'info');
            } catch (e) {
                addToast('❌ Clear failed', 'error');
            }
        }
    };

    // ── Cloud Save / Load for Teachers & Subjects tab ────────────────────────
    const saveDptData = async (rowsOverride, teachersOverride, subjectsOverride) => {
        const rowsToSave = rowsOverride || mappingRows;
        const teachersSave = teachersOverride || teachers;
        const subjectsSave = subjectsOverride || subjects;

        // 1. Always write to localStorage first (immediate fallback)
        try {
            localStorage.setItem('tt_mapping_rows', JSON.stringify(rowsToSave));
            localStorage.setItem('tt_teachers', JSON.stringify(teachersSave));
            localStorage.setItem('tt_subjects', JSON.stringify(subjectsSave));
        } catch (e) { console.error('LocalStorage DPT save failed', e); }

        // 2. Write to Firestore
        try {
            setIsSaving(true);
            const docRef = doc(db, 'dpt_data', academicYear);
            await setDoc(docRef, {
                mappingRows: rowsToSave,
                teachers: teachersSave,
                subjects: subjectsSave,
                lastUpdated: new Date().toISOString(),
                academicYear
            });
            addToast('✅ Teachers & Subjects saved to Cloud & Browser', 'success');
            console.log('☁️ [DPT] Cloud save successful —', rowsToSave.length, 'rows,', teachersSave.length, 'teachers');
        } catch (e) {
            console.error('Cloud DPT save failed', e);
            addToast('⚠️ Browser saved only (cloud error): ' + e.message, 'warning');
        } finally {
            setIsSaving(false);
        }
    };

    const loadDptData = async () => {
        try {
            // 1. Try Firestore first
            const docRef = doc(db, 'dpt_data', academicYear);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                let loaded = false;
                if (data.mappingRows && data.mappingRows.length > 0) {
                    setMappingRows(data.mappingRows);
                    localStorage.setItem('tt_mapping_rows', JSON.stringify(data.mappingRows));
                    loaded = true;
                }
                if (data.teachers && data.teachers.length > 0) {
                    setTeachers(data.teachers);
                    localStorage.setItem('tt_teachers', JSON.stringify(data.teachers));
                    loaded = true;
                }
                if (data.subjects && data.subjects.length > 0) {
                    setSubjects(data.subjects);
                    localStorage.setItem('tt_subjects', JSON.stringify(data.subjects));
                    loaded = true;
                }
                if (loaded) {
                    addToast('☁️ Teachers & Subjects loaded from Cloud', 'success');
                    console.log('☁️ [DPT] Cloud load OK —', data.mappingRows?.length, 'rows,', data.teachers?.length, 'teachers');
                    return;
                }
            }
            // 2. Fall back to localStorage
            const localRows = localStorage.getItem('tt_mapping_rows');
            if (localRows) {
                const parsed = JSON.parse(localRows);
                if (parsed.length > 0) {
                    setMappingRows(parsed);
                    console.log('[DPT] Loaded from localStorage backup:', parsed.length, 'rows');
                }
            }
        } catch (e) {
            console.error('[DPT] Cloud load failed, using localStorage:', e.message);
            try {
                const localRows = localStorage.getItem('tt_mapping_rows');
                if (localRows) setMappingRows(JSON.parse(localRows));
            } catch { }
        }
    };

    // Initial load and external storage sync
    useEffect(() => {
        // Load allotments (Classes Alloted tab)
        loadAllotments();
        // Load Teachers & Subjects from cloud
        loadDptData();

        // Listen for storage changes from other tabs
        const handleExternalStorageChange = (e) => {
            if (e.key === 'tt_allotments') {
                const localSaved = localStorage.getItem('tt_allotments');
                if (localSaved) {
                    const data = JSON.parse(localSaved);
                    if (data.rows) setAllotmentRows(data.rows);
                }
            }
        };
        window.addEventListener('storage', handleExternalStorageChange);
        return () => window.removeEventListener('storage', handleExternalStorageChange);
    }, []);

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
    const statusScrollRef = useRef(null); // ref for status panel auto-scroll

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
        }, type === 'success' ? 6000 : 4000);
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

    // --- Local Persistence (instant localStorage on every change) ---
    useEffect(() => {
        localStorage.setItem('tt_mappings', JSON.stringify(teacherSubjectMappings));
        localStorage.setItem('tt_subjects', JSON.stringify(subjects));
        localStorage.setItem('tt_teachers', JSON.stringify(teachers));
        localStorage.setItem('tt_lock', hasNewExtraction.toString());
        localStorage.setItem('tt_active_tab', activeTab.toString());
    }, [teacherSubjectMappings, subjects, teachers, hasNewExtraction, activeTab]);

    // --- Auto-save allotmentRows to cloud (debounced 3s) ---
    useEffect(() => {
        if (!allotmentRows || allotmentRows.length === 0) return;
        const timer = setTimeout(() => {
            // silent save: write to localStorage + Firestore without toast
            try { localStorage.setItem('tt_allotments', JSON.stringify({ rows: allotmentRows })); } catch { }
            const docRef = doc(db, 'allotments', academicYear);
            setDoc(docRef, { rows: allotmentRows, lastUpdated: new Date().toISOString(), academicYear })
                .then(() => console.log('☁️ [AutoSave] allotments synced'))
                .catch(e => console.warn('⚠️ [AutoSave] allotments cloud failed:', e.message));
        }, 3000);
        return () => clearTimeout(timer);
    }, [allotmentRows]);

    // --- Auto-save Teachers & Subjects to cloud (debounced 3s) ---
    useEffect(() => {
        if (!mappingRows || mappingRows.length === 0) return;
        const timer = setTimeout(() => {
            try {
                localStorage.setItem('tt_mapping_rows', JSON.stringify(mappingRows));
                localStorage.setItem('tt_teachers', JSON.stringify(teachers));
                localStorage.setItem('tt_subjects', JSON.stringify(subjects));
            } catch { }
            const docRef = doc(db, 'dpt_data', academicYear);
            setDoc(docRef, {
                mappingRows, teachers, subjects,
                lastUpdated: new Date().toISOString(), academicYear
            })
                .then(() => console.log('☁️ [AutoSave] dpt_data synced'))
                .catch(e => console.warn('⚠️ [AutoSave] dpt_data cloud failed:', e.message));
        }, 3000);
        return () => clearTimeout(timer);
    }, [mappingRows, teachers, subjects]);

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
        if (activeTab === 3 && !hasNewExtraction && teacherSubjectMappings.length === 0) {
            // preserve previous behaviour: trigger when Format TT becomes active
            console.log(`[AutoLoad] Triggering load for ${academicYear} (Reason: Format TT tab active, List empty, No fresh extraction)`);
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


    const handleCreateSpecific = async (row) => {
        if (!row.teacher || !row.subject) {
            addToast('Teacher and Subject must be selected', 'warning');
            return;
        }

        console.log('🟢 [CREATE] Clicked for:', row.teacher, row.subject, row.allotments);

        // ── Build or reuse working timetable ───────────────────────────────────
        let currentTT = generatedTimetable;
        console.log('🟡 [CREATE] Existing generatedTimetable:', currentTT ? 'exists' : 'null - building fresh');
        if (!currentTT) {
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const initPeriods = ['CT', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
            const cTimetables = {};
            const tTimetables = {};
            const allTeachers = [...new Set(allotmentRows.map(r => r.teacher).filter(Boolean))];

            CLASS_OPTIONS.forEach(cn => {
                cTimetables[cn] = {};
                days.forEach(d => {
                    cTimetables[cn][d] = {};
                    initPeriods.forEach(p => { cTimetables[cn][d][p] = { subject: '', teacher: '' }; });
                });
            });

            allTeachers.forEach(t => {
                tTimetables[t] = {};
                days.forEach(d => {
                    tTimetables[t][d] = { CT: '', P1: '', P2: '', P3: '', P4: '', P5: '', P6: '', P7: '', P8: '', periodCount: 0 };
                });
                tTimetables[t].weeklyPeriods = 0;
            });

            currentTT = { classTimetables: cTimetables, teacherTimetables: tTimetables, academicYear, bellTimings };
        }

        setCreationStatus({
            teacher: row.teacher, subject: row.subject,
            messages: [
                `═══════════════════════════════════════`,
                `CREATING: ${row.teacher} (${row.subject})`,
                `═══════════════════════════════════════`
            ],
            progress: 0, completedCount: completedCreations.size + 1, isError: false
        });

        const addMessage = (msg) => setCreationStatus(prev => ({
            ...prev, messages: [...(prev?.messages || []), msg]
        }));
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            const teacher = row.teacher;
            const subject = row.subject;

            // ── Build tasks list ────────────────────────────────────────────────
            const tasks = [];
            row.allotments.forEach(group => {
                const total = Number(group.periods) || 0;
                const blocks = Number(group.blockPeriods) || 0;
                const singles = Math.max(0, total - blocks * 2);
                const pDay = group.preferredDay || 'Any';
                for (let i = 0; i < blocks; i++)  tasks.push({ type: 'BLOCK', teacher, subject, classes: group.classes, preferredDay: pDay });
                for (let i = 0; i < singles; i++) tasks.push({ type: 'SINGLE', teacher, subject, classes: group.classes, preferredDay: pDay });
            });

            if (tasks.length === 0) {
                addMessage('→ No periods set. Please update PPS first.');
                setCreationStatus(prev => ({ ...prev, isError: true }));
                return;
            }

            const blockTasks = tasks.filter(t => t.type === 'BLOCK');
            const singleTasks = tasks.filter(t => t.type === 'SINGLE');
            addMessage(`→ ${tasks.length} period(s) total — ${blockTasks.length} block-pair(s), ${singleTasks.length} single(s)`);
            await sleep(300);

            // ── Constants ───────────────────────────────────────────────────────
            const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const DMAP = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
            const SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };
            const PRDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

            // Block pairs that do NOT cross any break:
            // Break-I  : between P2 and P3 (9:55–10:10)
            // Break-II : between P5 and P6 (12:10–12:20)
            // Lunch    : between P6 and P7 (13:00–13:30)
            // Valid consecutive pairs: P1-P2, P3-P4, P4-P5, P7-P8
            const VALID_BLOCK_PAIRS = [
                ['P1', 'P2'],
                ['P3', 'P4'],
                ['P4', 'P5'],
                ['P7', 'P8']
            ];

            // Deep-copy — commit only on full success
            const tt = JSON.parse(JSON.stringify(currentTT));

            // Ensure teacher row exists
            if (!tt.teacherTimetables[teacher]) {
                tt.teacherTimetables[teacher] = { weeklyPeriods: 0 };
                DAYS.forEach(d => {
                    tt.teacherTimetables[teacher][d] = { CT: '', P1: '', P2: '', P3: '', P4: '', P5: '', P6: '', P7: '', P8: '', periodCount: 0 };
                });
            }

            // ── Helpers ─────────────────────────────────────────────────────────
            const tFree = (d, p) => {
                const sl = tt.teacherTimetables[teacher]?.[d]?.[p];
                if (sl === undefined || sl === null || sl === '') return true;
                if (typeof sl === 'object') return !sl.className;
                return false;
            };
            const cFree = (d, p, classes) =>
                classes.every(cn => (tt.classTimetables[cn]?.[d]?.[p]?.subject ?? '') === '');
            const slotFree = (d, p, classes) => tFree(d, p) && cFree(d, p, classes);
            const teacherDayLoad = (d) => PRDS.filter(p => !tFree(d, p)).length;

            // Returns true if the given day already has ANY block period for these classes
            // (prevents two consecutive block pairs landing on the same day)
            const dayAlreadyHasBlock = (d, classes) =>
                PRDS.some(p =>
                    classes.some(cn => {
                        const slot = tt.classTimetables[cn]?.[d]?.[p];
                        return slot && slot.isBlock;
                    })
                );

            // ── Scoring: flat across all periods; diversity-weighted ────────────
            // Treats all 8 periods equally in the band, relying on day diversity
            // and consecutive-avoidance to spread them out.
            const scoreSlot = (d, p, classes) => {
                const pIdx = PRDS.indexOf(p);

                // 1. Day Diversity (40) — strong preference for underfilled days
                const loads = DAYS.map(day => teacherDayLoad(day));
                const myLoad = loads[DAYS.indexOf(d)];
                const maxL = Math.max(...loads, 1);
                const s1 = (1 - myLoad / (maxL + 1)) * 40;

                // 2. Period Spread (25) — flat: all periods treated equally
                //    slight edge to middle periods for natural feel
                const midBonus = [0, 0.1, 0.25, 0.25, 0.2, 0.1, 0, 0];
                const s2 = (0.75 + (midBonus[pIdx] || 0)) * 25;

                // 3. Class Balance (20) — prefer less-loaded class days
                const avgCLoad = classes.reduce((sum, cn) =>
                    sum + PRDS.filter(q => (tt.classTimetables[cn]?.[d]?.[q]?.subject ?? '') !== '').length
                    , 0) / (classes.length || 1);
                const s3 = Math.max(0, 1 - avgCLoad / 8) * 20;

                // 4. Avoid Consecutive (15) — penalise back-to-back teacher slots
                let penalty = 0;
                if (PRDS[pIdx - 1] && !tFree(d, PRDS[pIdx - 1])) penalty += 7;
                if (PRDS[pIdx + 1] && !tFree(d, PRDS[pIdx + 1])) penalty += 7;
                const s4 = Math.max(0, 15 - penalty);

                return Math.round(s1 + s2 + s3 + s4);
            };

            let placedCount = 0;
            const placements = [];

            // ════════════════════════════════════════════════════════════════════
            // PHASE 1 — BLOCK PERIODS
            //   First 30%  → rotating preferred pair  (P1-2 → P3-4 → P7-8 → P4-5)
            //                across Mon → Wed → Fri → Tue → Thu
            //   Remaining  → first available pair on any day
            // ════════════════════════════════════════════════════════════════════
            if (blockTasks.length > 0) {
                const blockPriorityCount = Math.ceil(blockTasks.length * 0.30);

                // Rotating preferred pairs for priority placement
                // Order: P1-P2  →  P3-P4  →  P7-P8  →  P4-P5  (cycles)
                const BLOCK_PREFERRED_ROTATION = [
                    ['P1', 'P2'],  // 1st block: periods 1–2
                    ['P3', 'P4'],  // 2nd block: periods 3–4
                    ['P7', 'P8'],  // 3rd block: periods 7–8
                    ['P4', 'P5'],  // 4th block: periods 4–5
                ];

                // All allowed pairs (break-aware), used as fallback
                // P1-P2, P3-P4, P4-P5, P7-P8
                const ALL_BLOCK_PAIRS = [
                    ['P1', 'P2'],
                    ['P3', 'P4'],
                    ['P7', 'P8'],
                    ['P4', 'P5'],
                ];

                const PRIORITY_DAYS_B = ['Monday', 'Wednesday', 'Friday', 'Tuesday', 'Thursday'];

                // Count how many block PAIRS are already placed in the whole TT
                // so the preferred-pair rotation continues across multiple CREATE calls.
                let existingBlockPeriods = 0;
                for (const tName of Object.keys(tt.teacherTimetables)) {
                    for (const d of DAYS) {
                        if (!tt.teacherTimetables[tName]?.[d]) continue;
                        for (const p of PRDS) {
                            const sl = tt.teacherTimetables[tName][d][p];
                            if (sl && typeof sl === 'object' && sl.isBlock) existingBlockPeriods++;
                        }
                    }
                }
                // Each block pair occupies 2 period slots
                const startingBlockIndex = Math.floor(existingBlockPeriods / 2);
                console.log(`[BLOCK] Already-placed block pairs in TT: ${startingBlockIndex} → pair rotation starts at index ${startingBlockIndex % 4}`);
                addMessage(`   Global block index starts at ${startingBlockIndex} (pair rotation: ${['P1-2', 'P3-4', 'P7-8', 'P4-5'][startingBlockIndex % 4]})`);

                // Find the NEXT preferred day for 'Any' blocks:
                // Scan which priority days already have block periods (any teacher).
                // Take the HIGHEST position index among those days, then +1 = next preferred.
                let highestUsedDayIdx = -1;
                for (let di = 0; di < PRIORITY_DAYS_B.length; di++) {
                    const dayName = PRIORITY_DAYS_B[di];
                    let hasBlock = false;
                    for (const tName of Object.keys(tt.teacherTimetables)) {
                        if (!tt.teacherTimetables[tName]?.[dayName]) continue;
                        for (const p of PRDS) {
                            const sl = tt.teacherTimetables[tName][dayName][p];
                            if (sl && typeof sl === 'object' && sl.isBlock) { hasBlock = true; break; }
                        }
                        if (hasBlock) break;
                    }
                    if (hasBlock) highestUsedDayIdx = di;
                }
                // nextBlockDayStart = position right after the last used block day
                const nextBlockDayStart = (highestUsedDayIdx + 1) % 5;
                console.log(`[BLOCK] Highest block day idx in TT: ${highestUsedDayIdx} (${highestUsedDayIdx >= 0 ? PRIORITY_DAYS_B[highestUsedDayIdx] : 'none'}) → next preferred: ${PRIORITY_DAYS_B[nextBlockDayStart]}`);
                addMessage(`   Next preferred block day: ${PRIORITY_DAYS_B[nextBlockDayStart]}`);

                addMessage(`\n🔍 Phase 1: Placing ${blockTasks.length} block period-pair(s)...`);
                addMessage(`   Priority: ${blockPriorityCount} block(s) → preferred pair order | rest → first available`);
                await sleep(200);

                for (let bi = 0; bi < blockTasks.length; bi++) {
                    const task = blockTasks[bi];
                    const usePriority = bi < blockPriorityCount;

                    // Preferred pair rotates GLOBALLY across all CREATE calls
                    const globalBlockIdx = startingBlockIndex + bi;
                    const preferredPair = BLOCK_PREFERRED_ROTATION[globalBlockIdx % 4];

                    // Day list: for 'Any', use next-after-highest-used-day in sequence
                    // bi=0 → nextBlockDayStart, bi=1 → nextBlockDayStart+1, etc.
                    const baseDays = (task.preferredDay && task.preferredDay !== 'Any')
                        ? [DMAP[task.preferredDay] || task.preferredDay]
                        : (() => {
                            const prefDay = PRIORITY_DAYS_B[(nextBlockDayStart + bi) % 5];
                            return [prefDay, ...PRIORITY_DAYS_B.filter(d => d !== prefDay)];
                        })();

                    addMessage(`→ Block ${globalBlockIdx + 1} (global): ${usePriority ? `preferred pair P${preferredPair[0].replace('P', '')}-P${preferredPair[1].replace('P', '')}` : 'first available pair'}`);

                    let best = null;

                    if (usePriority) {
                        // Step 1: Try the PREFERRED pair on priority days
                        // (skip days that already have a block for these classes)
                        const [pp1, pp2] = preferredPair;
                        for (const d of baseDays) {
                            if (dayAlreadyHasBlock(d, task.classes)) {
                                addMessage(`  → ${SHORT[d]} P${pp1.replace('P', '')}-P${pp2.replace('P', '')}: SKIP (day already has a block) ✗`);
                                continue;
                            }
                            const ok = slotFree(d, pp1, task.classes) && slotFree(d, pp2, task.classes);
                            const status = ok ? 'FREE ✓' : 'BUSY ✗';
                            addMessage(`  → ${SHORT[d]} P${pp1.replace('P', '')}-P${pp2.replace('P', '')}: ${status}`);
                            await sleep(60);
                            if (ok) { best = { d, p1: pp1, p2: pp2 }; break; }
                        }

                        // Step 2: If preferred pair not available, try other pairs on same day order
                        // (still respecting the no-two-blocks-per-day rule)
                        if (!best) {
                            addMessage(`  → Preferred pair busy — trying fallback pairs...`);
                            for (const d of baseDays) {
                                if (dayAlreadyHasBlock(d, task.classes)) continue; // skip, already has block
                                for (const [fp1, fp2] of ALL_BLOCK_PAIRS) {
                                    if (fp1 === pp1 && fp2 === pp2) continue; // already tried
                                    if (slotFree(d, fp1, task.classes) && slotFree(d, fp2, task.classes)) {
                                        addMessage(`  → Fallback: ${SHORT[d]} P${fp1.replace('P', '')}-P${fp2.replace('P', '')} FREE ✓`);
                                        best = { d, p1: fp1, p2: fp2 };
                                        break;
                                    }
                                }
                                if (best) break;
                            }
                        }
                    } else {
                        // After 30%: first available pair — still no two blocks per day
                        const allDays = baseDays.length > 0 ? baseDays : PRIORITY_DAYS_B;
                        outer_b:
                        for (const d of allDays) {
                            if (dayAlreadyHasBlock(d, task.classes)) continue; // skip
                            for (const [fp1, fp2] of ALL_BLOCK_PAIRS) {
                                if (slotFree(d, fp1, task.classes) && slotFree(d, fp2, task.classes)) {
                                    best = { d, p1: fp1, p2: fp2 };
                                    break outer_b;
                                }
                            }
                        }
                        if (best) addMessage(`  → First available: ${SHORT[best.d]} P${best.p1.replace('P', '')}-P${best.p2.replace('P', '')}`);
                    }

                    if (!best) {
                        addMessage('✗ No free consecutive block slot found!');
                        setCreationStatus(prev => ({ ...prev, isError: true }));
                        return;
                    }

                    // Commit block
                    task.classes.forEach(cn => {
                        tt.classTimetables[cn][best.d][best.p1] = { subject, teacher, isBlock: true };
                        tt.classTimetables[cn][best.d][best.p2] = { subject, teacher, isBlock: true };
                    });
                    tt.teacherTimetables[teacher][best.d][best.p1] = { className: task.classes.join('/'), isBlock: true };
                    tt.teacherTimetables[teacher][best.d][best.p2] = { className: task.classes.join('/'), isBlock: true };
                    tt.teacherTimetables[teacher][best.d].periodCount += 2;
                    tt.teacherTimetables[teacher].weeklyPeriods += 2;

                    placements.push({ day: best.d, period: `${best.p1}-${best.p2}`, type: 'BLOCK' });
                    addMessage(`✅ Block placed: ${SHORT[best.d]} Periods ${best.p1.replace('P', '')}–${best.p2.replace('P', '')}`);
                    placedCount++;
                    await sleep(200);
                }
            }

            // ════════════════════════════════════════════════════════════════════
            // PHASE 2 — SINGLE PERIODS
            //   First 30%  → structured priority: odd periods then even,
            //                days Mon→Wed→Fri→Tue→Thu
            //   Remaining  → first available slot
            // ════════════════════════════════════════════════════════════════════
            if (singleTasks.length > 0) {
                const priorityCount = Math.ceil(singleTasks.length * 0.30);
                const freeCount = singleTasks.length - priorityCount;
                addMessage(`\n🔍 Phase 2: Placing ${singleTasks.length} single period(s)...`);
                addMessage(`   Strategy: first ${priorityCount} → priority order (odd periods, Mon/Wed/Fri first) | next ${freeCount} → first available`);
                await sleep(200);

                // Priority order for the structured 30% — DIAGONAL WALK:
                //   Each slot i uses PRIORITY_DAYS[i%5] and PRIORITY_PRDS[i%8]
                //   So slot 0=Mon-P1, 1=Wed-P3, 2=Fri-P5, 3=Tue-P7, 4=Thu-P2,
                //      slot 5=Mon-P4, 6=Wed-P6, 7=Fri-P8, 8=Tue-P1, 9=Thu-P3 ...
                const PRIORITY_DAYS = ['Monday', 'Wednesday', 'Friday', 'Tuesday', 'Thursday'];
                const PRIORITY_PRDS = ['P1', 'P3', 'P5', 'P7', 'P2', 'P4', 'P6', 'P8'];

                // Build 40-slot diagonal-walk ordered list
                const orderedSlots = [];
                for (let oi = 0; oi < 40; oi++)
                    orderedSlots.push({
                        d: PRIORITY_DAYS[oi % 5],
                        p: PRIORITY_PRDS[oi % 8]
                    });

                // Count already-placed SINGLE (non-block) periods in TT globally
                // so the diagonal walk continues from where previous CREATE left off
                let existingSingles = 0;
                for (const tName of Object.keys(tt.teacherTimetables)) {
                    for (const d of DAYS) {
                        if (!tt.teacherTimetables[tName]?.[d]) continue;
                        for (const p of PRDS) {
                            const sl = tt.teacherTimetables[tName][d][p];
                            if (sl && typeof sl === 'object' && sl.className && !sl.isBlock)
                                existingSingles++;
                        }
                    }
                }
                // currentSlotIdx advances as we place each priority single
                let currentSlotIdx = existingSingles % 40;
                console.log(`[SINGLE] Global singles already placed: ${existingSingles} → walk starts at orderedSlots[${currentSlotIdx}] = ${PRIORITY_DAYS[currentSlotIdx % 5]}-${PRIORITY_PRDS[currentSlotIdx % 8]}`);

                // Show available slots overview
                addMessage('→ Available slots across the week:');
                const ref0 = singleTasks[0];
                for (const day of PRIORITY_DAYS) {
                    const free = PRDS.filter(p => slotFree(day, p, ref0.classes));
                    if (free.length > 0)
                        addMessage(`   ${SHORT[day]}: P${free.map(p => p.replace('P', '')).join(', P')} free`);
                }
                await sleep(300);

                for (let i = 0; i < singleTasks.length; i++) {
                    const task = singleTasks[i];
                    const usePriority = i < priorityCount;
                    const taskDays = (task.preferredDay && task.preferredDay !== 'Any')
                        ? PRIORITY_DAYS.filter(d => d === (DMAP[task.preferredDay] || task.preferredDay))
                        : PRIORITY_DAYS;

                    let pick = null;

                    // Skip a day if this subject is already present there (block or single)
                    // — prevents 3+ periods of the same subject on one day
                    const subjectOnDay = (d) =>
                        PRDS.some(p =>
                            task.classes.some(cn => {
                                const slot = tt.classTimetables[cn]?.[d]?.[p];
                                return slot && slot.subject === subject;
                            })
                        );

                    if (usePriority) {
                        // Walk the diagonal ordered list starting from currentSlotIdx
                        // Try up to 40 slots (full week) to find a free one
                        for (let attempt = 0; attempt < 40; attempt++) {
                            const slotIdx = (currentSlotIdx + attempt) % 40;
                            const { d, p } = orderedSlots[slotIdx];
                            // If preferredDay set, only consider that day
                            if (taskDays.length > 0 && !taskDays.includes(d)) continue;
                            // Skip if subject already appears on this day
                            if (subjectOnDay(d)) continue;
                            if (slotFree(d, p, task.classes)) {
                                pick = { d, p };
                                // Advance global walk pointer past this slot
                                currentSlotIdx = (slotIdx + 1) % 40;
                                break;
                            }
                        }
                        if (pick)
                            addMessage(`→ ${SHORT[pick.d]} P${pick.p.replace('P', '')} selected (priority ${i + 1}/${priorityCount}: diagonal walk)`);
                    } else {
                        // After priority phase: CONTINUE the diagonal walk (same orderedSlots)
                        // This prevents multiple singles piling up consecutively on the same day
                        for (let attempt = 0; attempt < 40; attempt++) {
                            const slotIdx = (currentSlotIdx + attempt) % 40;
                            const { d, p } = orderedSlots[slotIdx];
                            if (taskDays.length > 0 && !taskDays.includes(d)) continue;
                            // Skip if subject already appears on this day
                            if (subjectOnDay(d)) continue;
                            if (slotFree(d, p, task.classes)) {
                                pick = { d, p };
                                currentSlotIdx = (slotIdx + 1) % 40;
                                break;
                            }
                        }
                        // Hard fallback: try diagonal IGNORING the subject-clash rule
                        // (last resort when all non-clashing days are full)
                        if (!pick) {
                            for (let attempt = 0; attempt < 40; attempt++) {
                                const slotIdx = (currentSlotIdx + attempt) % 40;
                                const { d, p } = orderedSlots[slotIdx];
                                if (taskDays.length > 0 && !taskDays.includes(d)) continue;
                                if (slotFree(d, p, task.classes)) {
                                    pick = { d, p };
                                    currentSlotIdx = (slotIdx + 1) % 40;
                                    break;
                                }
                            }
                        }
                        // Absolute last resort: first free slot anywhere
                        if (!pick) {
                            const fallbackDays = taskDays.length > 0 ? taskDays : PRIORITY_DAYS;
                            outer_s:
                            for (const d of fallbackDays) {
                                for (const p of PRDS) {
                                    if (slotFree(d, p, task.classes)) {
                                        pick = { d, p };
                                        break outer_s;
                                    }
                                }
                            }
                        }
                        if (pick)
                            addMessage(`→ ${SHORT[pick.d]} P${pick.p.replace('P', '')} selected (distributed, slot ${i + 1})`);
                    }

                    if (!pick) {
                        addMessage(`✗ No free slot for single period ${i + 1}!`);
                        setCreationStatus(prev => ({ ...prev, isError: true }));
                        return;
                    }

                    // Commit pick
                    task.classes.forEach(cn => {
                        tt.classTimetables[cn][pick.d][pick.p] = { subject, teacher, isBlock: false };
                    });
                    tt.teacherTimetables[teacher][pick.d][pick.p] = { className: task.classes.join('/'), isBlock: false };
                    tt.teacherTimetables[teacher][pick.d].periodCount += 1;
                    tt.teacherTimetables[teacher].weeklyPeriods += 1;

                    placements.push({ day: pick.d, period: pick.p, type: 'SINGLE' });
                    placedCount++;
                    await sleep(120);
                }

                addMessage(`\n✅ All ${singleTasks.length} single(s) placed successfully!`);
            }

            // ── Final summary & commit ───────────────────────────────────────────
            if (placedCount === tasks.length) {
                const uniqueDays = new Set(placements.map(p => p.day)).size;
                const uniquePeriods = new Set(placements.map(p => p.period)).size;
                addMessage(`\n📈 Distribution: ${placedCount} period(s) across ${uniqueDays} day(s), ${uniquePeriods} slot(s)`);
                addMessage(`✅ All ${placedCount} periods placed! Format TT updated.`);
                addMessage(`═══════════════════════════════════════`);
                console.log('✅ [CREATE] setGeneratedTimetable called. classTimetables keys:', Object.keys(tt.classTimetables).slice(0, 5));
                await sleep(300);
                setGeneratedTimetable(tt);
                setCompletedCreations(prev => new Set([...prev, row.id]));
                setTimeout(() => setCreationStatus(null), 5000);
            } else {
                setCreationStatus(prev => ({ ...prev, isError: true }));
                addMessage(`❌ Only placed ${placedCount}/${tasks.length}. Check DPT for conflicts.`);
            }

        } catch (err) {
            console.error(err);
            addMessage(`❌ BUILD ERROR: ${err.message}`);
            setCreationStatus(prev => ({ ...prev, isError: true }));
        }
    };


    const handleGenerateTimetable = async () => {
        console.log('🔵 ===== GENERATING FROM ALLOTMENT ROWS =====');

        if (!allotmentRows || allotmentRows.length === 0) {
            addToast('⚠️ No allotments found. Please add data in Classes Alloted tab.', 'warning');
            return;
        }

        setIsGenerating(true);

        try {
            // Convert new allotmentRows format to legacy format for the generator
            const legacyMappings = [];
            const legacyDistribution = { __merged: {}, __blocks: {}, __days: {} };

            allotmentRows.forEach(row => {
                if (!row.teacher || !row.subject) return;

                const selectedClasses = [];
                row.allotments.forEach(group => {
                    const groupPeriods = Number(group.periods) || 0;
                    if (groupPeriods === 0) return;

                    group.classes.forEach(cls => {
                        selectedClasses.push(cls);
                        if (!legacyDistribution[cls]) legacyDistribution[cls] = {};
                        legacyDistribution[cls][row.subject] = groupPeriods;

                        // Store block periods and preferred day metadata
                        if (!legacyDistribution.__blocks[cls]) legacyDistribution.__blocks[cls] = {};
                        legacyDistribution.__blocks[cls][row.subject] = Number(group.blockPeriods) || 0;

                        if (!legacyDistribution.__days[cls]) legacyDistribution.__days[cls] = {};
                        legacyDistribution.__days[cls][row.subject] = group.preferredDay || 'Any';
                    });

                    if (group.isMerged) {
                        if (!legacyDistribution.__merged[row.subject]) {
                            legacyDistribution.__merged[row.subject] = [];
                        }
                        legacyDistribution.__merged[row.subject].push({
                            classes: group.classes,
                            total: groupPeriods,
                            blockPeriods: Number(group.blockPeriods) || 0,
                            preferredDay: group.preferredDay || 'Any',
                            subject: row.subject
                        });
                    }
                });

                const uniqueSelected = [...new Set(selectedClasses)];
                if (uniqueSelected.length > 0) {
                    legacyMappings.push({
                        teacher: row.teacher,
                        subject: row.subject,
                        selectedClasses: uniqueSelected
                    });
                }
            });

            console.log('Generated Legacy Data:', {
                mappingsCount: legacyMappings.length,
                mergedCount: Object.keys(legacyDistribution.__merged).length
            });

            const timetable = generateTimetable(
                legacyMappings,
                legacyDistribution,
                bellTimings
            );

            console.log('Generation result:', timetable);
            setGeneratedTimetable(timetable);

            addToast(`✅ Timetable generated!
            
            ${Object.keys(timetable.classTimetables).length} Classes scheduled
            ${Object.keys(timetable.teacherTimetables).length} Teachers scheduled
            ${timetable.errors?.length || 0} warnings`, 'success');

        } catch (error) {
            console.error('❌ ERROR IN GENERATION:', error);
            addToast(`❌ Failed: ${error.message}`, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const tabs = [
        { id: 0, label: '🏫 Teachers & Subjects' },
        { id: 1, label: '👥 Classes Alloted' },
        { id: 2, label: '📊 Distribution' },
        { id: 3, label: '🕒 DPT' },
        { id: 4, label: '🎓 Format TT' },
        { id: 5, label: '⚙️ Generate' }
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
                        <button
                            disabled={isSaving}
                            onClick={async () => {
                                // Build teacher-subject pairs from mappingRows
                                const rawPairs = mappingRows
                                    .filter(r => r.teacher && r.subject)
                                    .map(r => ({ teacher: r.teacher, subject: r.subject }));
                                let teacherSubjectPairs = [...new Map(rawPairs.map(p => [`${p.teacher}||${p.subject}`, p])).values()];
                                teacherSubjectPairs.sort((a, b) => {
                                    const ta = a.teacher.toLowerCase(), tb = b.teacher.toLowerCase();
                                    if (ta < tb) return -1; if (ta > tb) return 1;
                                    const sa = a.subject.toLowerCase(), sb = b.subject.toLowerCase();
                                    if (sa < sb) return -1; if (sa > sb) return 1;
                                    return 0;
                                });

                                // Build unique teachers + subjects from rows
                                const allTeachers = Array.from(new Set(mappingRows.map(r => r.teacher).filter(Boolean))).sort();
                                const allSubjects = Array.from(new Set(mappingRows.map(r => r.subject).filter(Boolean))).sort();

                                // Update state
                                if (allTeachers.length > 0) setTeachers(allTeachers);
                                if (allSubjects.length > 0) setSubjects(allSubjects);

                                // Save to cloud + local
                                await saveDptData(mappingRows, allTeachers, allSubjects);

                                // Sync allotment rows — MERGE new pairs into existing rows
                                // (preserve existing class/period data; only add truly new pairs)
                                // Sort alphabetically: teacher A→Z, then subject A→Z
                                localStorage.setItem('tt_teacher_subject_pairs', JSON.stringify(teacherSubjectPairs));

                                // Compute merged array from CURRENT allotmentRows state directly
                                // (not inside functional updater) so we can immediately save to Firestore
                                const existingMap = new Map(
                                    allotmentRows.map(r => [`${r.teacher}||${r.subject}`, r])
                                );
                                const mergedRows = teacherSubjectPairs.map(p => {
                                    const key = `${p.teacher}||${p.subject}`;
                                    if (existingMap.has(key)) return existingMap.get(key);
                                    return {
                                        id: key,
                                        teacher: p.teacher,
                                        subject: p.subject,
                                        allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, blockPeriods: 0, preferredDay: 'Any', isMerged: false }],
                                        total: 0
                                    };
                                }).sort((a, b) => {
                                    const ta = a.teacher.toLowerCase(), tb = b.teacher.toLowerCase();
                                    if (ta < tb) return -1; if (ta > tb) return 1;
                                    return a.subject.toLowerCase().localeCompare(b.subject.toLowerCase());
                                });

                                // Update React state
                                setAllotmentRows(mergedRows);

                                // Immediately persist to Firestore + localStorage (don't rely on debounce)
                                await saveAllotments(mergedRows);

                                // Switch to Tab 2 so user can see the updated list right away
                                setActiveTab(1);
                            }}
                            style={{
                                padding: '0.75rem 1.5rem',
                                background: isSaving ? '#64748b' : '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.75rem',
                                cursor: isSaving ? 'not-allowed' : 'pointer',
                                marginBottom: '1rem',
                                marginRight: '0.75rem',
                                fontWeight: 'bold',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}
                        >
                            {isSaving ? '⏳ Saving...' : '💾 Save to Cloud & Next Tab'}
                        </button>
                        <button
                            onClick={() => loadDptData()}
                            style={{
                                padding: '0.75rem 1.2rem',
                                background: '#4f46e5',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.75rem',
                                cursor: 'pointer',
                                marginBottom: '1rem',
                                fontWeight: 'bold',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}
                        >
                            ☁️ Reload from Cloud
                        </button>
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
                                marginRight: '1rem',
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

                {activeTab === 1 && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>

                        {/* Interactive Builder Status Panel */}
                        {creationStatus && (
                            <div style={{
                                background: '#0f172a',
                                border: `2px solid ${creationStatus.isError ? '#ef4444' : '#3b82f6'}`,
                                borderRadius: '1rem',
                                padding: '1.5rem',
                                marginBottom: '2rem',
                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
                                animation: 'slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{
                                            width: '40px', height: '40px', borderRadius: '50%',
                                            background: creationStatus.isError ? '#ef4444' : '#3b82f6',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '1.2rem'
                                        }}>
                                            {creationStatus.isError ? '❌' : '⚙️'}
                                        </div>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800' }}>
                                                BUILDING TIMETABLE: {creationStatus.teacher}
                                            </h4>
                                            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{creationStatus.subject} • Step {creationStatus.completedCount}/7</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setCreationStatus(null)}
                                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}
                                    >✕</button>
                                </div>

                                <div
                                    ref={el => {
                                        statusScrollRef.current = el;
                                        if (el) el.scrollTop = el.scrollHeight;
                                    }}
                                    style={{
                                        background: '#020617',
                                        borderRadius: '0.5rem',
                                        padding: '1rem',
                                        height: '240px',
                                        overflowY: 'auto',
                                        fontFamily: 'monospace',
                                        fontSize: '0.88rem',
                                        lineHeight: '1.6',
                                        color: creationStatus.isError ? '#fca5a5' : '#38bdf8'
                                    }}
                                >
                                    {creationStatus.messages.map((m, idx) => (
                                        <div key={idx} style={{
                                            borderLeft: `2px solid ${m.startsWith('✓') || m.startsWith('✅') ? '#10b981' : (m.startsWith('✗') || m.startsWith('❌') ? '#ef4444' : '#3b82f6')}`,
                                            paddingLeft: '0.8rem',
                                            marginBottom: '0.4rem',
                                            opacity: idx === creationStatus.messages.length - 1 ? 1 : 0.7
                                        }}>{m}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <h2 style={{ color: '#f1f5f9', marginBottom: '1rem' }}>Classes Alloted</h2>
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                            <button
                                onClick={() => saveAllotments()}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.75rem',
                                    cursor: isSaving ? 'not-allowed' : 'pointer',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    opacity: isSaving ? 0.7 : 1
                                }}
                                disabled={isSaving}
                            >
                                💾 {isSaving ? 'Saving...' : 'Save Data'}
                            </button>
                            <button
                                onClick={loadAllotments}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#334155',
                                    color: 'white',
                                    border: '1px solid #475569',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                ☁️ Load Cloud
                            </button>
                            <button
                                onClick={clearAllotments}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: 'transparent',
                                    color: '#f87171',
                                    border: '1px solid #450a0a',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem'
                                }}
                            >
                                🧹 Clear Saved
                            </button>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'collapse',
                                color: '#f1f5f9'
                            }}>
                                <thead>
                                    <tr style={{ background: '#1e293b' }}>
                                        <th style={{ padding: '0.75rem', textAlign: 'left', width: '200px' }}>Teacher Name</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left', width: '200px' }}>Subject</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Class Allotments</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'center', width: '100px' }}>Total</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'center', width: '120px' }}>Action</th>
                                        <th style={{ padding: '0.75rem', width: '50px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allotmentRows.map(row => {
                                        // Use mappingRows state (not localStorage) so newly added
                                        // teachers appear immediately after saving in Tab 1
                                        const teacherSubjects = [...new Set(
                                            mappingRows
                                                .filter(r => r.teacher === row.teacher && r.subject)
                                                .map(r => r.subject)
                                        )].sort();

                                        return (
                                            <tr key={row.id} style={{ borderBottom: '1px solid #334155' }}>
                                                <td style={{ padding: '0.6rem', color: '#f1f5f9', fontWeight: '600', textAlign: 'left' }}>
                                                    {row.teacher}
                                                </td>
                                                <td style={{ padding: '0.6rem' }}>
                                                    <select
                                                        value={row.subject}
                                                        onChange={e => updateAllotmentField(row.id, 'subject', e.target.value)}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.5rem',
                                                            background: '#0f172a',
                                                            color: '#f1f5f9',
                                                            border: '1px solid #334155',
                                                            borderRadius: '0.4rem'
                                                        }}
                                                    >
                                                        <option value="">-- Select Subject --</option>
                                                        {teacherSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                                                    </select>
                                                </td>
                                                <td style={{ padding: '0.6rem' }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        gap: '0.6rem',
                                                        flexWrap: 'nowrap',
                                                        alignItems: 'center',
                                                        overflowX: 'auto',
                                                        paddingBottom: '0.4rem',
                                                        maxWidth: '800px'
                                                    }}>
                                                        {row.allotments.map((group, gIdx) => {
                                                            const isSelected = selectedGroups.some(s => s.rowId === row.id && s.groupIndex === gIdx);
                                                            return (
                                                                <div
                                                                    key={group.id}
                                                                    style={{
                                                                        display: 'flex',
                                                                        gap: '0.4rem',
                                                                        background: group.isMerged ? 'linear-gradient(135deg, #312e81, #4338ca)' : '#0f172a',
                                                                        border: isSelected ? '2px solid #fbbf24' : (group.isMerged ? '2px solid #6366f1' : '1px solid #334155'),
                                                                        padding: '0.4rem 0.6rem',
                                                                        borderRadius: '0.6rem',
                                                                        alignItems: 'center',
                                                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                        boxShadow: isSelected ? '0 0 10px rgba(251, 191, 36, 0.4)' : (group.isMerged ? '0 4px 6px -1px rgba(0, 0, 0, 0.2)' : 'none'),
                                                                        cursor: 'default',
                                                                        flexShrink: 0
                                                                    }}
                                                                >
                                                                    {group.isMerged ? (
                                                                        <div
                                                                            title="Merged Group • Ctrl+Click to select • Right-click to unmerge"
                                                                            onClick={(e) => {
                                                                                const isSel = selectedGroups.some(s => s.rowId === row.id && s.groupIndex === gIdx);
                                                                                if (e.ctrlKey) {
                                                                                    if (isSel) setSelectedGroups(prev => prev.filter(s => !(s.rowId === row.id && s.groupIndex === gIdx)));
                                                                                    else setSelectedGroups(prev => [...prev, { rowId: row.id, groupIndex: gIdx }]);
                                                                                }
                                                                            }}
                                                                            style={{
                                                                                padding: '0.4rem 0.6rem',
                                                                                background: 'rgba(255,255,255,0.1)',
                                                                                borderRadius: '0.4rem',
                                                                                fontSize: '0.85rem',
                                                                                fontWeight: '900',
                                                                                color: '#fff',
                                                                                cursor: 'pointer',
                                                                                letterSpacing: '0.05em',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '0.4rem'
                                                                            }}
                                                                        >
                                                                            {formatClasses(group.classes)}
                                                                            <span
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (confirm(`Unmerge classes ${group.classes.join(', ')}?`)) {
                                                                                        unmergeGroup(row.id, gIdx);
                                                                                    }
                                                                                }}
                                                                                title="Unmerge"
                                                                                style={{
                                                                                    background: 'rgba(255,255,255,0.2)',
                                                                                    borderRadius: '50%',
                                                                                    width: '16px',
                                                                                    height: '16px',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    justifyContent: 'center',
                                                                                    fontSize: '10px'
                                                                                }}
                                                                            >🔗</span>
                                                                        </div>
                                                                    ) : (
                                                                        <select
                                                                            value={group.classes[0]}
                                                                            title="Ctrl+Click to select for merging"
                                                                            onMouseDown={(e) => {
                                                                                if (e.ctrlKey) {
                                                                                    e.preventDefault();
                                                                                    const grade = group.classes[0].match(/\d+/)?.[0];
                                                                                    setSelectedGroups(prev => {
                                                                                        const exists = prev.some(s => s.rowId === row.id && s.groupIndex === gIdx);
                                                                                        if (exists) return prev.filter(s => !(s.rowId === row.id && s.groupIndex === gIdx));
                                                                                        if (prev.length > 0) {
                                                                                            const first = allotmentRows.find(r => r.id === prev[0].rowId);
                                                                                            const firstGroup = first.allotments[prev[0].groupIndex];
                                                                                            const firstGrade = firstGroup.classes[0].match(/\d+/)?.[0];
                                                                                            if (prev[0].rowId !== row.id || firstGrade !== grade) return [{ rowId: row.id, groupIndex: gIdx }];
                                                                                        }
                                                                                        return [...prev, { rowId: row.id, groupIndex: gIdx }];
                                                                                    });
                                                                                }
                                                                            }}
                                                                            onChange={e => updateAllotmentGroup(row.id, gIdx, 'class', e.target.value)}
                                                                            style={{
                                                                                padding: '0.4rem',
                                                                                background: 'transparent',
                                                                                color: '#f1f5f9',
                                                                                border: 'none',
                                                                                fontSize: '0.85rem',
                                                                                fontWeight: '700',
                                                                                cursor: 'pointer',
                                                                                borderRadius: '0.3rem'
                                                                            }}
                                                                        >
                                                                            {CLASS_OPTIONS.map(c => <option key={c} value={c} style={{ background: '#0f172a' }}>{c}</option>)}
                                                                        </select>
                                                                    )}
                                                                    <div style={{ width: '1.5px', background: 'rgba(255,255,255,0.1)', height: '1.4rem', margin: '0 0.1rem' }}></div>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                                        <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold' }}>PPS</span>
                                                                        <select
                                                                            value={group.periods || 0}
                                                                            onChange={e => updateAllotmentGroup(row.id, gIdx, 'periods', e.target.value)}
                                                                            title="Periods per week"
                                                                            style={{
                                                                                background: 'transparent',
                                                                                color: (group.periods > 0) ? '#fff' : '#94a3b8',
                                                                                border: 'none',
                                                                                fontSize: '0.8rem',
                                                                                fontWeight: '800',
                                                                                cursor: 'pointer',
                                                                                outline: 'none',
                                                                                textAlign: 'center'
                                                                            }}
                                                                        >
                                                                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                                                                <option key={n} value={n} style={{ background: '#0f172a', color: '#fff' }}>{n}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '1.4rem' }}></div>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                                        <span style={{ fontSize: '0.65rem', color: '#fbbf24', fontWeight: 'bold' }}>BLOCKS</span>
                                                                        <select
                                                                            value={group.blockPeriods || 0}
                                                                            onChange={e => updateAllotmentGroup(row.id, gIdx, 'blockPeriods', e.target.value)}
                                                                            title="Number of block (double) periods per week"
                                                                            style={{
                                                                                background: 'transparent',
                                                                                color: (group.blockPeriods > 0) ? '#fbbf24' : '#94a3b8',
                                                                                border: 'none',
                                                                                fontSize: '0.8rem',
                                                                                fontWeight: '800',
                                                                                cursor: 'pointer',
                                                                                outline: 'none',
                                                                                textAlign: 'center'
                                                                            }}
                                                                        >
                                                                            {[0, 1, 2, 3, 4, 5].map(n => (
                                                                                <option key={n} value={n} style={{ background: '#0f172a', color: '#fff' }}>{n}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '1.4rem' }}></div>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                                        <span style={{ fontSize: '0.65rem', color: '#38bdf8', fontWeight: 'bold' }}>DAY</span>
                                                                        <select
                                                                            value={group.preferredDay || 'Any'}
                                                                            onChange={e => updateAllotmentGroup(row.id, gIdx, 'preferredDay', e.target.value)}
                                                                            title="Fix subject to a specific day"
                                                                            style={{
                                                                                background: 'transparent',
                                                                                color: (group.preferredDay && group.preferredDay !== 'Any') ? '#38bdf8' : '#94a3b8',
                                                                                border: 'none',
                                                                                fontSize: '0.8rem',
                                                                                fontWeight: '800',
                                                                                cursor: 'pointer',
                                                                                outline: 'none',
                                                                                textAlign: 'center'
                                                                            }}
                                                                        >
                                                                            {['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => (
                                                                                <option key={d} value={d} style={{ background: '#0f172a', color: '#fff' }}>{d}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    <button
                                                                        title="Delete allotment"
                                                                        onClick={() => deleteAllotmentGroup(row.id, gIdx)}
                                                                        style={{
                                                                            background: 'transparent',
                                                                            border: 'none',
                                                                            color: '#f87171',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.9rem',
                                                                            padding: '0 0.3rem',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                            transition: 'transform 0.1s'
                                                                        }}
                                                                        onMouseOver={e => e.currentTarget.style.transform = 'scale(1.2)'}
                                                                        onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
                                                                    >✕</button>
                                                                </div>
                                                            );
                                                        })}
                                                        <button
                                                            onClick={(e) => {
                                                                if (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) {
                                                                    const rect = e.target.getBoundingClientRect();
                                                                    const firstGroup = row.allotments[selectedGroups[0].groupIndex];
                                                                    const grade = firstGroup.classes[0].match(/\d+/)?.[0];
                                                                    setMergePopup({
                                                                        rowId: row.id,
                                                                        groupIndices: selectedGroups.map(s => s.groupIndex),
                                                                        grade,
                                                                        rect
                                                                    });
                                                                } else {
                                                                    addAllotmentGroup(row.id);
                                                                }
                                                            }}
                                                            style={{
                                                                padding: '0.6rem 1rem',
                                                                background: (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '#fbbf24' : '#1e293b',
                                                                color: (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '#000' : '#818cf8',
                                                                border: (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? 'none' : '1px dashed #4f46e5',
                                                                borderRadius: '0.6rem',
                                                                cursor: 'pointer',
                                                                fontSize: '0.85rem',
                                                                fontWeight: '800',
                                                                transition: 'all 0.2s',
                                                                flexShrink: 0,
                                                                whiteSpace: 'nowrap'
                                                            }}
                                                            onMouseOver={e => {
                                                                e.currentTarget.style.background = (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '#f59e0b' : 'rgba(79,70,229,0.1)';
                                                            }}
                                                            onMouseOut={e => {
                                                                e.currentTarget.style.background = (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '#fbbf24' : '#1e293b';
                                                            }}
                                                        >
                                                            {(selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '🔗 Merge Selected' : '＋ Add Group'}
                                                        </button>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '0.6rem', textAlign: 'center', fontWeight: 'bold' }}>
                                                    {row.total}
                                                </td>
                                                <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => handleCreateSpecific(row)}
                                                        disabled={creationStatus || completedCreations.has(row.id)}
                                                        style={{
                                                            padding: '0.5rem 1rem',
                                                            background: completedCreations.has(row.id) ? '#10b981' : (creationStatus ? '#475569' : '#3b82f6'),
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '0.5rem',
                                                            fontSize: '0.75rem',
                                                            fontWeight: '800',
                                                            cursor: (creationStatus || completedCreations.has(row.id)) ? 'not-allowed' : 'pointer',
                                                            transition: 'all 0.2s',
                                                            boxShadow: completedCreations.has(row.id) ? '0 0 10px rgba(16,185,129,0.3)' : 'none'
                                                        }}
                                                    >
                                                        {completedCreations.has(row.id) ? '✅ CREATED' : 'CREATE'}
                                                    </button>
                                                </td>
                                                <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                                                    <button onClick={() => deleteAllotmentRow(row.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>🗑️</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Merge Popup */}
                        {mergePopup && (
                            <div style={{
                                position: 'fixed',
                                top: 0, left: 0, right: 0, bottom: 0,
                                background: 'rgba(0,0,0,0.7)',
                                display: 'flex', justifyContent: 'center', alignItems: 'center',
                                zIndex: 3000,
                                backdropFilter: 'blur(4px)',
                                animation: 'fadeIn 0.2s ease-out'
                            }}>
                                <div style={{
                                    background: '#1e293b',
                                    padding: '2rem',
                                    borderRadius: '1.25rem',
                                    border: '1px solid #4f46e5',
                                    width: '350px',
                                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                                    position: 'relative'
                                }}>
                                    <h3 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '1.4rem' }}>🔗 Merge Classes</h3>
                                    <p style={{ fontSize: '0.95rem', color: '#94a3b8', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                                        Combining <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{mergePopup.groupIndices.length}</span> allocations for <span style={{ color: '#fff' }}>Grade {mergePopup.grade}</span>.
                                    </p>

                                    <div style={{ marginBottom: '2rem', background: '#0f172a', padding: '1rem', borderRadius: '0.8rem', border: '1px solid #334155' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#818cf8', fontWeight: 'bold', marginBottom: '0.6rem', textTransform: 'uppercase' }}>Weekly Periods</label>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.8rem' }}>
                                            <input
                                                autoFocus
                                                type="number"
                                                defaultValue="5"
                                                id="merge_periods_input"
                                                style={{
                                                    fontSize: '1.5rem',
                                                    fontWeight: 'bold',
                                                    width: '80px',
                                                    padding: '0.5rem',
                                                    background: 'transparent',
                                                    color: '#fbbf24',
                                                    border: 'none',
                                                    borderBottom: '2px solid #4f46e5',
                                                    outline: 'none',
                                                    textAlign: 'center'
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        handleMergeConfirm(e.target.value);
                                                    }
                                                }}
                                            />
                                            <span style={{ color: '#475569', fontSize: '0.9rem' }}>periods shared per week</span>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'flex-end' }}>
                                        <button
                                            onClick={() => setMergePopup(null)}
                                            style={{
                                                padding: '0.7rem 1.2rem',
                                                background: 'transparent',
                                                border: '1px solid #475569',
                                                borderRadius: '0.6rem',
                                                color: '#94a3b8',
                                                cursor: 'pointer',
                                                fontWeight: '600'
                                            }}
                                        >Cancel</button>
                                        <button
                                            onClick={() => {
                                                const val = document.getElementById('merge_periods_input').value;
                                                handleMergeConfirm(val);
                                            }}
                                            style={{
                                                padding: '0.7rem 1.5rem',
                                                background: '#4f46e5',
                                                border: 'none',
                                                borderRadius: '0.6rem',
                                                color: '#fff',
                                                cursor: 'pointer',
                                                fontWeight: '700',
                                                boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.4)'
                                            }}
                                        >Confirm Merge</button>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={addAllotmentRow}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#4f46e5',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >+ Add Row</button>
                            <button
                                onClick={() => saveAllotments()}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >💾 Save All Changes</button>
                        </div>
                    </div>
                )}

                {/* Tab 4: Format TT (moved down) */}
                {activeTab === 4 && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                        <button
                            onClick={() => {
                                addToast('Saved', 'success');
                            }}
                            style={{
                                padding: '0.75rem 1.5rem',
                                background: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.75rem',
                                cursor: 'pointer',
                                marginBottom: '1.5rem'
                            }}
                        >
                            💾 Save
                        </button>
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
                                            {[
                                                ['MON', 'Monday'],
                                                ['TUE', 'Tuesday'],
                                                ['WED', 'Wednesday'],
                                                ['THU', 'Thursday'],
                                                ['FRI', 'Friday'],
                                                ['SAT', 'Saturday']
                                            ].map(([label, dayKey], i) => {
                                                // Find all classes for the active grade sub-tab
                                                const gradeClasses = CLASS_OPTIONS.filter(c => c.startsWith(activeGradeSubTab));
                                                // For grade 6 tab, show 6A by default
                                                const classKey = gradeClasses[0] || `${activeGradeSubTab}A`;
                                                const dayData = generatedTimetable?.classTimetables?.[classKey]?.[dayKey] || {};

                                                const getCell = (periodKey) => {
                                                    const cell = dayData[periodKey];
                                                    if (!cell || !cell.subject) return '';
                                                    const sub = cell.subject.toUpperCase();
                                                    return SUBJECT_ABBR[sub] || sub.slice(0, 5);
                                                };

                                                return (
                                                    <tr key={label}>
                                                        <th style={ttCellDay()}>{label}</th>
                                                        {/* P1 */}
                                                        <td style={ttCell()}>{getCell('P1')}</td>
                                                        {/* P2 */}
                                                        <td style={ttCell()}>{getCell('P2')}</td>
                                                        {/* BREAK-I (rowspan) */}
                                                        {i === 0 ? (
                                                            <td style={ttCellBreak('BREAK - I', 6)} rowSpan={6}>
                                                                <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#fbbf24', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>
                                                                    BREAK - I
                                                                </span>
                                                            </td>
                                                        ) : null}
                                                        {/* P3 */}
                                                        <td style={ttCell()}>{getCell('P3')}</td>
                                                        {/* P4 */}
                                                        <td style={ttCell()}>{getCell('P4')}</td>
                                                        {/* P5 */}
                                                        <td style={ttCell()}>{getCell('P5')}</td>
                                                        {/* BREAK-II (rowspan) */}
                                                        {i === 0 ? (
                                                            <td style={ttCellBreak('BREAK - II', 6)} rowSpan={6}>
                                                                <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#fbbf24', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>
                                                                    BREAK - II
                                                                </span>
                                                            </td>
                                                        ) : null}
                                                        {/* P6 */}
                                                        <td style={ttCell()}>{getCell('P6')}</td>
                                                        {/* LUNCH (rowspan) */}
                                                        {i === 0 ? (
                                                            <td style={ttCellBreak('LUNCH BREAK', 6)} rowSpan={6}>
                                                                <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#38bdf8', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>
                                                                    LUNCH BREAK
                                                                </span>
                                                            </td>
                                                        ) : null}
                                                        {/* P7 */}
                                                        <td style={ttCell()}>{getCell('P7')}</td>
                                                        {/* P8 */}
                                                        <td style={ttCell()}>{getCell('P8')}</td>
                                                    </tr>
                                                );
                                            })}
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
                            /* Dynamic table for all other grades */
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
                                <div style={{ marginBottom: '1.5rem', width: '100%' }}>
                                    <div style={{ fontSize: '2.1rem', fontWeight: 900, color: '#f1f5f9', textAlign: 'center' }}>THE CHOICE SCHOOL, Tripunithura</div>
                                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#a5b4fc', marginTop: '0.2rem', textAlign: 'center' }}>2026-27</div>
                                    <div style={{ fontSize: '3rem', fontWeight: 900, color: '#4f46e5', marginTop: '0.2rem', textAlign: 'center', letterSpacing: '0.04em' }}>
                                        {activeGradeSubTab}{CLASS_OPTIONS.filter(c => c.startsWith(activeGradeSubTab))[0]?.replace(activeGradeSubTab, '') || 'A'}
                                    </div>
                                </div>
                                <div style={{ overflowX: 'auto', width: '100%', maxWidth: 1200, margin: '0 auto' }}>
                                    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1100, background: 'transparent', color: '#f1f5f9', fontFamily: 'inherit' }}>
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
                                            {[
                                                ['MON', 'Monday'],
                                                ['TUE', 'Tuesday'],
                                                ['WED', 'Wednesday'],
                                                ['THU', 'Thursday'],
                                                ['FRI', 'Friday'],
                                                ['SAT', 'Saturday']
                                            ].map(([label, dayKey], i) => {
                                                const gradeClasses = CLASS_OPTIONS.filter(c => c.startsWith(activeGradeSubTab));
                                                const classKey = gradeClasses[0] || `${activeGradeSubTab}A`;
                                                const dayData = generatedTimetable?.classTimetables?.[classKey]?.[dayKey] || {};
                                                const getCell = (periodKey) => {
                                                    const cell = dayData[periodKey];
                                                    if (!cell || !cell.subject) return '';
                                                    const sub = cell.subject.toUpperCase();
                                                    return SUBJECT_ABBR[sub] || sub.slice(0, 5);
                                                };
                                                return (
                                                    <tr key={label}>
                                                        <th style={ttCellDay()}>{label}</th>
                                                        <td style={ttCell()}>{getCell('P1')}</td>
                                                        <td style={ttCell()}>{getCell('P2')}</td>
                                                        {i === 0 ? <td style={ttCellBreak('BREAK - I', 6)} rowSpan={6}><span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#fbbf24', writingMode: 'vertical-rl' }}>BREAK - I</span></td> : null}
                                                        <td style={ttCell()}>{getCell('P3')}</td>
                                                        <td style={ttCell()}>{getCell('P4')}</td>
                                                        <td style={ttCell()}>{getCell('P5')}</td>
                                                        {i === 0 ? <td style={ttCellBreak('BREAK - II', 6)} rowSpan={6}><span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#fbbf24', writingMode: 'vertical-rl' }}>BREAK - II</span></td> : null}
                                                        <td style={ttCell()}>{getCell('P6')}</td>
                                                        {i === 0 ? <td style={ttCellBreak('LUNCH BREAK', 6)} rowSpan={6}><span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.1em', color: '#38bdf8', writingMode: 'vertical-rl' }}>LUNCH BREAK</span></td> : null}
                                                        <td style={ttCell()}>{getCell('P7')}</td>
                                                        <td style={ttCell()}>{getCell('P8')}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                {!generatedTimetable && (
                                    <div style={{ marginTop: '2rem', padding: '1rem', background: '#0f172a', borderRadius: '0.8rem', border: '1px dashed #4f46e5', maxWidth: '500px' }}>
                                        <p style={{ color: '#94a3b8', fontSize: '0.95rem', margin: 0 }}>No timetable data yet. Use the Classes Alloted tab and click CREATE for each teacher.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 4: Subject Period Distribution */}
                {activeTab === 2 && (
                    <div>
                        <button
                            onClick={() => {
                                localStorage.setItem('tt_distribution_47', JSON.stringify(distribution47));
                                addToast('Saved', 'success');
                            }}
                            style={{
                                padding: '0.75rem 1.5rem',
                                background: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.75rem',
                                cursor: 'pointer',
                                marginBottom: '1.5rem',
                                display: 'block'
                            }}
                        >
                            💾 Save
                        </button>
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

                {/* Tab 3: DPT (Day, Period, Time) */}
                {activeTab === 3 && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                        <div style={{
                            background: '#1e293b',
                            borderRadius: '1.5rem',
                            padding: '3rem',
                            border: '1px solid #334155',
                            textAlign: 'center'
                        }}>
                            <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🕒</div>
                            <h2 style={{ fontSize: '2.5rem', fontWeight: '900', color: '#f1f5f9', marginBottom: '1rem' }}>DPT Configuration</h2>
                            <p style={{ color: '#94a3b8', fontSize: '1.2rem', maxWidth: '600px', margin: '0 auto 2.5rem auto', lineHeight: '1.6' }}>
                                Manage Day, Period, and Time constraints here. Configure specific time slots,
                                period durations, and day-wise settings for your timetable.
                            </p>

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                                gap: '2rem',
                                marginTop: '2rem'
                            }}>
                                <div style={{
                                    background: 'rgba(59, 130, 246, 0.1)',
                                    padding: '2rem',
                                    borderRadius: '1.25rem',
                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                    transition: 'transform 0.3s ease',
                                    cursor: 'pointer'
                                }}
                                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
                                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                >
                                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📅</div>
                                    <h4 style={{ color: '#3b82f6', fontSize: '1.25rem', fontWeight: '800', marginBottom: '0.75rem' }}>Active Days</h4>
                                    <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: '1.5' }}>Select which days of the week the school is active (e.g., Mon-Fri or Mon-Sat).</p>
                                </div>

                                <div style={{
                                    background: 'rgba(139, 92, 246, 0.1)',
                                    padding: '2rem',
                                    borderRadius: '1.25rem',
                                    border: '1px solid rgba(139, 92, 246, 0.2)',
                                    transition: 'transform 0.3s ease',
                                    cursor: 'pointer'
                                }}
                                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
                                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                >
                                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔢</div>
                                    <h4 style={{ color: '#8b5cf6', fontSize: '1.25rem', fontWeight: '800', marginBottom: '0.75rem' }}>Periods per Day</h4>
                                    <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: '1.5' }}>Define how many periods run each day and handle special short-day schedules.</p>
                                </div>

                                <div style={{
                                    background: 'rgba(16, 185, 129, 0.1)',
                                    padding: '2rem',
                                    borderRadius: '1.25rem',
                                    border: '1px solid rgba(16, 185, 129, 0.2)',
                                    transition: 'transform 0.3s ease',
                                    cursor: 'pointer'
                                }}
                                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
                                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                >
                                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⏰</div>
                                    <h4 style={{ color: '#10b981', fontSize: '1.25rem', fontWeight: '800', marginBottom: '0.75rem' }}>Bell Timings</h4>
                                    <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: '1.5' }}>Precision control over start/end times for every period and break.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Tab 5: Generate */}
                {
                    activeTab === 5 && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out', padding: '2rem 0' }}>
                            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                                <button
                                    onClick={() => {
                                        localStorage.setItem('tt_bell_timings', JSON.stringify(bellTimings));
                                        localStorage.setItem('tt_generated_timetable', JSON.stringify(generatedTimetable));
                                        addToast('Saved', 'success');
                                    }}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#10b981',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        marginBottom: '1.5rem'
                                    }}
                                >
                                    💾 Save
                                </button>
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

            {
                dropdownConfig && (
                    <div onClick={() => setDropdownConfig(null)} style={{ position: 'fixed', inset: 0, zIndex: 999 }}></div>
                )
            }

            <style>{`
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
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
